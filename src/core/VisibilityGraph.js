// VisibilityGraph.js — lazy visibility graph + fast LOS oracle.
//
// Building a full O(V²) visibility graph over ~6000 obstacle vertices is far
// too slow for sub-ms budgets (the tab hangs for seconds). Instead we build
// ONLY the scaffolding upfront:
//
//   - Nodes: obstacle polygon vertices (deduplicated by rounded coordinate),
//            plus portal polygon vertices (bridge decks, dock piers, gate
//            discs). Stored in SoA Float64Arrays for cache locality.
//   - Blocker index: every obstacle boundary edge, in a uniform spatial grid
//            (segment-bbox-binned) for fast "does this segment cross any
//            obstacle?" queries. This is the LOS (line-of-sight) oracle.
//   - Node index: nodes bucketed by the same grid, for fast "find candidate
//            visible nodes within radius R" queries.
//
// Edges are computed lazily: `expandNode(i)` queries the node grid for cells
// around node i (a configurable ring), runs the LOS oracle against each
// candidate, and caches the visible neighbour list. Subsequent calls are O(1).
// This means A* / Theta* expansion only pays for the nodes it actually visits,
// not all O(V²) pairs upfront.
//
// The same LOS oracle is exposed as `losClear(ax, ay, bx, by)` so a Theta*
// implementation can do on-demand parent–neighbour LOS relaxation against the
// obstacle set without any precomputed graph at all.
//
// Portals (gates, bridges, docks) carve openings: a crossing whose intersection
// point lies inside a portal polygon (or inside a gate disc radius) is allowed.

import { thickenPolyline } from './Obstacles.js';

const EPS = 1e-9;
const POINT_EPS = 1e-6;
const GATE_DISC_SEGMENTS = 8;
const NODE_BLOCKING_OVERLAP_KINDS = new Set(['tower', 'wall', 'water', 'delta', 'river', 'hedge', 'cathedralHedge']);

function keyOf(x, y) {
	// Round to 1e-6 to merge nearly-coincident vertices from adjacent obstacles.
	return (Math.round(x * 1e6) * 1e6 + Math.round(y * 1e6)) | 0;
}

// ---------- geometry helpers (inlined hot paths sit in losClear below) ----------

function pointInPolygon(px, py, poly /* flat [x0,y0,x1,y1,...] */) {	let inside = false;
	const n = poly.length;
	for (let i = 0, j = n - 2; i < n; i += 2, j = i - 2) {
		const ax = poly[j], ay = poly[j + 1];
		const bx = poly[i], by = poly[i + 1];
		if ((ay > py) !== (by > py)) {
			const xInt = ax + (py - ay) * (bx - ax) / (by - ay);
			if (px < xInt) inside = !inside;
		}
	}
	return inside;
}

// Point-in-polygon with boundary tolerance: returns true if (px,py) is inside
// the polygon OR within `tol` of any edge. Ray-casting is unreliable for
// points exactly on an edge, so we test the point plus 4 offset samples to
// catch boundary coincidences (river-mouth vertices on the water boundary).
function _insideOrOnBoundary(px, py, poly, tol) {
	if (pointInPolygon(px, py, poly)) return true;
	if (pointInPolygon(px + tol, py, poly)) return true;
	if (pointInPolygon(px - tol, py, poly)) return true;
	if (pointInPolygon(px, py + tol, poly)) return true;
	if (pointInPolygon(px, py - tol, poly)) return true;
	return false;
}

// ---------- spatial grid (segment-bbox-binned hash) ----------
class SpatialGrid {
	constructor(bounds, cellSize) {
		const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
		this.cell = cellSize > 0 ? cellSize : Math.max(1, span / 64);
		this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / this.cell) + 1);
		this.rows = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / this.cell) + 1);
		this.originX = bounds.minX;
		this.originY = bounds.minY;
		this.bins = new Array(this.cols * this.rows).fill(null);
	}
	col(x) { return Math.max(0, Math.min(this.cols - 1, ((x - this.originX) / this.cell) | 0)); }
	row(y) { return Math.max(0, Math.min(this.rows - 1, ((y - this.originY) / this.cell) | 0)); }
	key(cx, cy) { return cy * this.cols + cx; }
}

// ---------- main class ----------

export class LazyVisibilityGraph {
	constructor(obstacles, opts = {}) {
		const tStart = (typeof performance !== 'undefined' ? performance.now() : 0);

		// Dilation (Minkowski-sum-with-disc approximation). Each convex vertex
		// is offset outward along the exterior angle bisector by r/sin(θ/2)
		// so paths keep at least `clearance` from walls. Reflex vertices are
		// left in place (standard approximation; arc-vertices at reflex
		// corners would be needed for an exact offset). Portals stay undilated
		// so gates/bridges remain passable.
		const clearance = Number.isFinite(opts.clearance) && opts.clearance > 0 ? opts.clearance : 0;
		const waterNodePenalty = Number.isFinite(opts.waterNodePenalty) ? Math.max(0, opts.waterNodePenalty) : 4;
		const towerNodePenalty = Number.isFinite(opts.towerNodePenalty) ? Math.max(0, opts.towerNodePenalty) : 4;
		this.routeLinePenalty = Number.isFinite(opts.routeLinePenalty) ? Math.max(0, opts.routeLinePenalty) : 0.15;

		// --- 1. Collect polygons as point arrays, then dilate, then flatten ---
		const rawPolys = [];           // Array<Array<{x,y}>> before dilation
		const rawKinds = [];           // kind string per raw polygon ('water', 'delta', 'building', etc.)
		const portals = [];           // {kind, cx, cy, r} | {kind, poly: Float64Array, minX..maxY}

		for (const o of obstacles.polygons || []) {
			if (!o.polygon || o.polygon.length < 3) continue;
			rawPolys.push(o.polygon.map(p => ({ x: p.x, y: p.y })));
			rawKinds.push(o.kind || '');
		}
		for (const ln of obstacles.lines || []) {
			const strip = thickenPolyline(ln.polyline, ln.thickness);
			if (!strip || strip.length < 3) continue;
			rawPolys.push(strip.map(p => ({ x: p.x, y: p.y })));
			rawKinds.push(ln.kind || '');
		}
		// Portals are NOT dilated.
		for (const p of obstacles.portals || []) {
			if (p.kind === 'gate' && p.center && Number.isFinite(p.radius)) {
				portals.push({ kind: 'gate', cx: p.center.x, cy: p.center.y, r: p.radius });
			} else if (p.polygon && p.polygon.length >= 3) {
				const verts = (clearance > 0 && p.kind === 'bridge')
					? dilatePolygon(p.polygon, -clearance)
					: p.polygon;
				const flat = new Float64Array(verts.length * 2);
				let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
				for (let i = 0; i < verts.length; i++) {
					const q = verts[i];
					flat[i * 2] = q.x; flat[i * 2 + 1] = q.y;
					if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
					if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
				}
				portals.push({ kind: p.kind, poly: flat, minX, minY, maxX, maxY });
			}
		}
		const softBarrierSegments = [];
		for (const b of obstacles.softBarriers || []) {
			const pts = b.polyline || b.points || null;
			if (!pts || pts.length < 2) continue;
			const penalty = Number.isFinite(b.penalty) ? Math.max(0, b.penalty) : 1;
			for (let i = 0; i < pts.length - 1; i++) {
				const a = pts[i], c = pts[i + 1];
				if (!a || !c) continue;
				if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
				if (Math.hypot(c.x - a.x, c.y - a.y) < EPS) continue;
				softBarrierSegments.push({ ax: a.x, ay: a.y, bx: c.x, by: c.y, penalty });
			}
		}
		this.softBarrierCount = softBarrierSegments.length;

		// Apply dilation, then flatten to SoA + bbox.
		const polygons = [];          // Array<Float64Array>
		const polyBboxes = [];
		const polyIsWater = [];       // true for water/delta/river polygons
		for (let ri = 0; ri < rawPolys.length; ri++) {
			const raw = rawPolys[ri];
			const kind = rawKinds[ri];
			const dil = clearance > 0 ? dilatePolygon(raw, clearance) : raw;
			const flat = new Float64Array(dil.length * 2);
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (let i = 0; i < dil.length; i++) {
				const p = dil[i];
				flat[i * 2] = p.x; flat[i * 2 + 1] = p.y;
				if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
				if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
			}
			polygons.push(flat);
			polyBboxes.push({ minX, minY, maxX, maxY });
			polyIsWater.push(kind === 'water' || kind === 'delta' || kind === 'river');
		}
		this.clearance = clearance;
		this.polygons = polygons;
		this.polyBboxes = polyBboxes;
		this.rawKinds = rawKinds;
		this.portals = portals;

		// Build polygon form for every portal (gate discs → sampled circles).
		// Used for edge clipping and barrier classification.
		const portalPolys = [];
		for (const p of portals) {
			if (p.kind === 'gate') {
				const verts = new Float64Array(GATE_DISC_SEGMENTS * 2);
				for (let i = 0; i < GATE_DISC_SEGMENTS; i++) {
					const a = (i / GATE_DISC_SEGMENTS) * Math.PI * 2;
					verts[i * 2] = p.cx + Math.cos(a) * p.r;
					verts[i * 2 + 1] = p.cy + Math.sin(a) * p.r;
				}
				portalPolys.push(verts);
			} else {
				portalPolys.push(p.poly);
			}
		}
		this.portalPolys = portalPolys;

		// Also flatten the NON-dilated polygons for path post-processing
		// (smoothPath). Dilation creates slightly displaced nodes that cause
		// micro-jitter; smoothing against the raw obstacle edges removes it.
		const rawPolygons = [];
		const rawPolyBboxes = [];
		const rawPolyIsWater = [];
		for (let ri = 0; ri < rawPolys.length; ri++) {
			const raw = rawPolys[ri];
			const flat = new Float64Array(raw.length * 2);
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (let i = 0; i < raw.length; i++) {
				flat[i * 2] = raw[i].x; flat[i * 2 + 1] = raw[i].y;
				if (raw[i].x < minX) minX = raw[i].x; if (raw[i].x > maxX) maxX = raw[i].x;
				if (raw[i].y < minY) minY = raw[i].y; if (raw[i].y > maxY) maxY = raw[i].y;
			}
			rawPolygons.push(flat);
			rawPolyBboxes.push({ minX, minY, maxX, maxY });
			rawPolyIsWater.push(polyIsWater[ri]);
		}

		// --- 2. Global bounds ---
		let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
		for (const b of polyBboxes) {
			if (b.minX < gMinX) gMinX = b.minX;
			if (b.minY < gMinY) gMinY = b.minY;
			if (b.maxX > gMaxX) gMaxX = b.maxX;
			if (b.maxY > gMaxY) gMaxY = b.maxY;
		}
		for (const s of softBarrierSegments) {
			const minX = s.ax < s.bx ? s.ax : s.bx;
			const minY = s.ay < s.by ? s.ay : s.by;
			const maxX = s.ax > s.bx ? s.ax : s.bx;
			const maxY = s.ay > s.by ? s.ay : s.by;
			if (minX < gMinX) gMinX = minX;
			if (minY < gMinY) gMinY = minY;
			if (maxX > gMaxX) gMaxX = maxX;
			if (maxY > gMaxY) gMaxY = maxY;
		}
		if (!isFinite(gMinX)) { gMinX = 0; gMinY = 0; gMaxX = 1; gMaxY = 1; }
		this.bounds = { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY };

		// --- 3. Clip obstacle edges against portal polygons ---
		// See _clipAndBuildBlockers for details. This produces the dilated
		// blocker set used by losClear() (pathfinding). A parallel non-dilated
		// set is built for smoothPath() (post-processing).

		const dilatedResult = _clipAndBuildBlockers(polygons, polyBboxes, portalPolys, polyIsWater);
		const rawResult = _clipAndBuildBlockers(rawPolygons, rawPolyBboxes, portalPolys, rawPolyIsWater);

		this.clipPoints = dilatedResult.clipPoints;
		this.rawPolygons = rawPolygons;
		this.rawPolyBboxes = rawPolyBboxes;
		this.rawPortalPolys = portalPolys;

		const edgeCount = dilatedResult.edges.length;
		const bx1 = new Float64Array(edgeCount);
		const by1 = new Float64Array(edgeCount);
		const bx2 = new Float64Array(edgeCount);
		const by2 = new Float64Array(edgeCount);
		const bminX = new Float64Array(edgeCount);
		const bminY = new Float64Array(edgeCount);
		const bmaxX = new Float64Array(edgeCount);
		const bmaxY = new Float64Array(edgeCount);
		const bOwner = new Int32Array(edgeCount);
		for (let ei = 0; ei < edgeCount; ei++) {
			const e = dilatedResult.edges[ei];
			bx1[ei] = e.ax; by1[ei] = e.ay; bx2[ei] = e.bx; by2[ei] = e.by;
			bminX[ei] = e.ax < e.bx ? e.ax : e.bx;
			bminY[ei] = e.ay < e.by ? e.ay : e.by;
			bmaxX[ei] = e.ax > e.bx ? e.ax : e.bx;
			bmaxY[ei] = e.ay > e.by ? e.ay : e.by;
			bOwner[ei] = e.owner;
		}
		this.blockerCount = edgeCount;
		this.bx1 = bx1; this.by1 = by1; this.bx2 = bx2; this.by2 = by2;
		this.bminX = bminX; this.bminY = bminY; this.bmaxX = bmaxX; this.bmaxY = bmaxY;
		this.bOwner = bOwner;

		// --- 4. Blocker spatial grid (dilated edges) ---
		const cellSize = opts.blockerCellSize || Math.max(1, Math.sqrt((gMaxX - gMinX) * (gMaxY - gMinY) / Math.max(1, edgeCount)));
		this.blockerGrid = new SpatialGrid(this.bounds, cellSize);
		const bg = this.blockerGrid;
		for (let i = 0; i < edgeCount; i++) {
			const x0 = bg.col(bminX[i]), x1 = bg.col(bmaxX[i]);
			const y0 = bg.row(bminY[i]), y1 = bg.row(bmaxY[i]);
			for (let cy = y0; cy <= y1; cy++)
				for (let cx = x0; cx <= x1; cx++) {
					const k = bg.key(cx, cy);
					let arr = bg.bins[k];
					if (!arr) { arr = []; bg.bins[k] = arr; }
					arr.push(i);
				}
		}

		// --- 4b. Non-dilated blocker set (for smoothPath post-processing) ---
		const rawEdgeCount = rawResult.edges.length;
		this.rx1 = new Float64Array(rawEdgeCount);
		this.ry1 = new Float64Array(rawEdgeCount);
		this.rx2 = new Float64Array(rawEdgeCount);
		this.ry2 = new Float64Array(rawEdgeCount);
		this.rminX = new Float64Array(rawEdgeCount);
		this.rminY = new Float64Array(rawEdgeCount);
		this.rmaxX = new Float64Array(rawEdgeCount);
		this.rmaxY = new Float64Array(rawEdgeCount);
		for (let ei = 0; ei < rawEdgeCount; ei++) {
			const e = rawResult.edges[ei];
			this.rx1[ei] = e.ax; this.ry1[ei] = e.ay;
			this.rx2[ei] = e.bx; this.ry2[ei] = e.by;
			this.rminX[ei] = e.ax < e.bx ? e.ax : e.bx;
			this.rminY[ei] = e.ay < e.by ? e.ay : e.by;
			this.rmaxX[ei] = e.ax > e.bx ? e.ax : e.bx;
			this.rmaxY[ei] = e.ay > e.by ? e.ay : e.by;
		}
		this.rawBlockerCount = rawEdgeCount;
		this.rawBlockerGrid = new SpatialGrid(this.bounds, cellSize);
		const rbg = this.rawBlockerGrid;
		for (let i = 0; i < rawEdgeCount; i++) {
			const x0 = rbg.col(this.rminX[i]), x1 = rbg.col(this.rmaxX[i]);
			const y0 = rbg.row(this.rminY[i]), y1 = rbg.row(this.rmaxY[i]);
			for (let cy = y0; cy <= y1; cy++)
				for (let cx = x0; cx <= x1; cx++) {
					const k = rbg.key(cx, cy);
					let arr = rbg.bins[k];
					if (!arr) { arr = []; rbg.bins[k] = arr; }
					arr.push(i);
				}
		}

		// --- 4d. Spatial grid for raw polygon containment (_inRawObstacle) ---
		this.rawPolyGrid = new SpatialGrid(this.bounds, cellSize);
		const rpg = this.rawPolyGrid;
		for (let pi = 0; pi < rawPolygons.length; pi++) {
			const b = rawPolyBboxes[pi];
			const rx0 = rpg.col(b.minX), rx1 = rpg.col(b.maxX);
			const ry0 = rpg.row(b.minY), ry1 = rpg.row(b.maxY);
			for (let cy = ry0; cy <= ry1; cy++)
				for (let cx = rx0; cx <= rx1; cx++) {
					const k = rpg.key(cx, cy);
					let arr = rpg.bins[k];
					if (!arr) { arr = []; rpg.bins[k] = arr; }
					arr.push(pi);
				}
		}

		// --- 5. Nodes: dedup polygon vertices → SoA + cell buckets ---
		const nodeMap = new Map();      // key → node index
		// --- 4c. Soft barriers (roads): legal to cross, but costly. ---
		this.sx1 = new Float64Array(this.softBarrierCount);
		this.sy1 = new Float64Array(this.softBarrierCount);
		this.sx2 = new Float64Array(this.softBarrierCount);
		this.sy2 = new Float64Array(this.softBarrierCount);
		this.sminX = new Float64Array(this.softBarrierCount);
		this.sminY = new Float64Array(this.softBarrierCount);
		this.smaxX = new Float64Array(this.softBarrierCount);
		this.smaxY = new Float64Array(this.softBarrierCount);
		this.sPenalty = new Float64Array(this.softBarrierCount);
		this.softBarrierGrid = new SpatialGrid(this.bounds, cellSize);
		const sbg = this.softBarrierGrid;
		for (let i = 0; i < softBarrierSegments.length; i++) {
			const s = softBarrierSegments[i];
			this.sx1[i] = s.ax; this.sy1[i] = s.ay;
			this.sx2[i] = s.bx; this.sy2[i] = s.by;
			this.sminX[i] = s.ax < s.bx ? s.ax : s.bx;
			this.sminY[i] = s.ay < s.by ? s.ay : s.by;
			this.smaxX[i] = s.ax > s.bx ? s.ax : s.bx;
			this.smaxY[i] = s.ay > s.by ? s.ay : s.by;
			this.sPenalty[i] = s.penalty;
			const x0 = sbg.col(this.sminX[i]), x1 = sbg.col(this.smaxX[i]);
			const y0 = sbg.row(this.sminY[i]), y1 = sbg.row(this.smaxY[i]);
			for (let cy = y0; cy <= y1; cy++)
				for (let cx = x0; cx <= x1; cx++) {
					const k = sbg.key(cx, cy);
					let arr = sbg.bins[k];
					if (!arr) { arr = []; sbg.bins[k] = arr; }
					arr.push(i);
				}
		}

		const nodeOwners = [];          // Int32Array per node later
		const nXtmp = [], nYtmp = [];
		const addNode = (x, y, owner) => {
			const k = keyOf(x, y);
			let idx = nodeMap.get(k);
			if (idx === undefined) {
				idx = nXtmp.length;
				nXtmp.push(x); nYtmp.push(y);
				nodeMap.set(k, idx);
				nodeOwners.push([owner]);
			} else if (owner >= 0 && !nodeOwners[idx].includes(owner)) {
				nodeOwners[idx].push(owner);
			}
			return idx;
		};
		for (let pi = 0; pi < polygons.length; pi++) {
			const poly = polygons[pi];
			const n = poly.length / 2;
			for (let i = 0; i < n; i++) addNode(poly[i * 2], poly[i * 2 + 1], pi);
		}
		// Portal vertices — no owner (passable corners).
		for (const p of portals) {
			if (p.kind === 'gate') {
				for (let i = 0; i < GATE_DISC_SEGMENTS; i++) {
					const a = (i / GATE_DISC_SEGMENTS) * Math.PI * 2;
					addNode(p.cx + Math.cos(a) * p.r, p.cy + Math.sin(a) * p.r, -1);
				}
			} else {
				const n = p.poly.length / 2;
				for (let i = 0; i < n; i++) addNode(p.poly[i * 2], p.poly[i * 2 + 1], -1);
			}
		}
		// Clip points — explicit "gateway" nodes where obstacle edges cross
		// portal boundaries. Owned by the obstacle polygon (so incident-edge
		// skipping and diagonal checks work correctly).
		for (const cp of this.clipPoints) addNode(cp.x, cp.y, cp.owner);
		this.nodeCount = nXtmp.length;
		this.nodeX = new Float64Array(nXtmp);
		this.nodeY = new Float64Array(nYtmp);
		// Flatten owner lists into CSR: ownerStarts[i..i+1] → ownerIdx[].
		this.ownerStarts = new Int32Array(this.nodeCount + 1);
		for (let i = 0; i < this.nodeCount; i++) this.ownerStarts[i + 1] = this.ownerStarts[i] + nodeOwners[i].length;
		this.ownerIdx = new Int32Array(this.ownerStarts[this.nodeCount]);
		for (let i = 0, k = 0; i < this.nodeCount; i++)
			for (const o of nodeOwners[i]) this.ownerIdx[k++] = o;
		this.nodePenalty = new Float64Array(this.nodeCount);
		for (let i = 0; i < this.nodeCount; i++) {
			if (this._inPortal(this.nodeX[i], this.nodeY[i])) continue;
			const start = this.ownerStarts[i], end = this.ownerStarts[i + 1];
			for (let k = start; k < end; k++) {
				const owner = this.ownerIdx[k];
				if (owner >= 0 && polyIsWater[owner]) {
					this.nodePenalty[i] = waterNodePenalty;
					break;
				}
				if (owner >= 0 && rawKinds[owner] === 'tower') {
					this.nodePenalty[i] = Math.max(this.nodePenalty[i], towerNodePenalty);
				}
			}
		}
		this.nodePenaltyByKey = new Map();
		for (let i = 0; i < this.nodeCount; i++) {
			if (this.nodePenalty[i] > 0) this.nodePenaltyByKey.set(keyOf(this.nodeX[i], this.nodeY[i]), this.nodePenalty[i]);
		}

		// --- 6. Node spatial grid (bucket node indices) ---
		this.nodeCellSize = opts.nodeCellSize || cellSize;
		this.nodeGrid = new SpatialGrid(this.bounds, this.nodeCellSize);
		const ng = this.nodeGrid;

		// --- 6b. Mark nodes that are inside a WATER polygon they don't own.
		// This catches river-mouth vertices (from the thickened river polyline)
		// that sit inside the water body, shore vertices inside the river
		// strip, etc. Only water/delta/river polygons are tested — building
		// vertices inside other buildings (overlapping obstacles) are NOT
		// blocked, since those are legitimate land points.
		this.nodeBlocked = new Int8Array(this.nodeCount);
		for (let i = 0; i < this.nodeCount; i++) {
			const px = this.nodeX[i], py = this.nodeY[i];
			if (this._inPortal(px, py)) continue;
			const owners = this._nodeOwnerSet(i);
			for (let pi = 0; pi < this.rawPolyBboxes.length; pi++) {
				if (!NODE_BLOCKING_OVERLAP_KINDS.has(this.rawKinds[pi])) continue;
				if (owners.has(pi)) continue;
				const b = this.rawPolyBboxes[pi];
				if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY) continue;
				const poly = this.rawPolygons[pi];
				if (pointInPolygon(px, py, poly) && !_onPolygonBoundary(px, py, poly, 1e-7)) {
					this.nodeBlocked[i] = 1;
					break;
				}
			}
		}

		for (let i = 0; i < this.nodeCount; i++) {
			if (this.nodeBlocked[i]) continue;
			const k = ng.key(ng.col(this.nodeX[i]), ng.row(this.nodeY[i]));
			let arr = ng.bins[k];
			if (!arr) { arr = []; ng.bins[k] = arr; }
			arr.push(i);
		}

		// --- 7. Lazy edge cache: nodeIndex → array of {to, w} ---
		this.adjCache = new Array(this.nodeCount).fill(null);
		this.neighborRing = opts.neighborRing || 8;

		this._losVisited = new Uint32Array(this.blockerCount);
		this._losEpoch = 0;
		this._rawLosVisited = new Uint32Array(this.rawBlockerCount);
		this._rawLosEpoch = 0;
		this._nodeVisited = new Uint32Array(this.nodeCount);
		this._nodeEpoch = 0;

		this.buildTimeMs = (typeof performance !== 'undefined' ? performance.now() : 0) - tStart;
	}

	// ---- Portal hit test (inlines-able; small loop) ----
	_inPortal(px, py) {
		const portals = this.portals;
		for (let i = 0; i < portals.length; i++) {
			const p = portals[i];
			if (p.kind === 'gate') {
				const dx = px - p.cx, dy = py - p.cy;
				if (dx * dx + dy * dy < p.r * p.r) return true;
			} else {
				if (px < p.minX - EPS || px > p.maxX + EPS || py < p.minY - EPS || py > p.maxY + EPS) continue;
				if (pointInPolygon(px, py, p.poly)) return true;
			}
		}
		return false;
	}

	_inRawObstacle(px, py) {
		if (this._inPortal(px, py)) return false;
		const rpg = this.rawPolyGrid;
		const arr = rpg.bins[rpg.key(rpg.col(px), rpg.row(py))];
		if (!arr) return false;
		const polys = this.rawPolygons;
		const bboxes = this.rawPolyBboxes;
		for (let a = 0; a < arr.length; a++) {
			const pi = arr[a];
			const b = bboxes[pi];
			if (px < b.minX - EPS || px > b.maxX + EPS || py < b.minY - EPS || py > b.maxY + EPS) continue;
			if (pointInPolygon(px, py, polys[pi]) && !_onPolygonBoundary(px, py, polys[pi], 1e-7)) return true;
		}
		return false;
	}

	_segmentInteriorBlocked(ax, ay, bx, by) {
		const len = Math.hypot(bx - ax, by - ay);
		const samples = Math.max(4, Math.min(32, Math.ceil(len / 1.5)));
		for (let i = 1; i < samples; i++) {
			const t = i / samples;
			const px = ax + (bx - ax) * t;
			const py = ay + (by - ay) * t;
			if (this._inRawObstacle(px, py)) return true;
		}
		return false;
	}

	// True iff (uIdx, vIdx) are two non-adjacent vertices of the same polygon
	// (a diagonal through the interior). Edge-cross alone misses this case
	// because the diagonal lies entirely inside the polygon and crosses none
	// of its edges. Endpoint coordinates are looked up by index.
	_diagonalBlocked(uIdx, vIdx) {
		const uStart = this.ownerStarts[uIdx], uEnd = this.ownerStarts[uIdx + 1];
		const vStart = this.ownerStarts[vIdx], vEnd = this.ownerStarts[vIdx + 1];
		const ownerIdx = this.ownerIdx;
		for (let i = uStart; i < uEnd; i++) {
			const pi = ownerIdx[i];
			if (pi < 0) continue;
			for (let j = vStart; j < vEnd; j++) {
				if (ownerIdx[j] !== pi) continue;
				// Common polygon pi — find u, v positions in its vertex ring.
				const poly = this.polygons[pi];
				const n = poly.length / 2;
				const ux = this.nodeX[uIdx], uy = this.nodeY[uIdx];
				const vx = this.nodeX[vIdx], vy = this.nodeY[vIdx];
				let uPos = -1, vPos = -1;
				for (let k = 0; k < n; k++) {
					if (uPos < 0 && Math.abs(poly[k * 2] - ux) < EPS && Math.abs(poly[k * 2 + 1] - uy) < EPS) uPos = k;
					if (vPos < 0 && Math.abs(poly[k * 2] - vx) < EPS && Math.abs(poly[k * 2 + 1] - vy) < EPS) vPos = k;
					if (uPos >= 0 && vPos >= 0) break;
				}
				if (uPos < 0 || vPos < 0) continue;
				const diff = Math.abs(uPos - vPos);
				// A polygon ring of length n has wraparound: positions 0 and n-1 are adjacent.
				if (diff !== 1 && diff !== n - 1) return true;
			}
		}
		return false;
	}

	// ---- LOS oracle: is segment (a)→(b) clear of all obstacle edges? ----
	// Hot path — kept tight, uses grid + bbox precheck before segment-cross.
	// Optional uIdx/vIdx enable ownership-aware edge skipping: a blocker edge
	// is only skipped if it shares a coordinate with the endpoint AND belongs
	// to one of the endpoint's own polygons. This prevents paths from sneaking
	// through gaps at vertices shared between different obstacles (e.g. wall
	// segment quads meeting tower circles at wall corners).
	losClear(ax, ay, bx, by, uIdx = -1, vIdx = -1) {
		if (uIdx >= 0 && vIdx >= 0 && this._diagonalBlocked(uIdx, vIdx)) return false;
		const bg = this.blockerGrid;
		const minX = ax < bx ? ax : bx, maxX = ax > bx ? ax : bx;
		const minY = ay < by ? ay : by, maxY = ay > by ? ay : by;
		const x0 = bg.col(minX), x1 = bg.col(maxX);
		const y0 = bg.row(minY), y1 = bg.row(maxY);
		const bx1 = this.bx1, by1 = this.by1, bx2 = this.bx2, by2 = this.by2;
		const bmnX = this.bminX, bmnY = this.bminY, bmxX = this.bmaxX, bmxY = this.bmaxY;
		const bOwner = this.bOwner;
		const epoch = ++this._losEpoch;
		const visited = this._losVisited;
		for (let cy = y0; cy <= y1; cy++) {
			for (let cx = x0; cx <= x1; cx++) {
				const arr = bg.bins[bg.key(cx, cy)];
				if (!arr) continue;
				for (let a = 0; a < arr.length; a++) {
					const bi = arr[a];
					if (visited[bi] === epoch) continue;
					visited[bi] = epoch;
					if (bmxX[bi] < minX - EPS || bmnX[bi] > maxX + EPS) continue;
					if (bmxY[bi] < minY - EPS || bmnY[bi] > maxY + EPS) continue;
					const ex1 = bx1[bi], ey1 = by1[bi], ex2 = bx2[bi], ey2 = by2[bi];
					// Ownership-aware skip: only skip blocker edges that share a
					// coordinate with the endpoint AND belong to one of the
					// endpoint's own polygons. Edges from OTHER polygons at the
					// same coordinate (tower circle at wall corner, adjacent wall
					// quad) are NOT skipped — they can still block the path.
					const owner = bOwner[bi];
					if (owner < 0) {
						if ((Math.abs(ex1 - ax) < POINT_EPS && Math.abs(ey1 - ay) < POINT_EPS) ||
							(Math.abs(ex2 - ax) < POINT_EPS && Math.abs(ey2 - ay) < POINT_EPS) ||
							(Math.abs(ex1 - bx) < POINT_EPS && Math.abs(ey1 - by) < POINT_EPS) ||
							(Math.abs(ex2 - bx) < POINT_EPS && Math.abs(ey2 - by) < POINT_EPS)) continue;
					}
					if (uIdx >= 0 && this._hasOwner(uIdx, owner)) {
						if ((Math.abs(ex1 - ax) < POINT_EPS && Math.abs(ey1 - ay) < POINT_EPS) ||
							(Math.abs(ex2 - ax) < POINT_EPS && Math.abs(ey2 - ay) < POINT_EPS)) continue;
					}
					if (vIdx >= 0 && this._hasOwner(vIdx, owner)) {
						if ((Math.abs(ex1 - bx) < POINT_EPS && Math.abs(ey1 - by) < POINT_EPS) ||
							(Math.abs(ex2 - bx) < POINT_EPS && Math.abs(ey2 - by) < POINT_EPS)) continue;
					}
					if (_segmentsCross(ax, ay, bx, by, ex1, ey1, ex2, ey2)) {
						return false;
					}
				}
			}
		}
		return !this._segmentInteriorBlocked(ax, ay, bx, by);
	}

	// Returns a Set of polygon indices that node `idx` is a vertex of.
	_nodeOwnerSet(idx) {
		const start = this.ownerStarts[idx], end = this.ownerStarts[idx + 1];
		const set = new Set();
		for (let i = start; i < end; i++) {
			const o = this.ownerIdx[i];
			if (o >= 0) set.add(o);
		}
		return set;
	}

	_hasOwner(nodeIdx, owner) {
		const start = this.ownerStarts[nodeIdx], end = this.ownerStarts[nodeIdx + 1];
		for (let i = start; i < end; i++) if (this.ownerIdx[i] === owner) return true;
		return false;
	}

	// ---- Raw LOS oracle: segment clear against NON-dilated obstacle edges ----
	// Used by smoothPath() for post-processing. No ownership-aware edge
	// skipping (path nodes come from the dilated graph; their "owners" don't
	// correspond to raw polygon indices), so we use plain segment-cross.
	losClearRaw(ax, ay, bx, by) {
		const bg = this.rawBlockerGrid;
		const minX = ax < bx ? ax : bx, maxX = ax > bx ? ax : bx;
		const minY = ay < by ? ay : by, maxY = ay > by ? ay : by;
		const x0 = bg.col(minX), x1 = bg.col(maxX);
		const y0 = bg.row(minY), y1 = bg.row(maxY);
		const rx1 = this.rx1, ry1 = this.ry1, rx2 = this.rx2, ry2 = this.ry2;
		const rmnX = this.rminX, rmnY = this.rminY, rmxX = this.rmaxX, rmxY = this.rmaxY;
		const epoch = ++this._rawLosEpoch;
		const rVisited = this._rawLosVisited;
		for (let cy = y0; cy <= y1; cy++) {
			for (let cx = x0; cx <= x1; cx++) {
				const arr = bg.bins[bg.key(cx, cy)];
				if (!arr) continue;
				for (let a = 0; a < arr.length; a++) {
					const bi = arr[a];
					if (rVisited[bi] === epoch) continue;
					rVisited[bi] = epoch;
					if (rmxX[bi] < minX - EPS || rmnX[bi] > maxX + EPS) continue;
					if (rmxY[bi] < minY - EPS || rmnY[bi] > maxY + EPS) continue;
					if (_segmentsCross(ax, ay, bx, by, rx1[bi], ry1[bi], rx2[bi], ry2[bi]))
						return false;
				}
			}
		}
		return !this._segmentInteriorBlocked(ax, ay, bx, by);
	}

	softBarrierPenalty(ax, ay, bx, by) {
		if (!this.softBarrierCount) return 0;
		const minX = ax < bx ? ax : bx, maxX = ax > bx ? ax : bx;
		const minY = ay < by ? ay : by, maxY = ay > by ? ay : by;
		const sx1 = this.sx1, sy1 = this.sy1, sx2 = this.sx2, sy2 = this.sy2;
		const smnX = this.sminX, smnY = this.sminY, smxX = this.smaxX, smxY = this.smaxY;
		if (this.softBarrierCount <= 512) {
			let penalty = 0;
			for (let si = 0; si < this.softBarrierCount; si++) {
				if (smxX[si] < minX - EPS || smnX[si] > maxX + EPS) continue;
				if (smxY[si] < minY - EPS || smnY[si] > maxY + EPS) continue;
				if (_segmentsProperlyCross(ax, ay, bx, by, sx1[si], sy1[si], sx2[si], sy2[si]))
					penalty += this.sPenalty[si];
			}
			return penalty;
		}
		const bg = this.softBarrierGrid;
		const x0 = bg.col(minX), x1 = bg.col(maxX);
		const y0 = bg.row(minY), y1 = bg.row(maxY);
		const seen = new Set();
		let penalty = 0;
		for (let cy = y0; cy <= y1; cy++) {
			for (let cx = x0; cx <= x1; cx++) {
				const arr = bg.bins[bg.key(cx, cy)];
				if (!arr) continue;
				for (let a = 0; a < arr.length; a++) {
					const si = arr[a];
					if (seen.has(si)) continue;
					seen.add(si);
					if (smxX[si] < minX - EPS || smnX[si] > maxX + EPS) continue;
					if (smxY[si] < minY - EPS || smnY[si] > maxY + EPS) continue;
					if (_segmentsProperlyCross(ax, ay, bx, by, sx1[si], sy1[si], sx2[si], sy2[si]))
						penalty += this.sPenalty[si];
				}
			}
		}
		return penalty;
	}

	edgeCost(ax, ay, bx, by) {
		const w = Math.hypot(bx - ax, by - ay);
		const TIEBREAK = 0.001;
		return w + TIEBREAK * w * w + this.softBarrierPenalty(ax, ay, bx, by);
	}

	pointPenalty(x, y) {
		return this.nodePenaltyByKey.get(keyOf(x, y)) || 0;
	}

	pathCost(path, from, to) {
		let cost = 0;
		for (let i = from + 1; i <= to; i++)
			cost += this.edgeCost(path[i - 1].x, path[i - 1].y, path[i].x, path[i].y) + this.pointPenalty(path[i].x, path[i].y);
		return cost;
	}

	pruneVisibleMidpoints(path) {
		if (!path || path.length < 3) return path;
		const out = path.slice();
		let changed = true;
		while (changed) {
			changed = false;
			for (let i = 1; i < out.length - 1; i++) {
				const a = out[i - 1], b = out[i], c = out[i + 1];
				if (!this.losClearRaw(a.x, a.y, c.x, c.y)) continue;
				const scBarrier = this.softBarrierPenalty(a.x, a.y, c.x, c.y);
				if (scBarrier > 0) {
					const origBarrier = this.softBarrierPenalty(a.x, a.y, b.x, b.y) + this.softBarrierPenalty(b.x, b.y, c.x, c.y);
					if (scBarrier > origBarrier) continue;
				}
				out.splice(i, 1);
				changed = true;
				break;
			}
		}
		return out;
	}

	// ---- Path smoothing (string-pulling / line-of-sight simplification) ----
	// Walks the path from start; for each anchor, tries to skip ahead to the
	// farthest node that still has LOS (against the non-dilated edges). This
	// removes micro-jitter from dilation displacement and shortens paths.
	// O(n²) in path length — paths are short (10-30 hops), so plenty fast.
	smoothPath(path) {
		if (!path || path.length < 3) return path;
		const smoothed = [path[0]];
		let anchor = 0;
		while (anchor < path.length - 1) {
			let farthest = anchor + 1;
			const ax = path[anchor].x, ay = path[anchor].y;
			for (let j = path.length - 1; j > anchor + 1; j--) {
				if (!this.losClearRaw(ax, ay, path[j].x, path[j].y)) continue;
				const scBarrier = this.softBarrierPenalty(ax, ay, path[j].x, path[j].y);
				if (scBarrier > 0) {
					let origBarrier = 0;
					for (let m = anchor + 1; m <= j; m++)
						origBarrier += this.softBarrierPenalty(path[m - 1].x, path[m - 1].y, path[m].x, path[m].y);
					if (scBarrier > origBarrier) continue;
				}
				farthest = j;
				break;
			}
			smoothed.push(path[farthest]);
			anchor = farthest;
		}
		return this.pruneVisibleMidpoints(smoothed);
	}

	// ---- Lazy edge expansion: compute visible neighbours of node i ----
	expandNode(i) {
		const cached = this.adjCache[i];
		if (cached) return cached;
		const ux = this.nodeX[i], uy = this.nodeY[i];
		const ng = this.nodeGrid;
		// Collect candidate node indices from cells in `neighborRing` rings.
		const ring = this.neighborRing;
		const cx0 = ng.col(ux), cy0 = ng.row(uy);
		const nodeEpoch = ++this._nodeEpoch;
		const nodeVisited = this._nodeVisited;
		nodeVisited[i] = nodeEpoch;
		const candidates = [];
		for (let dy = -ring; dy <= ring; dy++) {
			for (let dx = -ring; dx <= ring; dx++) {
				const cx = cx0 + dx, cy = cy0 + dy;
				if (cx < 0 || cy < 0 || cx >= ng.cols || cy >= ng.rows) continue;
				const arr = ng.bins[ng.key(cx, cy)];
				if (!arr) continue;
				for (let a = 0; a < arr.length; a++) {
					const j = arr[a];
					if (nodeVisited[j] !== nodeEpoch) { nodeVisited[j] = nodeEpoch; candidates.push(j); }
				}
			}
		}
		const out = [];
		for (let k = 0; k < candidates.length; k++) {
			const j = candidates[k];
			const vx = this.nodeX[j], vy = this.nodeY[j];
			if (!this.losClear(ux, uy, vx, vy, i, j)) continue;
			const w = Math.hypot(vx - ux, vy - uy);
			out.push({ to: j, w, cost: this.edgeCost(ux, uy, vx, vy) + this.nodePenalty[j] });
		}
		this.adjCache[i] = out;
		return out;
	}

	neighbors(i) {
		return this.adjCache[i] || this.expandNode(i);
	}

	// ---- Splice a transient start/goal point into the graph ----
	// Returns { index: -1, x, y, _links: [{to, w}, ...], _isQuery: true }
	// Uses EXPANDING RINGS: starts at neighborRing cells and doubles until
	// at least one visible node is found or the whole grid is covered. This
	// guarantees connectivity for arbitrary click points in open space.
	queryPoint(px, py) {
		if (this._inRawObstacle(px, py)) return { index: -1, x: px, y: py, _links: [], _isQuery: true };
		const ng = this.nodeGrid;
		const cx0 = ng.col(px), cy0 = ng.row(py);
		const maxRing = Math.max(ng.cols, ng.rows);
		let ring = this.neighborRing;
		const links = [];
		while (links.length === 0 && ring <= maxRing) {
			const seen = new Set();
			for (let dy = -ring; dy <= ring; dy++) {
				for (let dx = -ring; dx <= ring; dx++) {
					// Only scan the outer ring border (inner rings already scanned).
					if (Math.abs(dx) !== ring && Math.abs(dy) !== ring && ring > this.neighborRing) continue;
					const cx = cx0 + dx, cy = cy0 + dy;
					if (cx < 0 || cy < 0 || cx >= ng.cols || cy >= ng.rows) continue;
					const arr = ng.bins[ng.key(cx, cy)];
					if (!arr) continue;
					for (let a = 0; a < arr.length; a++) {
						const j = arr[a];
						if (seen.has(j)) continue;
						seen.add(j);
						const vx = this.nodeX[j], vy = this.nodeY[j];
						if (this.losClear(px, py, vx, vy, -1, j)) {
							links.push({ to: j, w: Math.hypot(vx - px, vy - py), cost: this.edgeCost(px, py, vx, vy) + this.nodePenalty[j] });
						}
					}
				}
			}
			if (links.length === 0) ring *= 2;
		}
		return { index: -1, x: px, y: py, _links: links, _isQuery: true };
	}

	// ---- A* over the lazy graph (Euclidean heuristic) ----
	// start, goal may be node indices or {x, y} points (spliced as query points).
	// Off-graph points use expanding-ring queryPoint so they always find visible
	// graph nodes (unless fully enclosed by obstacles).
	astar(start, goal) {
		const startNode = (typeof start === 'number')
			? { index: start, x: this.nodeX[start], y: this.nodeY[start], _links: null, _isQuery: false }
			: this.queryPoint(start.x, start.y);

		// For off-graph goals: precompute which graph nodes can see the goal.
		// A* terminates when any of those nodes is popped → append goal to path.
		const goalIsOffGraph = (typeof goal !== 'number');
		const goalX = goalIsOffGraph ? goal.x : this.nodeX[goal];
		const goalY = goalIsOffGraph ? goal.y : this.nodeY[goal];
		const goalNodeIndex = goalIsOffGraph ? -1 : goal;
		const START_IDX = -2;
		const GOAL_IDX = -3;
		let goalLinkMap = null;
		if (goalIsOffGraph) {
			const goalQuery = this.queryPoint(goal.x, goal.y);
			goalLinkMap = new Map(goalQuery._links.map(l => [l.to, l.w]));
		}

		// Superlinear edge penalty: tiny epsilon * w² added to each hop so
		// ties in total length break toward paths with more short hops (staying
		// local, one side of the street) instead of fewer long hops (switching
		// sides). The penalty is small enough not to dominate real path length
		// but breaks the degenerate case where both sides yield equal length.
		const sgLen = Math.hypot(goalX - startNode.x, goalY - startNode.y);
		const useSgBarrier = sgLen > 5 && this.routeLinePenalty > 0;
		const sgSx = startNode.x, sgSy = startNode.y;
		const sgGx = goalX, sgGy = goalY;

		const h = (nx, ny) => Math.hypot(nx - goalX, ny - goalY);
		const open = [];
		const push = (idx, x, y, g, f, parent) => {
			open.push({ idx, x, y, g, f, parent });
			let i = open.length - 1;
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (open[p].f <= open[i].f) break;
				[open[p], open[i]] = [open[i], open[p]];
				i = p;
			}
		};
		const pop = () => {
			const top = open[0];
			const last = open.pop();
			if (open.length > 0) {
				open[0] = last;
				let i = 0;
				for (;;) {
					const l = 2 * i + 1, r = 2 * i + 2;
					let m = i;
					if (l < open.length && open[l].f < open[m].f) m = l;
					if (r < open.length && open[r].f < open[m].f) m = r;
					if (m === i) break;
					[open[m], open[i]] = [open[i], open[m]];
					i = m;
				}
			}
			return top;
		};

		const closed = new Set();
		const gScore = new Map();
		const startIdx = startNode._isQuery ? START_IDX : startNode.index;
		gScore.set(startIdx, 0);
		push(startIdx, startNode.x, startNode.y, 0, h(startNode.x, startNode.y), null);

		let iterations = 0;
		const MAX_ITER = 100000;
		while (open.length > 0 && iterations++ < MAX_ITER) {
			const cur = pop();
			if (closed.has(cur.idx)) continue;
			closed.add(cur.idx);

			if (!goalIsOffGraph) {
				if (cur.idx === goalNodeIndex) {
					return { path: this.smoothPath(_reconstructPath(cur, goalX, goalY, false)), iterations };
				}
			} else if (cur.idx === GOAL_IDX) {
				return { path: this.smoothPath(_reconstructPath(cur, goalX, goalY, false)), iterations };
			}

			let neighbours = (cur.idx === START_IDX)
				? startNode._links
				: this.neighbors(cur.idx);
			if (goalIsOffGraph) {
				let goalLink = null;
				if (cur.idx === START_IDX) {
					if (this.losClear(cur.x, cur.y, goalX, goalY, -1, -1) &&
						this.losClearRaw(cur.x, cur.y, goalX, goalY))
						goalLink = {
							to: GOAL_IDX,
							w: Math.hypot(goalX - cur.x, goalY - cur.y),
							cost: this.edgeCost(cur.x, cur.y, goalX, goalY),
						};
				} else if (goalLinkMap.has(cur.idx) && this.losClearRaw(cur.x, cur.y, goalX, goalY)) {
					goalLink = {
						to: GOAL_IDX,
						w: goalLinkMap.get(cur.idx),
						cost: this.edgeCost(cur.x, cur.y, goalX, goalY),
					};
				}
				if (goalLink) neighbours = neighbours.length ? neighbours.concat([goalLink]) : [goalLink];
			}
			for (let k = 0; k < neighbours.length; k++) {
				const e = neighbours[k];
				if (closed.has(e.to)) continue;
				const ex = e.to === GOAL_IDX ? goalX : this.nodeX[e.to];
				const ey = e.to === GOAL_IDX ? goalY : this.nodeY[e.to];
				const baseCost = Number.isFinite(e.cost) ? e.cost : this.edgeCost(cur.x, cur.y, ex, ey);
				let sgPenalty = 0;
				if (useSgBarrier && _segmentsProperlyCross(cur.x, cur.y, ex, ey, sgSx, sgSy, sgGx, sgGy)) {
					sgPenalty = this.routeLinePenalty;
				}
				const tentative = cur.g + baseCost + sgPenalty;
				if (gScore.has(e.to) && tentative >= gScore.get(e.to)) continue;
				gScore.set(e.to, tentative);
				push(e.to, ex, ey, tentative, tentative + h(ex, ey), cur);
			}
		}
		return null;
	}
}

// ---------- geometry primitives (module-level, hot) ----------

// Minkowski-sum-with-disc approximation: offset each convex vertex outward
// along the exterior angle bisector by r / sin(θ/2). Reflex vertices are kept
// in place (standard offset-polygon approximation; exact offset would insert
// an arc at each reflex corner). Portal polygons are never dilated — only
// the obstacle polygons passed through `rawPolys` in the constructor.
export function dilatePolygon(pts, r) {
	const n = pts.length;
	if (n < 3 || r === 0) return pts;
	// Winding: signed area > 0 → CCW.
	let area = 0;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
	}
	const ccw = area > 0;
	// Outward normals for each edge (right side of direction for CCW, left for CW).
	const normals = new Array(n);
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
		const len = Math.hypot(dx, dy) || 1;
		if (ccw) normals[i] = { x: dy / len, y: -dx / len };
		else normals[i] = { x: -dy / len, y: dx / len };
	}
	const result = new Array(n);
	for (let i = 0; i < n; i++) {
		const prev = (i - 1 + n) % n;
		const next = (i + 1) % n;
		// Convex vs reflex: cross product of the two adjacent edge vectors.
		const e1x = pts[i].x - pts[prev].x, e1y = pts[i].y - pts[prev].y;
		const e2x = pts[next].x - pts[i].x, e2y = pts[next].y - pts[i].y;
		const cross = e1x * e2y - e1y * e2x;
		const isConvex = ccw ? cross > EPS : cross < -EPS;
		if (!isConvex) {
			// Reflex vertex — keep in place (gap filled by adjacent convex offsets).
			result[i] = { x: pts[i].x, y: pts[i].y };
			continue;
		}
		const na = normals[prev], nb = normals[i];
		const dot = na.x * nb.x + na.y * nb.y;
		// Offset distance = r / sin(θ/2) where θ is interior angle.
		// sin(θ/2) = sqrt((1 + dot) / 2) where dot = cos(exterior angle).
		// Combined with bisector direction (na+nb)/|na+nb|, the vertex offset is:
		//   P' = P + r * (na + nb) / (1 + dot)
		const sumX = na.x + nb.x, sumY = na.y + nb.y;
		if (Math.abs(1 + dot) < 1e-9) {
			result[i] = { x: pts[i].x, y: pts[i].y };
			continue;
		}
		const factor = r / (1 + dot);
		result[i] = { x: pts[i].x + sumX * factor, y: pts[i].y + sumY * factor };
	}
	return result;
}

function _reconstructPath(cur, goalX, goalY, appendGoal) {
	const path = [];
	let n = cur;
	while (n) { path.push({ x: n.x, y: n.y }); n = n.parent; }
	path.reverse();
	if (appendGoal) path.push({ x: goalX, y: goalY });
	return path;
}

function _segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
	// Proper segment intersection (strict). Shared-endpoint touches don't count.
	const o1 = _orient(ax, ay, bx, by, cx, cy);
	const o2 = _orient(ax, ay, bx, by, dx, dy);
	const o3 = _orient(cx, cy, dx, dy, ax, ay);
	const o4 = _orient(cx, cy, dx, dy, bx, by);
	if (o1 !== o2 && o3 !== o4) return true;
	// Collinear overlap: all four points on the same line → check for overlap.
	if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) {
		const abx = bx - ax, aby = by - ay;
		if (Math.abs(abx) >= Math.abs(aby)) {
			const aMin = Math.min(ax, bx), aMax = Math.max(ax, bx);
			const bMin = Math.min(cx, dx), bMax = Math.max(cx, dx);
			return aMin < bMax - EPS && bMin < aMax - EPS;
		} else {
			const aMin = Math.min(ay, by), aMax = Math.max(ay, by);
			const bMin = Math.min(cy, dy), bMax = Math.max(cy, dy);
			return aMin < bMax - EPS && bMin < aMax - EPS;
		}
	}
	return false;
}

function _segmentsProperlyCross(ax, ay, bx, by, cx, cy, dx, dy) {
	const o1 = _orient(ax, ay, bx, by, cx, cy);
	const o2 = _orient(ax, ay, bx, by, dx, dy);
	const o3 = _orient(cx, cy, dx, dy, ax, ay);
	const o4 = _orient(cx, cy, dx, dy, bx, by);
	return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

function _orient(ax, ay, bx, by, px, py) {
	const v = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
	if (v > EPS) return 1;
	if (v < -EPS) return -1;
	return 0;
}

function _onPolygonBoundary(px, py, poly, tol) {
	const tol2 = tol * tol;
	const n = poly.length;
	for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
		if (_pointSegmentDistanceSq(px, py, poly[j], poly[j + 1], poly[i], poly[i + 1]) <= tol2) return true;
	}
	return false;
}

function _pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
	const dx = bx - ax, dy = by - ay;
	const len2 = dx * dx + dy * dy;
	if (len2 <= EPS) {
		const ex = px - ax, ey = py - ay;
		return ex * ex + ey * ey;
	}
	let t = ((px - ax) * dx + (py - ay) * dy) / len2;
	if (t < 0) t = 0;
	else if (t > 1) t = 1;
	const qx = ax + dx * t, qy = ay + dy * t;
	const ex = px - qx, ey = py - qy;
	return ex * ex + ey * ey;
}

function _intersectionPoint(ax, ay, bx, by, cx, cy, dx, dy) {
	const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
	if (Math.abs(denom) < EPS) return null;
	const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
	if (t < -EPS || t > 1 + EPS) return null;
	return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
}

// Parameter t∈[0,1] of the intersection along segment A→B, or null if the
// segments don't properly cross. Used for clipping obstacle edges at portal
// boundaries.
function _segCrossParam(ax, ay, bx, by, cx, cy, dx, dy) {
	const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
	if (Math.abs(denom) < EPS) return null;
	const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
	const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
	if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
	return t;
}

// Clip obstacle polygon edges against portal polygons: edges are split at
// portal boundary crossings, and sub-segments whose midpoint is inside a
// portal are discarded (carving gaps at bridges/gates). Portal boundary edges
// whose midpoint is inside an obstacle polygon become barrier blocker edges
// (confining paths within the portal corridor). Returns {edges, clipPoints}.
function _clipAndBuildBlockers(polygons, polyBboxes, portalPolys, polyIsWater) {
	const inAnyPortalPoly = (px, py) => {
		for (const pp of portalPolys)
			if (pointInPolygon(px, py, pp)) return true;
		return false;
	};
	const inAnyObstaclePoly = (px, py) => {
		for (let i = 0; i < polyBboxes.length; i++) {
			const b = polyBboxes[i];
			if (px < b.minX - EPS || px > b.maxX + EPS || py < b.minY - EPS || py > b.maxY + EPS) continue;
			if (pointInPolygon(px, py, polygons[i])) return true;
		}
		return false;
	};

	const clipPoints = [];
	const edges = [];

	for (let pi = 0; pi < polygons.length; pi++) {
		const poly = polygons[pi];
		const n = poly.length / 2;
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			const ax = poly[i * 2], ay = poly[i * 2 + 1];
			const bx = poly[j * 2], by = poly[j * 2 + 1];
			const breaks = [0];
			for (const pp of portalPolys) {
				const pn = pp.length / 2;
				for (let k = 0; k < pn; k++) {
					const k2 = (k + 1) % pn;
					const t = _segCrossParam(ax, ay, bx, by,
						pp[k * 2], pp[k * 2 + 1], pp[k2 * 2], pp[k2 * 2 + 1]);
					if (t !== null && t > EPS && t < 1 - EPS) {
						breaks.push(t);
						clipPoints.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t, owner: pi });
					}
				}
			}
			breaks.push(1);
			breaks.sort((a, b) => a - b);
			for (let k = 0; k < breaks.length - 1; k++) {
				const t0 = breaks[k], t1 = breaks[k + 1];
				if (t1 - t0 < EPS) continue;
				const mx = ax + (bx - ax) * ((t0 + t1) / 2);
				const my = ay + (by - ay) * ((t0 + t1) / 2);
				if (inAnyPortalPoly(mx, my)) continue;
				edges.push({
					ax: ax + (bx - ax) * t0, ay: ay + (by - ay) * t0,
					bx: ax + (bx - ax) * t1, by: ay + (by - ay) * t1,
					owner: pi,
				});
			}
		}
	}

	for (const pp of portalPolys) {
		const pn = pp.length / 2;
		for (let i = 0; i < pn; i++) {
			const j = (i + 1) % pn;
			const ex1 = pp[i * 2], ey1 = pp[i * 2 + 1];
			const ex2 = pp[j * 2], ey2 = pp[j * 2 + 1];
			const breaks = [0];
			for (let pi = 0; pi < polygons.length; pi++) {
				const poly = polygons[pi];
				const n = poly.length / 2;
				for (let k = 0; k < n; k++) {
					const k2 = (k + 1) % n;
					const t = _segCrossParam(ex1, ey1, ex2, ey2,
						poly[k * 2], poly[k * 2 + 1], poly[k2 * 2], poly[k2 * 2 + 1]);
					if (t !== null && t > EPS && t < 1 - EPS) {
						breaks.push(t);
						clipPoints.push({ x: ex1 + (ex2 - ex1) * t, y: ey1 + (ey2 - ey1) * t, owner: pi });
					}
				}
			}
			breaks.push(1);
			breaks.sort((a, b) => a - b);
			for (let k = 0; k < breaks.length - 1; k++) {
				const t0 = breaks[k], t1 = breaks[k + 1];
				if (t1 - t0 < EPS) continue;
				const mx = ex1 + (ex2 - ex1) * ((t0 + t1) / 2);
				const my = ey1 + (ey2 - ey1) * ((t0 + t1) / 2);
				if (inAnyObstaclePoly(mx, my))
					edges.push({
						ax: ex1 + (ex2 - ex1) * t0, ay: ey1 + (ey2 - ey1) * t0,
						bx: ex1 + (ex2 - ex1) * t1, by: ey1 + (ey2 - ey1) * t1,
						owner: -1,
					});
			}
		}
	}

	return { edges, clipPoints };
}

// ---------- factory (preserves old call site) ----------

export function buildVisibilityGraph(obstacles, opts = {}) {
	return new LazyVisibilityGraph(obstacles, opts);
}

// Back-compat: pointVisible(p, q, graph) → graph.losClear
export function pointVisible(p, q, graph) {
	return graph.losClear(p.x, p.y, q.x, q.y);
}
