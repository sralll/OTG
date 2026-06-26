// CityGen.js — the FIRST part of the MFCG pipeline, ported faithfully from the compiled
// reference (reference/mfcg.js, City.buildPatches + City.optimizeJunctions), with the open-source
// Haxe (TownGeneratorOS) used only as a hint where the minified names are unclear.
//
// Scope: place seeds and build the ward cells. (Walls, streets, water, districts, buildings come
// later.) Output is plain JSON-serializable data so it can drive a renderer or a Django backend.
//
// Determinism: same `seed` -> same cities, because we reproduce the reference's PRNG call order
// exactly (Park–Miller LCG in Random.js: seed = 48271*seed % 2147483647).

import { Random } from './Random.js';
import { Point } from './Point.js';
import { Polygon } from './Polygon.js';
import { Voronoi } from './Voronoi.js';
import { makeFractal } from './Noise.js';
import { buildRiver, smoothShore } from './River.js';
import { addObstacleCrossings, buildCityWall, suppressWallSegmentsOnRiver } from './Walls.js';
import { buildStreets } from './Streets.js';
import { buildDocks } from './Docks.js';
import { amin, remove } from './arrays.js';
import { cathedralRate, createCommonWardGeometry, marketRate, OPEN_TYPES } from './wards.js';
import { clearFeatures, takeFeatures } from './features.js';

// reference constant: pc.LTOWER_RADIUS = 2.5 (used as the junction-merge floor 3*LTOWER_RADIUS)
const LTOWER_RADIUS = 2.5;

function polar(r, a) {
	return new Point(r * Math.cos(a), r * Math.sin(a));
}

function serializePoint(p) {
	return p ? { x: p.x, y: p.y } : null;
}

function serializeBridge(bridge) {
	const point = bridge.point || bridge;
	return {
		...serializePoint(point),
		from: serializePoint(bridge.from),
		to: serializePoint(bridge.to),
	};
}

function serializeDock(dock) {
	return {
		shore: {
			from: serializePoint(dock.shore.from),
			to: serializePoint(dock.shore.to),
		},
		piers: dock.piers.map((pier) => ({
			from: serializePoint(pier.from),
			to: serializePoint(pier.to),
		})),
		large: !!dock.large,
	};
}

function serializeBuilding(building) {
	return {
		polygon: Array.from(building, (v) => ({ x: v.x, y: v.y })),
		class: building.class || 'building',
	};
}

// ---- City.buildPatches (reference) ----
// seeds = origin + phyllotaxis spiral; optional plaza replaces the first 4 ring seeds with a
// diamond (RNG saved/restored so it doesn't shift the rest); Voronoi bounded by a hexagon at 2b;
// cells with any vertex farther than b are dropped; cells sorted by centroid distance.
function buildPatches(size, plazaNeeded, outerRatio = 8) {
	const sa = Random.float() * 2 * Math.PI;
	const points = [new Point(0, 0)];
	let b = 0;
	const seedCount = Math.max(6, Math.ceil(size * outerRatio));
	for (let k = 1; k < seedCount; k++) {
		const r = 10 + k * (2 + Random.float());
		points.push(polar(r, sa + 5 * Math.sqrt(k)));
		if (r > b) b = r;
	}

	if (plazaNeeded) {
		const saved = Random.getSeed();
		const f = 8 + Random.float() * 8;
		const h = f * (1 + Random.float());
		if (h > b) b = h;
		points[1] = polar(f, sa);
		points[2] = polar(h, sa + Math.PI / 2);
		points[3] = polar(f, sa + Math.PI);
		points[4] = polar(h, sa + (3 * Math.PI) / 2);
		Random.reset(saved); // restore RNG so the plaza doesn't perturb later generation
	}

	// Hexagon frame at radius 2b bounds the outer cells (reference: Qd.regular(6, 2*b)).
	const hex = [];
	for (let i = 0; i < 6; i++) hex.push(polar(2 * b, (i / 6) * 2 * Math.PI));

	const voronoi = Voronoi.build(points.concat(hex));
	const regions = voronoi.partioning();

	// cell polygon = the region's circumcenters (shared by reference between adjacent cells)
	let cells = regions.map((r) => new Polygon(r.vertices.map((t) => t.c)));

	// drop cells touching/leaving the seed disk of radius b, and any degenerate/NaN cells
	cells = cells.filter((c) => {
		if (c.length < 3) return false;
		for (const v of c) if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.length > b) return false;
		return true;
	});

	// order by centroid distance from the centre (city is taken from the middle out)
	cells.sort((A, B) => {
		const a = A.centroid;
		const c = B.centroid;
		return a.x * a.x + a.y * a.y - (c.x * c.x + c.y * c.y);
	});

	return { cells, b };
}

// ---- coast (reference: the coastNeeded block at the end of City.buildPatches) ----
// Rotate each cell's centroid by coastDir·π, then flag it as water if it falls inside a noisy
// circle (radius n at g) that opens into a half-plane channel for x>g.x. The RNG used here is
// saved/restored so the coast doesn't shift later generation. Returns the chosen coastDir.
function markCoast(cells, b, coastDir) {
	const saved = Random.getSeed();
	const fractal = makeFractal(6, () => Random.float());
	const f = 20 + Random.float() * 40;
	const k = 0.3 * b * (((Random.float() + Random.float() + Random.float()) / 3) * 2 - 1);
	const n = b * (0.2 + Math.abs((Random.float() + Random.float() + Random.float() + Random.float()) / 2 - 1));
	let dir = coastDir;
	if (dir == null || isNaN(dir)) dir = Math.floor(Random.float() * 20) / 10;
	Random.reset(saved); // restore — coast randomness must not perturb the rest

	const h = dir * Math.PI;
	const q = Math.cos(h);
	const m = Math.sin(h);
	const g = new Point(n + f, k);
	for (const c of cells) {
		const u0 = c.centroid;
		const rx = u0.x * q - u0.y * m;
		const ry = u0.y * q + u0.x * m;
		let u = Math.hypot(g.x - rx, g.y - ry) - n;
		if (rx > g.x) u = Math.min(u, Math.abs(ry - k) - n);
		const r2 = fractal.get((rx + b) / (2 * b), (ry + b) / (2 * b)) * n * Math.sqrt(Math.hypot(rx, ry) / b);
		if (u + r2 < 0) c.water = true;
	}
	return dir;
}

// city = the first `size` non-water cells (reference: the inner/withinCity selection that
// follows the coast block in buildPatches)
function selectCity(cells, size) {
	const inner = [];
	for (const c of cells) {
		if (c.water) continue;
		c.withinCity = true;
		inner.push(c);
		if (inner.length >= size) break;
	}
	return inner;
}

// ---- City.optimizeJunctions (reference) ----
// Collapse edges shorter than an adaptive threshold max(3*LTOWER_RADIUS, perimeter/n/3), only for
// faces with >4 vertices, skipping the outer boundary and tiny (<=4-vertex) neighbours. The
// reference uses a DCEL collapseEdge; here we merge the two shared vertices (vertices are shared
// Point instances, so the merge stays watertight across cells).
function vertexMap(cells) {
	const m = new Map();
	for (const cell of cells)
		for (const v of cell) {
			let arr = m.get(v);
			if (!arr) m.set(v, (arr = []));
			if (!arr.includes(cell)) arr.push(cell);
		}
	return m;
}

function dedupConsecutive(cell) {
	for (let i = cell.length - 1; i >= 0 && cell.length > 3; i--) if (cell[i] === cell[(i + 1) % cell.length]) cell.splice(i, 1);
}

function optimizeJunctions(cells) {
	const vmap = vertexMap(cells);

	let pass = 0;
	let changed = true;
	while (changed && pass++ < 40) {
		changed = false;
		for (const cell of cells) {
			if (cell.length <= 4) continue;
			const k = Math.max(3 * LTOWER_RADIUS, cell.perimeter / cell.length / 3);
			for (let i = 0; i < cell.length; i++) {
				const v0 = cell[i];
				const v1 = cell[(i + 1) % cell.length];
				if (v0 === v1 || Point.distance(v0, v1) >= k) continue;

				const nbrs = (vmap.get(v0) || []).filter((c) => c !== cell && c.includes(v1));
				if (nbrs.length === 0) continue; // boundary edge — keep the disk edge crisp
				if (nbrs.some((c) => c.length <= 4)) continue; // don't collapse into a tiny neighbour

				collapse(vmap, v0, v1);
				changed = true;
				break; // one collapse per face per pass (reference scans the rest of the faces)
			}
		}
	}

	for (const cell of cells) dedupConsecutive(cell);
	return cells;
}

// merge v1 into v0 (v0 moves to the midpoint); every cell referencing v1 now references v0
function collapse(vmap, v0, v1) {
	v0.x = (v0.x + v1.x) / 2;
	v0.y = (v0.y + v1.y) / 2;
	const affected = vmap.get(v1) || [];
	for (const cell of affected) {
		for (let i = 0; i < cell.length; i++) if (cell[i] === v1) cell[i] = v0;
		let arr = vmap.get(v0);
		if (!arr) vmap.set(v0, (arr = []));
		if (!arr.includes(cell)) arr.push(cell);
		dedupConsecutive(cell);
	}
	vmap.delete(v1);
}

// ---- available build-area computation (step 1: inset each ward by edge type) ----

const WALL_THICKNESS = 1.9; // pc.THICKNESS in reference
const DEFAULT_BLOCK_INSET = 0.6;
const ROAD_BLOCK_INSET = 1.0;
const SHORE_PATH_INSET = ROAD_BLOCK_INSET * 2;
const RIVER_CLEARANCE_EPS = 0.25;
const PASSAGE_MARGIN = 1.2;
// Halved from 4.4 (was eating ~half of small blocks near towers). Matches the
// generator's tower-radius (~1.9) + a small passage margin, not a full turret.
const TOWER_CLEARANCE = 2.1;

function addEdgeRef(map, a, b) {
	let s = map.get(a);
	if (!s) map.set(a, (s = new Set()));
	s.add(b);
}

function hasEdgeRef(map, a, b) {
	const s = map.get(a);
	return !!(s && s.has(b));
}

function setMax(map, key, value) {
	const current = map.get(key);
	if (current == null || value > current) map.set(key, value);
}

function buildShoreEdges(cells) {
	const waterEdges = new Map();
	for (const cell of cells) {
		if (!cell.water) continue;
		cell.forEdge((v0, v1) => addEdgeRef(waterEdges, v0, v1));
	}

	const shoreEdges = new Map();
	for (const cell of cells) {
		if (cell.water) continue;
		cell.forEdge((v0, v1) => {
			if (hasEdgeRef(waterEdges, v1, v0)) {
				addEdgeRef(shoreEdges, v0, v1);
				addEdgeRef(shoreEdges, v1, v0);
			}
		});
	}
	return shoreEdges;
}

function isActiveWallEdge(ctx, v0, v1) {
	if (!ctx.wallShape) return false;
	for (let i = 0; i < ctx.wallShape.length; i++) {
		const a = ctx.wallShape[i];
		const b = ctx.wallShape[(i + 1) % ctx.wallShape.length];
		if ((a === v0 && b === v1) || (a === v1 && b === v0)) return ctx.wallSegments == null || ctx.wallSegments[i] !== false;
	}
	return false;
}

function clippedCorner(poly, sourceShape, corner, clearance) {
	if (!poly || poly.length < 3 || !(clearance > 0)) return poly;

	const idx = sourceShape.indexOf(corner);
	if (idx === -1) return poly;
	const prev = sourceShape[(idx + sourceShape.length - 1) % sourceShape.length];
	const next = sourceShape[(idx + 1) % sourceShape.length];
	const prevLen = Point.distance(corner, prev);
	const nextLen = Point.distance(corner, next);
	if (prevLen < 1e-6 || nextLen < 1e-6) return poly;

	// Cap the chamfer at 35% of each adjacent edge (was 45%) and keep >= 65% of the
	// block area (was 55%) so a tower can't wipe out a small block.
	const reach = Math.min(clearance, prevLen * 0.35, nextLen * 0.35);
	if (!(reach > 1e-6)) return poly;

	const a = corner.add(prev.subtract(corner).norm(reach));
	const b = corner.add(next.subtract(corner).norm(reach));
	const halves = poly.cut(a, b);
	if (halves.length < 2) return poly;

	let best = poly;
	let bestDistance = -Infinity;
	const minKeptArea = Math.abs(poly.square) * 0.65;
	for (const half of halves) {
		if (!half || half.length < 3 || Math.abs(half.square) < minKeptArea) continue;
		const d = Point.distance(half.center, corner);
		if (d > bestDistance) {
			best = half;
			bestDistance = d;
		}
	}
	return best;
}

function clipObstacleCorners(poly, sourceShape, nodeClearance) {
	let clipped = poly;
	for (const v of sourceShape) {
		const clearance = nodeClearance.get(v) || 0;
		if (clearance > 0) clipped = clippedCorner(clipped, sourceShape, v, clearance);
		if (!clipped || clipped.length < 3) return poly; // fall back to the un-clipped block
	}
	return clipped || poly;
}

function lineSignedDistance(a, b, p) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (!(len > 1e-6)) return 0;
	return ((dx * (p.y - a.y)) - (dy * (p.x - a.x))) / len;
}

function sideForCell(cell, a, b) {
	let side = lineSignedDistance(a, b, cell.centroid);
	if (Math.abs(side) < 1e-6) {
		for (const v of cell) {
			const d = lineSignedDistance(a, b, v);
			if (Math.abs(d) > Math.abs(side)) side = d;
		}
	}
	return side >= 0 ? 1 : -1;
}

function clipToOffsetSide(poly, a, b, side, clearance) {
	if (!poly || poly.length < 3 || clearance == null || clearance < 0) return poly;
	if (Point.distance(a, b) < 1e-6) return poly;

	const out = [];
	let prev = poly[poly.length - 1];
	let prevD = side * lineSignedDistance(a, b, prev);
	let prevInside = prevD >= clearance - 1e-6;
	for (const cur of poly) {
		const curD = side * lineSignedDistance(a, b, cur);
		const curInside = curD >= clearance - 1e-6;
		if (curInside !== prevInside) {
			const denom = curD - prevD;
			if (Math.abs(denom) > 1e-9) {
				const t = (clearance - prevD) / denom;
				out.push(new Point(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t));
			}
		}
		if (curInside) out.push(cur);
		prev = cur;
		prevD = curD;
		prevInside = curInside;
	}
	const clipped = new Polygon(out);
	return clipped.length >= 3 && Math.abs(clipped.square) > 1e-6 ? clipped : null;
}

function cutAwayFromSegment(poly, cell, a, b, clearance) {
	const clipped = clipToOffsetSide(poly, a, b, sideForCell(cell, a, b), clearance);
	if (!clipped || clipped.length < 3) return poly;
	if (Math.abs(clipped.square) < Math.abs(poly.square) * 0.01) return poly;
	return clipped;
}

function pointSegmentDistance(p, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy || 1;
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function pointInPolygon(point, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		const crosses = (a.y > point.y) !== (b.y > point.y);
		if (crosses) {
			const x = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
			if (point.x < x) inside = !inside;
		}
	}
	return inside;
}

function pointPolygonDistance(point, poly) {
	let best = Infinity;
	poly.forEdge((a, b) => {
		best = Math.min(best, pointSegmentDistance(point, a, b));
	});
	return best;
}

function chaikinSmooth(pts, iterations) {
	if (!pts || pts.length < 3) return pts || [];
	let a = pts;
	for (let it = 0; it < iterations; it++) {
		const h = [a[0]];
		for (let i = 1, n = a.length - 1; i < n; i++) {
			const g = a[i], p = a[i - 1], nx = a[i + 1];
			h.push(new Point(g.x * 0.75 + p.x * 0.25, g.y * 0.75 + p.y * 0.25));
			h.push(new Point(g.x * 0.75 + nx.x * 0.25, g.y * 0.75 + nx.y * 0.25));
		}
		h.push(a[a.length - 1]);
		a = h;
	}
	return a;
}

function sampledRiverCourse(river) {
	if (!river || !river.course || river.course.length < 2) return [];
	const course = river.delta
		? [new Point((river.course[0].x + river.course[1].x) / 2, (river.course[0].y + river.course[1].y) / 2), ...river.course.slice(1)]
		: river.course;
	return chaikinSmooth(course, 3);
}

function pathTouchesCell(path, cell, clearance) {
	for (const p of path)
		if (pointInPolygon(p, cell) || pointPolygonDistance(p, cell) <= clearance)
			return true;
	return false;
}

function minDistanceToPolyline(poly, path) {
	if (!poly || poly.length < 3 || !path || path.length < 2) return Infinity;
	let best = Infinity;
	for (const v of poly)
		for (let i = 0; i < path.length - 1; i++)
			best = Math.min(best, pointSegmentDistance(v, path[i], path[i + 1]));
	return best;
}

function nearestVertexToPolyline(poly, path) {
	let best = { distance: Infinity, segment: -1 };
	if (!poly || poly.length < 3 || !path || path.length < 2) return best;
	for (const v of poly) {
		for (let i = 0; i < path.length - 1; i++) {
			const d = pointSegmentDistance(v, path[i], path[i + 1]);
			if (d < best.distance) best = { distance: d, segment: i };
		}
	}
	return best;
}

function cellHasActiveWallEdge(cell, ctx) {
	if (!ctx || !ctx.wallShape) return false;
	let hasWall = false;
	cell.forEdge((v0, v1) => {
		if (isActiveWallEdge(ctx, v0, v1)) hasWall = true;
	});
	return hasWall;
}

function clipRiverObstacle(poly, cell, river, detectionExtra = 0) {
	const path = sampledRiverCourse(river);
	if (path.length < 2) return poly;
	const clearance = river.width / 2 + SHORE_PATH_INSET + RIVER_CLEARANCE_EPS;
	if (!pathTouchesCell(path, cell, clearance + detectionExtra) && !pathTouchesCell(path, poly, clearance + detectionExtra))
		return poly;

	let clipped = poly;
	for (let pass = 0; pass < 12; pass++) {
		const nearest = nearestVertexToPolyline(clipped, path);
		if (nearest.distance >= clearance - 1e-6 || nearest.segment < 0) return clipped;
		const before = Math.abs(clipped.square);
		const next = cutAwayFromSegment(clipped, cell, path[nearest.segment], path[nearest.segment + 1], clearance);
		if (!next || next.length < 3) return null;
		if (Math.abs(before - Math.abs(next.square)) < 1e-6) break;
		clipped = next;
	}

	// If a tiny remnant still lies under the water stroke itself, drop that remnant rather
	// than drawing a grey shard below the river.
	return minDistanceToPolyline(clipped, path) < river.width / 2 ? null : clipped;
}

function cleanupBuildablePolygon(poly) {
	if (!poly || poly.length < 3) return null;
	const cleaned = new Polygon(poly);
	const minArea = 2;
	for (let pass = 0; pass < 8 && cleaned.length > 3; pass++) {
		let removed = false;
		for (let i = 0; i < cleaned.length; i++) {
			const a = cleaned[(i + cleaned.length - 1) % cleaned.length];
			const b = cleaned[i];
			const c = cleaned[(i + 1) % cleaned.length];
			const prevLen = Point.distance(a, b);
			const nextLen = Point.distance(b, c);
			const base = Point.distance(a, c);
			const height = base > 1e-6 ? Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / base : 0;
			const ux = a.x - b.x, uy = a.y - b.y;
			const vx = c.x - b.x, vy = c.y - b.y;
			const ul = Math.hypot(ux, uy), vl = Math.hypot(vx, vy);
			const cos = ul > 1e-6 && vl > 1e-6 ? (ux * vx + uy * vy) / (ul * vl) : -1;
			if (Math.min(prevLen, nextLen) < 1.2 || height < 1.0 || (cos > Math.cos(Math.PI / 3) && height < 2.0)) {
				cleaned.splice(i, 1);
				removed = true;
				break;
			}
		}
		if (!removed) break;
	}
	return cleaned.length >= 3 && Math.abs(cleaned.square) >= minArea ? cleaned : null;
}

function computeAvailableArea(cell, ctx) {
	const edgeInsets = [];
	cell.forEdge((v0, v1) => {
		let inset = DEFAULT_BLOCK_INSET;
		if (hasEdgeRef(ctx.riverEdges, v0, v1) || hasEdgeRef(ctx.riverEdges, v1, v0))
			inset = Math.max(inset, ctx.riverWidth / 2 + SHORE_PATH_INSET + RIVER_CLEARANCE_EPS);
		if (hasEdgeRef(ctx.shoreEdges, v0, v1) || hasEdgeRef(ctx.shoreEdges, v1, v0))
			inset = Math.max(inset, SHORE_PATH_INSET);
		if (isActiveWallEdge(ctx, v0, v1)) inset = Math.max(inset, WALL_THICKNESS + PASSAGE_MARGIN);
		for (const road of ctx.roads) {
			if (road.includes(v0) && road.includes(v1)) {
				inset = Math.max(inset, ROAD_BLOCK_INSET);
				break;
			}
		}
		if (ctx.plazaCell && ctx.plazaCell.findEdge(v1, v0) !== -1) inset = Math.max(inset, ROAD_BLOCK_INSET);
		edgeInsets.push(inset);
	});
	try {
		const base = cell.isConvex() ? cell.shrink(edgeInsets) : cell.buffer(edgeInsets);
		const riverDetectionExtra = cellHasActiveWallEdge(cell, ctx) ? WALL_THICKNESS : 0;
		const riverClipped = clipRiverObstacle(base, cell, ctx.riverData, riverDetectionExtra);
		if (!riverClipped || riverClipped.length < 3) return null;
		return cleanupBuildablePolygon(clipObstacleCorners(riverClipped, cell, ctx.nodeClearance));
	} catch (e) { return null; }
}

function buildBuildings(cells, inner, center, wallData, streetData, riverData, plazaEnabled) {
	if (!inner || inner.length === 0 || !center) return { blocks: [], buildings: [], alleys: [], wardTypes: new Map() };

	// River edges map (shared Point identity)
	const riverEdges = new Map();
	const nodeClearance = new Map();
	if (riverData && riverData.course) {
		for (let i = 0; i < riverData.course.length - 1; i++) {
			const a = riverData.course[i], b = riverData.course[i + 1];
			addEdgeRef(riverEdges, a, b);
			addEdgeRef(riverEdges, b, a);
		}
		for (const v of riverData.course) setMax(nodeClearance, v, riverData.width / 2 + SHORE_PATH_INSET + RIVER_CLEARANCE_EPS);
	}
	if (wallData && wallData.towers) for (const t of wallData.towers) setMax(nodeClearance, t, TOWER_CLEARANCE);
	const shoreEdges = buildShoreEdges(cells);

	const plazaCell = plazaEnabled && inner.length > 0 ? inner[0] : null;
	const arteries = (streetData && streetData.arteries) || [];

	// Lightweight model adapter for cathedralRate / marketRate
	const patchMap = new Map();
	const patches = [];
	for (const cell of cells) {
		const p = { shape: cell, type: null, withinCity: !!cell.withinCity, isWater: !!cell.water };
		patches.push(p);
		patchMap.set(cell, p);
	}
	const innerPatches = inner.map((c) => patchMap.get(c));
	const model = {
		center, inner: innerPatches, patches,
		plaza: plazaCell ? patchMap.get(plazaCell) : null,
		arteries,
		gates: wallData ? wallData.gates : [],
		cityRadius: 1,
		patchByVertex: (v) => patches.filter((p) => p.shape.contains(v)),
		getNeighbours: (patch) => patches.filter((p) => p !== patch && p.shape.borders(patch.shape)),
	};
	model.getNeighbour = (patch, v) => {
		const next = patch.shape.next(v);
		return patches.find((p) => p !== patch && p.shape.findEdge(next, v) !== -1) || null;
	};
	model.isEnclosed = (patch) => patch.withinCity && model.getNeighbours(patch).every((p) => p.withinCity);

	// --- assign ward types ---
	if (model.plaza) model.plaza.type = 'plaza';
	const unassigned = innerPatches.filter((p) => p !== model.plaza);

	if (unassigned.length > 0) {
		const pick = amin(unassigned, (p) => cathedralRate(model, p));
		pick.type = 'cathedral';
		remove(unassigned, pick);
	}
	let squares = 2;
	while (squares-- > 0 && unassigned.length > 0) {
		const pick = amin(unassigned, (p) => marketRate(model, p));
		pick.type = 'market';
		remove(unassigned, pick);
	}
	if (wallData) {
		for (const gate of wallData.gates)
			for (const p of patches)
				if (p.withinCity && p.type == null && p.shape.contains(gate)) p.type = 'gate';
	}
	for (const p of unassigned) if (p.type == null) p.type = 'generic';
	for (const p of patches) {
		if (!p.withinCity && !p.isWater && p.type == null)
			p.type = Random.bool(0.2) && p.shape.compactness >= 0.7 ? 'farm' : 'generic';
		if (p.type == null) p.type = 'generic';
	}
	for (const p of innerPatches)
		for (const v of p.shape)
			model.cityRadius = Math.max(model.cityRadius, Point.distance(v, center));

	// --- compute available build areas (one inset polygon per ward) ---
	// Use pre-smoothed streets/roads for edge matching (shared Point identity);
	// smoothed arteries have new Point objects that won't match cell vertices.
	const rawRoads = [];
	if (streetData) {
		if (streetData.streets) rawRoads.push(...streetData.streets);
		if (streetData.roads) rawRoads.push(...streetData.roads);
	}

	const ctx = {
		riverEdges, riverWidth: riverData ? riverData.width : 0,
		riverData,
		shoreEdges, nodeClearance,
		roads: rawRoads, plazaCell,
		wallShape: wallData ? wallData.shape : null,
		wallSegments: wallData ? wallData.segments : null,
	};

	const blocks = [];
	const buildings = [];
	const alleys = [];
	for (const p of patches) {
		if (OPEN_TYPES.has(p.type) || p.isWater) continue;
		const avail = computeAvailableArea(p.shape, ctx);
		if (avail && avail.length >= 3) {
			p.block = avail;
			blocks.push(avail);
			if ((p.type === 'generic' || p.type === 'gate') && p.withinCity) {
				for (const b of createCommonWardGeometry(model, p, { main: 2.0, regular: 1.0, alley: 0.8 })) buildings.push(b);
				if (p.alleys) alleys.push(...p.alleys);
			}
		}
	}

	const wardTypes = new Map();
	for (const p of patches) wardTypes.set(p.shape, p.type);

	return { blocks, buildings, alleys, wardTypes };
}

// ---- public entry ----
export function generateWards(params = {}) {
	let seed = params.seed;
	if (!(seed > 0)) seed = Math.trunc(Date.now() % 2147483647) || 1;
	const size = params.size != null ? params.size : 15;
	const plaza = params.plaza !== false;
	const coast = params.coast !== false;
	const river = params.river !== false;
	const walls = params.walls !== false;
	const streets = params.streets !== false;
	const gateCount = Number.isFinite(params.gates) && params.gates >= 0 ? Math.trunc(params.gates) : null;
	const roadDensity = Number.isFinite(params.roadDensity) ? Math.max(0, params.roadDensity) : 1;
	const outerRatio = Number.isFinite(params.outerRatio) ? Math.max(4, params.outerRatio) : 8;
	const coastDir = params.coastDir; // number in [0,2) (×π); undefined -> random

	Random.reset(seed);

	let result = null;
	for (let attempt = 0; attempt < 20 && result == null; attempt++) {
		try {
			const { cells, b } = buildPatches(size, plaza, outerRatio);
			// coast (mark water cells) BEFORE city selection, then optimise junctions — order as
			// in the reference (coast + inner selection end buildPatches, optimizeJunctions next).
			if (coast) markCoast(cells, b, coastDir);
			const inner = selectCity(cells, size);
			optimizeJunctions(cells);
			if (coast) smoothShore(cells); // reference smooths the waterEdge in buildDomains
			const center = inner.length ? amin(inner[0], (v) => v.length) : null;
			const wallData = walls && inner.length ? buildCityWall(cells, inner, { real: true, gates: gateCount }) : null;
			const roadOpts = {
				plazaCell: plaza ? inner[0] : null,
				roadsPerGate: roadDensity >= 2.4 ? 3 : roadDensity >= 1.4 ? 2 : 1,
				extraInner: Math.round(size * Math.max(0, roadDensity - 1) * 0.35),
			};
			const streetData = streets && wallData && center && roadDensity > 0 ? buildStreets(cells, inner, center, wallData, roadOpts) : { streets: [], roads: [], arteries: [] };
			const riverData = river && center ? buildRiver(cells, center, { innerCells: inner }) : null;
			if (wallData && riverData) suppressWallSegmentsOnRiver(wallData, riverData);
			if (wallData || riverData) addObstacleCrossings(cells, wallData, riverData);
			const dockData = buildDocks(cells, inner, { river: riverData });
			if (inner.length >= Math.min(size, 4)) result = { cells, b, inner, center, river: riverData, wall: wallData, streets: streetData, docks: dockData };
		} catch (e) {
			result = null; // degenerate Voronoi / coast -> retry (RNG advanced, like the reference)
		}
	}
	if (result == null) throw new Error('ward generation failed');

	// Collect chamfer "features" (trees/fountains dropped where corner triangles are cut
	// off) only from the surviving generation, not from any discarded retries above.
	clearFeatures();
	const { blocks, buildings, alleys, wardTypes } = buildBuildings(
		result.cells, result.inner, result.center,
		result.wall, result.streets, result.river, plaza
	);
	const features = takeFeatures();

	const wards = result.cells.map((cell) => ({
		polygon: cell.map((v) => ({ x: v.x, y: v.y })),
		inner: !!cell.withinCity,
		water: !!cell.water,
		landing: !!cell.landing,
		type: wardTypes.get(cell) || 'generic',
	}));

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const w of wards)
		for (const p of w.polygon) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}

	return {
		seed,
		size,
		plaza,
		walls,
		streets,
		gates: gateCount,
		roadDensity,
		outerRatio,
		b: result.b,
		bounds: { minX, minY, maxX, maxY },
		wards,
		center: result.center ? { x: result.center.x, y: result.center.y } : null,
		river: result.river
			? {
					...result.river,
					bridges: (result.river.bridges || []).map(serializeBridge),
				}
			: null,
		wall: result.wall
			? {
					shape: result.wall.shape.map((v) => ({ x: v.x, y: v.y })),
					gates: result.wall.gates.map((v) => ({ x: v.x, y: v.y })),
					crossingGates: (result.wall.crossingGates || []).map((v) => ({ x: v.x, y: v.y })),
					towers: result.wall.towers.map((v) => ({ x: v.x, y: v.y })),
					segments: result.wall.segments.slice(),
				}
			: null,
		roads: result.streets
			? {
					streets: result.streets.streets.map((road) => road.map((v) => ({ x: v.x, y: v.y }))),
					roads: result.streets.roads.map((road) => road.map((v) => ({ x: v.x, y: v.y }))),
					arteries: result.streets.arteries.map((road) => road.map((v) => ({ x: v.x, y: v.y }))),
				}
			: { streets: [], roads: [], arteries: [] },
		docks: (result.docks || []).map(serializeDock),
		blocks: blocks.map((b) => Array.from(b, (v) => ({ x: v.x, y: v.y }))),
		buildings: buildings.map(serializeBuilding),
		alleys: alleys.map((a) => Array.from(a, (v) => ({ x: v.x, y: v.y }))),
		features,
	};
}
