// wards.js — the part of the Ward hierarchy we need:
//  - getCityBlock(): shrink a patch into a block, leaving per-edge room for roads.
//  - placement heuristics for the cathedral and extra market squares.
//  - building subdivision (createAlleys / createOrthoBuilding + Cutter) that fills wards
//    with organic building lots, ported from Ward.hx / the ward subclasses.

import { Point } from './Point.js';
import { Polygon } from './Polygon.js';
import { GeomUtils } from './GeomUtils.js';
import { Random } from './Random.js';
import { Cutter } from './Cutter.js';
import { amin } from './arrays.js';
import { sliceWardEdgeElbows } from './AlleySlicer.js';
import { recordRemovedTriangle } from './features.js';

// Open patch types are kept as open space (no shrunken block). 'water' included so water
// cells are never shrunk into blocks.
export const OPEN_TYPES = new Set(['plaza', 'market', 'park', 'water']);

function hasRiverEdge(model, v0, v1) {
	const riverEdges = model.riverEdges;
	return !!(
		riverEdges &&
		((riverEdges.get(v0) && riverEdges.get(v0).has(v1)) || (riverEdges.get(v1) && riverEdges.get(v1).has(v0)))
	);
}

function isShoreEdge(model, v0, v1) {
	if (!model.patchByVertex) return false;
	const edgePatches = model.patchByVertex(v0).filter((p) => p.shape.findEdge(v0, v1) !== -1 || p.shape.findEdge(v1, v0) !== -1);
	return edgePatches.some((p) => p.isWater) && edgePatches.some((p) => !p.isWater);
}

function isShoreVertex(model, v) {
	if (!model.patchByVertex) return false;
	const patches = model.patchByVertex(v);
	return patches.some((p) => p.isWater) && patches.some((p) => !p.isWater);
}

// A ward corner that lands on the wall ring, where the wall is actually built (at least
// one adjacent segment active — same condition as tower placement in rebuildTowers). Plain
// wall vertices need a corner chamfer too, not just the edge-level wall clipping; otherwise a
// sharp ward tip pokes through the wall cap where no single ward edge runs along the wall.
function isBuiltWallVertex(wall, v) {
	if (!wall || !wall.shape) return false;
	const i = wall.shape.indexOf(v);
	if (i === -1) return false;
	const len = wall.shape.length;
	if (!wall.segments) return true;
	return wall.segments[i] || wall.segments[(i + len - 1) % len];
}

function nodeClearance(model, v, widths) {
	const clearances = obstacleClearances(model, widths);
	let clearance = 0;
	if (model.water && model.water.riverPath && model.water.riverPath.includes(v))
		clearance = Math.max(clearance, clearances.river);
	if (isShoreVertex(model, v))
		clearance = Math.max(clearance, clearances.shore);
	if (model.wall && model.wall.towers && model.wall.towers.includes(v))
		clearance = Math.max(clearance, clearances.tower);
	if (model.citadelWall && model.citadelWall.towers && model.citadelWall.towers.includes(v))
		clearance = Math.max(clearance, clearances.tower);
	if (isBuiltWallVertex(model.wall, v) || isBuiltWallVertex(model.citadelWall, v))
		clearance = Math.max(clearance, clearances.wall);
	return clearance;
}

function clippedCorner(poly, sourceShape, corner, clearance) {
	if (!poly || poly.length < 3 || !(clearance > 0)) return poly;

	const idx = sourceShape.indexOf(corner);
	if (idx === -1) return poly;
	const dir = sourceShape.centroid.subtract(corner);
	if (dir.length > 1e-6) {
		dir.normalize(1);
		const n = new Point(-dir.y, dir.x);
		const cutCenter = corner.add(dir.scale(clearance));
		const capped = clipToOffsetSide(poly, cutCenter.subtract(n), cutCenter.add(n), -1, 0);
		if (capped && capped.length >= 3 && Math.abs(capped.square) >= Math.abs(poly.square) * 0.01)
			return capped;
	}

	const prev = sourceShape[(idx + sourceShape.length - 1) % sourceShape.length];
	const next = sourceShape[(idx + 1) % sourceShape.length];
	const prevLen = Point.distance(corner, prev);
	const nextLen = Point.distance(corner, next);
	if (prevLen < 1e-6 || nextLen < 1e-6) return poly;

	// Point obstacles (river nodes, shore corners, towers) need more than a token
	// chamfer, because the rendered river/wall cap can occupy the corner even when no
	// whole ward edge faces it.
	const reach = Math.min(clearance, prevLen * 0.65, nextLen * 0.65);
	if (!(reach > 1e-6)) return poly;

	const a = corner.add(prev.subtract(corner).norm(reach));
	const b = corner.add(next.subtract(corner).norm(reach));
	const halves = poly.cut(a, b);
	if (halves.length < 2) return poly;

	let best = poly;
	let bestDistance = -Infinity;
	const minKeptArea = Math.abs(poly.square) * 0.35;
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

function clipObstacleCorners(poly, sourceShape, model, widths) {
	let clipped = poly;
	for (const v of sourceShape) {
		const clearance = nodeClearance(model, v, widths);
		if (clearance > 0) clipped = clippedCorner(clipped, sourceShape, v, clearance);
		if (!clipped || clipped.length < 3) return poly; // fall back to the un-clipped block
	}
	return clipped || poly;
}

function passageMargin(widths) {
	return Math.max(widths.regular || 0, (widths.main || 0) * 0.6, 0.8);
}

function obstacleClearances(model, widths) {
	const passage = passageMargin(widths);
	return {
		river: (model.riverWidth || 0) * 0.59 + passage,
		// Shore is one-sided: roads get their width from two blocks each inset by
		// regular/2, so the coast needs one full regular width for the same path.
		shore: Math.max(widths.regular || 0, 0.6),
		wall: Math.max((widths.main || 0) * 0.45, 0.6) + passage,
		tower: Math.max((widths.main || 0) * 0.4, 0.4) + passage,
	};
}

function lineSignedDistance(a, b, p) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (!(len > 1e-6)) return 0;
	return ((dx * (p.y - a.y)) - (dy * (p.x - a.x))) / len;
}

function sideForShape(shape, a, b) {
	let side = lineSignedDistance(a, b, shape.centroid);
	if (Math.abs(side) < 1e-6) {
		for (const v of shape) {
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

function cutAwayFromSegment(poly, sourceShape, a, b, clearance) {
	const clipped = clipToOffsetSide(poly, a, b, sideForShape(sourceShape, a, b), clearance);
	if (!clipped || clipped.length < 3) return poly;
	if (Math.abs(clipped.square) < Math.abs(poly.square) * 0.01) return poly;
	return clipped;
}

function cutAwayFromPoint(poly, sourceShape, point, clearance) {
	const dir = sourceShape.centroid.subtract(point);
	if (!poly || poly.length < 3 || !(clearance > 0) || dir.length < 1e-6) return poly;
	dir.normalize(1);
	const n = new Point(-dir.y, dir.x);
	const cutCenter = point.add(dir.scale(clearance));
	const clipped = clipToOffsetSide(poly, cutCenter.subtract(n), cutCenter.add(n), -1, 0);
	if (!clipped || clipped.length < 3) return poly;
	if (Math.abs(clipped.square) < Math.abs(poly.square) * 0.01) return poly;
	return clipped;
}

function norm(x, y) {
	const l = Math.hypot(x, y) || 1;
	return { x: x / l, y: y / l };
}

function cubicPoint(a, c1, c2, b, t) {
	const mt = 1 - t;
	const mt2 = mt * mt;
	const t2 = t * t;
	return new Point(
		a.x * mt2 * mt + 3 * c1.x * mt2 * t + 3 * c2.x * mt * t2 + b.x * t2 * t,
		a.y * mt2 * mt + 3 * c1.y * mt2 * t + 3 * c2.y * mt * t2 + b.y * t2 * t
	);
}

function smoothPathSegments(pts, samplesPerSegment = 16) {
	if (!pts || pts.length < 2) return [];
	if (pts.length === 2) return [{ from: pts[0], to: pts[1], samples: [pts[0], pts[1]] }];

	const extrap = (a, b, c) => {
		const ax = b.x - a.x;
		const ay = b.y - a.y;
		const bx = c.x - b.x;
		const by = c.y - b.y;
		const d = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
		const sin = (ax * by - ay * bx) / d;
		const cos = (ax * bx + ay * by) / d;
		return new Point(c.x + (bx * cos - by * sin), c.y + (by * cos + bx * sin));
	};

	const a = [extrap(pts[2], pts[1], pts[0]), ...pts, extrap(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1])];
	const segments = [];
	for (let k = 1; k < a.length - 2; k++) {
		const g = a[k];
		const m = a[k + 1];
		const p = a[k + 2];
		const inD = norm(g.x - a[k - 1].x, g.y - a[k - 1].y);
		const segD = norm(m.x - g.x, m.y - g.y);
		const outD = norm(p.x - m.x, p.y - m.y);
		const tN = norm(inD.x + segD.x, inD.y + segD.y);
		const tP = norm(segD.x + outD.x, segD.y + outD.y);
		const len = Point.distance(g, m);
		let w = 1 / (1 + (tN.x * segD.x + tN.y * segD.y) + (tP.x * segD.x + tP.y * segD.y));
		if (!isFinite(w) || w < 0) w = 1 / 3;
		const q = len * Math.min(w, 1);
		const c1 = new Point(g.x + tN.x * q, g.y + tN.y * q);
		const c2 = new Point(m.x - tP.x * q, m.y - tP.y * q);
		const samples = [];
		for (let i = 0; i <= samplesPerSegment; i++) samples.push(cubicPoint(g, c1, c2, m, i / samplesPerSegment));
		segments.push({ from: g, to: m, samples });
	}
	return segments;
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

function pathSamplesTouchShape(samples, shape, clearance) {
	for (const p of samples)
		if (pointInPolygon(p, shape) || pointPolygonDistance(p, shape) <= clearance)
			return true;
	return false;
}

function clipFromPathObstacle(poly, sourceShape, path, clearance) {
	let clipped = poly;
	let touched = false;
	const sampledPath = [];
	for (const seg of smoothPathSegments(path)) {
		if (!pathSamplesTouchShape(seg.samples, sourceShape, clearance)) continue;
		touched = true;
		if (sampledPath.length === 0) sampledPath.push(seg.samples[0]);
		for (let i = 1; i < seg.samples.length; i++) sampledPath.push(seg.samples[i]);
		for (const p of seg.samples) clipped = cutAwayFromPoint(clipped, sourceShape, p, clearance);
		for (let i = 0; i < seg.samples.length - 1; i++)
			clipped = cutAwayFromSegment(clipped, sourceShape, seg.samples[i], seg.samples[i + 1], clearance);
	}
	if (touched && minDistanceToPolyline(clipped, sampledPath) < clearance * 0.9) return null;
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

function minDistanceToPolyline(poly, path) {
	if (!poly || poly.length < 3 || !path || path.length < 2) return Infinity;
	let best = Infinity;
	for (const v of poly)
		for (let i = 0; i < path.length - 1; i++)
			best = Math.min(best, pointSegmentDistance(v, path[i], path[i + 1]));
	return best;
}

function activeWallEdges(wall) {
	const out = [];
	if (!wall || !wall.shape) return out;
	for (let i = 0; i < wall.shape.length; i++) {
		if (wall.segments && wall.segments[i] === false) continue;
		out.push([wall.shape[i], wall.shape[(i + 1) % wall.shape.length]]);
	}
	return out;
}

function clipFromWallObstacle(poly, sourceShape, patch, wall, clearance) {
	if (!wall || !wall.shape) return poly;
	let clipped = poly;
	for (const [a, b] of activeWallEdges(wall)) {
		const bordersPatch =
			patch != null && typeof wall.bordersBy === 'function'
				? wall.bordersBy(patch, a, b) || wall.bordersBy(patch, b, a)
				: sourceShape.findEdge(a, b) !== -1 || sourceShape.findEdge(b, a) !== -1;
		if (bordersPatch) clipped = cutAwayFromSegment(clipped, sourceShape, a, b, clearance);
	}
	return clipped;
}

function clipFromShoreObstacle(poly, sourceShape, model, clearance) {
	if (!model || typeof model.patchByVertex !== 'function') return poly;
	let clipped = poly;
	sourceShape.forEdge((v0, v1) => {
		if (isShoreEdge(model, v0, v1)) clipped = cutAwayFromSegment(clipped, sourceShape, v0, v1, clearance);
	});
	return clipped;
}

function clipObstacleEdges(poly, sourceShape, model, widths, patch) {
	const clearance = obstacleClearances(model, widths);
	let clipped = poly;
	if (model.water && model.water.riverPath)
		clipped = clipFromPathObstacle(clipped, sourceShape, model.water.riverPath, clearance.river);
	if (!clipped || clipped.length < 3) return null;
	clipped = clipFromShoreObstacle(clipped, sourceShape, model, clearance.shore);
	clipped = clipFromWallObstacle(clipped, sourceShape, patch, model.wall, clearance.wall);
	clipped = clipFromWallObstacle(clipped, sourceShape, patch, model.citadelWall, clearance.wall);
	return clipped;
}

function triangleHeight(a, b, c) {
	const base = Point.distance(a, c);
	if (base < 1e-6) return 0;
	return Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / base;
}

function cornerCos(a, b, c) {
	const ux = a.x - b.x;
	const uy = a.y - b.y;
	const vx = c.x - b.x;
	const vy = c.y - b.y;
	const ul = Math.hypot(ux, uy);
	const vl = Math.hypot(vx, vy);
	if (ul < 1e-6 || vl < 1e-6) return -1;
	return (ux * vx + uy * vy) / (ul * vl);
}

function cleanupBuildablePolygon(poly, widths) {
	if (!poly || poly.length < 3) return null;
	let cleaned = new Polygon(poly);
	const minEdge = Math.max((widths.alley || 0) * 0.6, 0.35);
	const maxTipHeight = Math.max((widths.regular || 0) * 0.45, 0.35);
	const acuteCos = Math.cos(Math.PI / 9); // 20 degrees

	for (let pass = 0; pass < 8 && cleaned.length > 3; pass++) {
		let removed = false;
		for (let i = 0; i < cleaned.length; i++) {
			const a = cleaned[(i + cleaned.length - 1) % cleaned.length];
			const b = cleaned[i];
			const c = cleaned[(i + 1) % cleaned.length];
			const prevLen = Point.distance(a, b);
			const nextLen = Point.distance(b, c);
			const height = triangleHeight(a, b, c);
			const sharp = cornerCos(a, b, c) > acuteCos;
			if ((sharp && height < maxTipHeight * 2.5) || Math.min(prevLen, nextLen) < minEdge || height < maxTipHeight) {
				cleaned.splice(i, 1);
				removed = true;
				break;
			}
		}
		if (!removed) break;
	}

	const area = Math.abs(cleaned.square);
	const minArea = Math.max(1, (widths.regular || 1) * (widths.regular || 1) * 2);
	if (cleaned.length < 3 || area < minArea) return null;
	if (cleaned.length === 3) {
		let minHeight = Infinity;
		for (let i = 0; i < 3; i++)
			minHeight = Math.min(minHeight, triangleHeight(cleaned[(i + 2) % 3], cleaned[i], cleaned[(i + 1) % 3]));
		if (minHeight < maxTipHeight || cleaned.compactness < 0.08) return null;
	}
	return cleaned;
}

// Port of Ward.getCityBlock (Ward.hx), adapted for obstacle-aware buildable areas.
// Every ward edge gets one fixed inset; rivers, shores, walls, towers, and occupied obstacle
// nodes then cut into that base block with their own clearance.
export function insetShape(model, shape, widths, withinWalls, patch = null) {
	const { regular, alley } = widths;
	const innerPatch = model.wall == null || withinWalls;
	const fixedInset = (innerPatch ? regular : alley) / 2;
	const insetDist = shape.map(() => fixedInset);

	const base = shape.isConvex() ? shape.shrink(insetDist) : shape.buffer(insetDist);
	const edgeClipped = clipObstacleEdges(base, shape, model, widths, patch);
	if (!edgeClipped || edgeClipped.length < 3) return null;
	return cleanupBuildablePolygon(clipObstacleCorners(edgeClipped, shape, model, widths), widths);
}

// Port of Ward.getCityBlock (Ward.hx): inset a single ward's shape.
export function getCityBlock(model, patch, widths) {
	return insetShape(model, patch.shape, widths, patch.withinWalls, patch);
}

// Port of Cathedral.rateLocation: prefer a patch overlooking the plaza, else closest to it.
export function cathedralRate(model, patch) {
	if (model.plaza != null && patch.shape.borders(model.plaza.shape)) return -1 / patch.shape.square;
	return patch.shape.distance(model.plaza != null ? model.plaza.shape.center : model.center) * patch.shape.square;
}

// Port of Market.rateLocation: no two markets adjacent; size relative to plaza, else distance to center.
export function marketRate(model, patch) {
	for (const p of model.inner)
		if (p.type === 'market' && p.shape.borders(patch.shape)) return Number.POSITIVE_INFINITY;
	return model.plaza != null ? patch.shape.square / model.plaza.shape.square : patch.shape.distance(model.center);
}

// --- building subdivision (port of Ward.createAlleys / createOrthoBuilding + ward subclasses) ---

// Recursively split a block into building lots along its longest edge (with alley gaps).
// `depth` guards against degenerate polygons that fail to cut (avoids infinite recursion).
export function createAlleys(p, minSq, gridChaos, sizeChaos, emptyProb = 0.04, split = true, alley = 0.6, depth = 0) {
	if (!p || p.length < 3) return [];

	// longest edge -> its first vertex
	let v = null;
	let length = -1;
	p.forEdge((p0, p1) => {
		const len = Point.distance(p0, p1);
		if (len > length) {
			length = len;
			v = p0;
		}
	});

	const spread = 0.8 * gridChaos;
	const ratio = (1 - spread) / 2 + Random.float() * spread;
	// keep lots rectangular even in chaotic wards
	const angleSpread = (Math.PI / 6) * gridChaos * (p.square < minSq * 4 ? 0.0 : 1);
	const b = (Random.float() - 0.5) * angleSpread;

	const halves = Cutter.bisect(p, v, ratio, b, split ? alley : 0.0);

	if (halves.length < 2 || depth > 24) {
		return Random.bool(emptyProb) ? [] : [p];
	}

	let buildings = [];
	for (const half of halves) {
		if (half.square < minSq * Math.pow(2, 4 * sizeChaos * (Random.float() - 0.5))) {
			if (!Random.bool(emptyProb)) buildings.push(half);
		} else {
			buildings = buildings.concat(
				createAlleys(half, minSq, gridChaos, sizeChaos, emptyProb, half.square > minSq / (Random.float() * Random.float()), alley, depth + 1)
			);
		}
	}
	return buildings;
}

function findLongestEdge(poly) {
	return amin(poly, (v) => -poly.vector(v).length);
}

// Subdivide into axis-aligned (relative to the longest edge) building lots.
export function createOrthoBuilding(poly, minBlockSq, fill) {
	function slice(p, c1, c2, depth) {
		const v0 = findLongestEdge(p);
		const v1 = p.next(v0);
		const v = v1.subtract(v0);

		const ratio = 0.4 + Random.float() * 0.2;
		const p1 = GeomUtils.interpolate(v0, v1, ratio);

		const c = Math.abs(GeomUtils.scalar(v.x, v.y, c1.x, c1.y)) < Math.abs(GeomUtils.scalar(v.x, v.y, c2.x, c2.y)) ? c1 : c2;

		const halves = p.cut(p1, p1.add(c));
		if (halves.length < 2 || depth > 24) return Random.bool(fill) ? [p] : [];

		let buildings = [];
		for (const half of halves) {
			if (half.square < minBlockSq * Math.pow(2, Random.normal() * 2 - 1)) {
				if (Random.bool(fill)) buildings.push(half);
			} else {
				buildings = buildings.concat(slice(half, c1, c2, depth + 1));
			}
		}
		return buildings;
	}

	if (!poly || poly.length < 3) return [];
	if (poly.square < minBlockSq) return [poly];

	const c1 = poly.vector(findLongestEdge(poly));
	const c2 = c1.rotate90();
	for (let attempt = 0; attempt < 40; attempt++) {
		const blocks = slice(poly, c1, c2, 0);
		if (blocks.length > 0) return blocks;
	}
	return [poly];
}

// Pick residential subdivision params by distance from centre -> concentric districts:
// large merchant blocks in the core, craftsmen mid-town, chaotic slums on the outskirts.
function wardStyle(model, patch) {
	const t = Point.distance(patch.shape.centroid, model.center) / (model.cityRadius || 1);
	if (t < 0.5) return [50 + 60 * Random.float() * Random.float(), 0.5 + Random.float() * 0.3, 0.7, 0.15];
	if (t < 1.1) return [10 + 80 * Random.float() * Random.float(), 0.5 + Random.float() * 0.2, 0.6, 0.04];
	return [10 + 30 * Random.float() * Random.float(), 0.6 + Random.float() * 0.4, 0.8, 0.03];
}

function translatedShape(shape, dx, dy) {
	return new Polygon(shape.map((p) => new Point(p.x + dx, p.y + dy)));
}

function segmentLineIntersection(p0, p1, a, b) {
	const seg = p1.subtract(p0);
	const edge = b.subtract(a);
	const hit = GeomUtils.intersectLines(p0.x, p0.y, seg.x, seg.y, a.x, a.y, edge.x, edge.y);
	if (hit == null || hit.x < -1e-6 || hit.x > 1 + 1e-6) return null;
	return new Point(p0.x + seg.x * hit.x, p0.y + seg.y * hit.x);
}

function clipPolygonToConvexShape(poly, clipShape) {
	if (!poly || poly.length < 3 || !clipShape || clipShape.length < 3) return null;
	let out = poly.map((p) => p);
	const orientation = clipShape.square >= 0 ? 1 : -1;

	for (let i = 0; i < clipShape.length && out.length >= 3; i++) {
		const a = clipShape[i];
		const b = clipShape[(i + 1) % clipShape.length];
		const inside = (p) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-6;
		const input = out;
		out = [];
		let prev = input[input.length - 1];
		let prevInside = inside(prev);
		for (const cur of input) {
			const curInside = inside(cur);
			if (curInside !== prevInside) {
				const hit = segmentLineIntersection(prev, cur, a, b);
				if (hit) out.push(hit);
			}
			if (curInside) out.push(cur);
			prev = cur;
			prevInside = curInside;
		}
	}

	const clipped = new Polygon(out);
	return clipped.length >= 3 && Math.abs(clipped.square) > 1e-6 ? clipped : null;
}

function indentFronts(lots, block) {
	if (!block || block.length < 3) return lots;
	const blockCenter = block.centroid;
	return lots.map((lot) => {
		if (Random.float() >= 0.1) return lot;
		const area = Math.abs(lot.square);
		let inset = Math.min(Math.sqrt(area) / 3, 1.2) * Random.float();
		if (inset < 0.5) return lot;

		const lotCenter = lot.center;
		const dir = new Point(blockCenter.x - lotCenter.x, blockCenter.y - lotCenter.y);
		if (dir.length < 1e-6) return lot;
		dir.normalize(inset);

		const shiftedBlock = translatedShape(block, dir.x, dir.y);
		const clipped = clipPolygonToConvexShape(lot, shiftedBlock);
		if (!clipped || clipped.length < 3 || Math.abs(clipped.square) < area * 0.35) return lot;
		return clipped;
	});
}

function classifyGardenLots(lots) {
	if (!lots || lots.length < 6 || !Random.bool(0.55)) return lots;

	const touches = (a, b) => {
		for (let i = 0; i < a.length; i++) {
			const a0 = a[i];
			const a1 = a[(i + 1) % a.length];
			for (let j = 0; j < b.length; j++) {
				const b0 = b[j];
				const b1 = b[(j + 1) % b.length];
				if ((Point.distance(a0, b1) < 1e-5 && Point.distance(a1, b0) < 1e-5) ||
					(Point.distance(a0, b0) < 1e-5 && Point.distance(a1, b1) < 1e-5)) return true;
			}
		}
		return false;
	};

	const garden = new Set();
	const target = Math.max(1, Math.min(4, Math.round(lots.length * (0.05 + Random.float() * 0.04))));
	const order = lots.map((_, i) => i).sort(() => Random.float() - 0.5);
	for (const i of order) {
		if (garden.size >= target) break;
		let adjacentGarden = false;
		for (const g of garden) {
			if (touches(lots[i], lots[g])) {
				adjacentGarden = true;
				break;
			}
		}
		if (!adjacentGarden) garden.add(i);
	}

	for (const i of garden) lots[i].class = 'garden';
	return lots;
}

function commonWardParams(model, patch) {
	// [minSq, gridChaos, sizeChaos, emptyProb, blockSize]
	// minSq: minimum lot area. blockSize: bisector recursion threshold (minArea = minSq*blockSize).
	// gridChaos: area-balance tolerance (variance = 16*gridChaos). sizeChaos: lot size jitter.
	return [80, 0.5, 0.45, 0, 16];
}

function modelIsEnclosed(model, patch) {
	return model && typeof model.isEnclosed === 'function' ? model.isEnclosed(patch) : true;
}

function filterOutskirts(model, patch, geometry) {
	if (!model || !patch || !patch.shape || !geometry || geometry.length === 0) return geometry;
	if (modelIsEnclosed(model, patch)) return geometry;

	const populatedEdges = [];
	const addEdge = (v1, v2, factor = 1.0) => {
		const dx = v2.x - v1.x;
		const dy = v2.y - v1.y;
		let maxVertex = null;
		let maxDist = -Infinity;
		for (const v of patch.shape) {
			const dist = (v !== v1 && v !== v2 ? GeomUtils.distance2line(v1.x, v1.y, dx, dy, v.x, v.y) : 0) * factor;
			if (dist > maxDist) {
				maxDist = dist;
				maxVertex = v;
			}
		}
		if (maxVertex != null && Math.abs(maxDist) > 1e-6) populatedEdges.push({ x: v1.x, y: v1.y, dx, dy, d: maxDist });
	};

	patch.shape.forEdge((v1, v2) => {
		let onRoad = false;
		for (const street of model.arteries || []) {
			if (street.contains(v1) && street.contains(v2)) {
				onRoad = true;
				break;
			}
		}

		if (onRoad) {
			addEdge(v1, v2, 1);
		} else if (typeof model.getNeighbour === 'function') {
			const n = model.getNeighbour(patch, v1);
			if (n && n.withinCity) addEdge(v1, v2, modelIsEnclosed(model, n) ? 1 : 0.4);
		}
	});
	if (populatedEdges.length === 0) return geometry;

	const gates = model.gates || [];
	const density = patch.shape.map((v) => {
		if (gates.includes(v)) return 1;
		const touched = typeof model.patchByVertex === 'function' ? model.patchByVertex(v) : [];
		return touched.length > 0 && touched.every((p) => p.withinCity) ? 2 * Random.float() : 0;
	});

		return geometry.filter((building) => {
		let minDist = 1.0;
		for (const edge of populatedEdges) {
			for (const v of building) {
				const d = GeomUtils.distance2line(edge.x, edge.y, edge.dx, edge.dy, v.x, v.y);
				const dist = d / edge.d;
				if (dist < minDist) minDist = dist;
			}
		}

		const weights = patch.shape.interpolate(building.center);
		let p = 0;
		for (let j = 0; j < weights.length; j++) p += density[j] * weights[j];
		if (p <= 1e-6) return false;
		minDist /= p;

		// Relaxed: keep buildings unless they're well beyond the populated edge threshold.
		// Random.fuzzy(1) averages ~0.5; requiring it > minDist means lots near the edge
		// (minDist small) are almost always kept, and only far-flung outliers are dropped.
		return Random.fuzzy(1) > minDist * 1.4;
	});
}

export function createCommonWardGeometry(model, patch, widths) {
	const block = patch.block;
	if (!block || block.length < 3) return [];

	const angleOf = (poly, i) => {
		const a = poly[(i + poly.length - 1) % poly.length];
		const b = poly[i];
		const c = poly[(i + 1) % poly.length];
		const u = a.subtract(b);
		const v = c.subtract(b);
		if (u.length < 1e-6 || v.length < 1e-6) return 0;
		return Math.acos(Math.max(-1, Math.min(1, u.dot(v) / (u.length * v.length))));
	};
	const minPolyAngle = (poly) => {
		let min = Infinity;
		for (let i = 0; i < poly.length; i++) min = Math.min(min, angleOf(poly, i));
		return min;
	};
	const roundedAcuteCorners = (poly, minAngle, depth = 0) => {
		if (!poly || poly.length < 3 || depth > 12) return poly;
		let worst = -1;
		let worstAngle = minAngle;
		for (let i = 0; i < poly.length; i++) {
			const a = angleOf(poly, i);
			if (a < worstAngle) {
				worstAngle = a;
				worst = i;
			}
		}
		if (worst === -1) return poly;
		const prev = poly[(worst + poly.length - 1) % poly.length];
		const corner = poly[worst];
		const next = poly[(worst + 1) % poly.length];
		const prevLen = Point.distance(corner, prev);
		const nextLen = Point.distance(corner, next);
		if (prevLen < 1e-6 || nextLen < 1e-6) return poly;
		const reach = Math.min(prevLen, nextLen) * 0.22;
		if (!(reach > 1e-6)) return poly;
		const a = corner.add(prev.subtract(corner).norm(reach));
		const b = corner.add(next.subtract(corner).norm(reach));
		const out = new Polygon();
		for (let i = 0; i < poly.length; i++) {
			if (i === worst) {
				out.push(a);
				out.push(b);
			} else {
				out.push(poly[i]);
			}
		}
		if (out.length < 3 || Math.abs(out.square) < Math.abs(poly.square) * 0.5) return poly;
		// The acute tip (corner, a, b) was beveled away — leave a tree/fountain behind.
		recordRemovedTriangle(corner, a, b);
		return roundedAcuteCorners(out, minAngle, depth + 1);
	};

	const axis = principalAxis(block);
	const radial = block.centroid.subtract(model.center || block.center);
	if (radial.length > 1e-6 && Math.abs(axis.dot(radial.norm(1))) > 0.92) {
		axis.set(new Point(-axis.y, axis.x));
	}
	if (Random.bool(0.35)) axis.set(new Point(-axis.y, axis.x));

	const area = Math.abs(block.square);
	const scale = Math.sqrt(area);
	const dense = patch.type === 'gate' || Point.distance(block.centroid, model.center || block.center) < (model.cityRadius || scale) * 0.55;
	const params = {
		minSq: dense ? 70 : 95,
		blockSize: dense ? 10 : 14,
		gridChaos: 0.45 + Random.float() * 0.25,
		sizeChaos: 0.35,
		gap: widths.alley || 0.8,
		emptyProb: 0,
		primaryDir: axis,
		directionJitter: 0.28 + Random.float() * 0.18,
		elbowAngleMin: Math.PI / 9,
		elbowAngleMax: Math.PI / 2,
		schedule: ['elbow', 'straight', 'elbow'],
		maxFailedInRow: 3,
		attempts: 18,
		minLotArea: Math.max(45, widths.main * widths.main * 12),
		minLotAngle: Math.PI / 4,
	};

	// Very small blocks are already navigation-relevant as courtyards; don't shred them.
	const preparedBlock = roundedAcuteCorners(block, params.minLotAngle);
	if (area < params.minSq * 2.5 || scale < widths.main * 5) return [preparedBlock];

	const { lots, alleys } = sliceWardEdgeElbows(preparedBlock, params);
	patch.alleys = alleys || [];
	let geometry = (lots && lots.length > 0 ? lots : [preparedBlock]).map((lot) => roundedAcuteCorners(lot, params.minLotAngle));
	geometry = geometry.filter((lot) => lot && lot.length >= 3);
	return classifyGardenLots(geometry);
}

// Dominant orientation (long axis) of a point cloud, via 2x2 covariance eigenvector.
// A whole district shares one axis so its wards' blocks line up across cell boundaries.
export function principalAxis(points) {
	let cx = 0;
	let cy = 0;
	for (const p of points) {
		cx += p.x;
		cy += p.y;
	}
	cx /= points.length;
	cy /= points.length;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (const p of points) {
		const dx = p.x - cx;
		const dy = p.y - cy;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}
	const tr = (sxx + syy) / 2;
	const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
	const l1 = tr + det; // largest eigenvalue
	let ax;
	let ay;
	if (Math.abs(sxy) > 1e-9) {
		ax = l1 - syy;
		ay = sxy;
	} else if (sxx >= syy) {
		ax = 1;
		ay = 0;
	} else {
		ax = 0;
		ay = 1;
	}
	const len = Math.hypot(ax, ay) || 1;
	return new Point(ax / len, ay / len);
}

// Per-district subdivision params (ported from the reference's District.createParams).
export function districtAlleyParams() {
	const norm3 = () => (Random.float() + Random.float() + Random.float()) / 3;
	const fuzzy4 = () => Math.abs((Random.float() + Random.float() + Random.float() + Random.float()) / 2 - 1);
	return {
		minSq: 15 + 40 * fuzzy4(),
		gridChaos: 0.2 + norm3() * 0.8,
		sizeChaos: 0.4 + norm3() * 0.6,
		blockSize: 4 + 10 * norm3(),
	};
}

// Recursively cut a block into lots, alternating cuts along the district `axis` and its
// perpendicular -> a grid aligned to the whole district (the reference cuts perpendicular to
// the shape's OBB long axis). This is what makes neighbouring blocks relate.
export function subdivideAligned(poly, axis, minArea, sizeChaos, gridChaos, alley, depth = 0, useAxis = true) {
	if (!poly || poly.length < 3) return [];
	const area = Math.abs(poly.square);
	const stop = minArea * Math.pow(2, sizeChaos * (2 * Random.float() - 1));
	if (area < stop || depth > 20) return Random.bool(0.04) ? [] : [poly];

	const dir = useAxis ? axis : new Point(-axis.y, axis.x);
	const cutDir = new Point(-dir.y, dir.x);
	const c = poly.centroid;
	let mn = Infinity;
	let mx = -Infinity;
	for (const v of poly) {
		const pr = (v.x - c.x) * dir.x + (v.y - c.y) * dir.y;
		if (pr < mn) mn = pr;
		if (pr > mx) mx = pr;
	}
	const t = (mn + mx) / 2 + (Random.float() - 0.5) * (mx - mn) * 0.5 * gridChaos;
	const cp = new Point(c.x + dir.x * t, c.y + dir.y * t);
	const cp2 = new Point(cp.x + cutDir.x, cp.y + cutDir.y);

	const halves = poly.cut(cp, cp2, alley);
	if (halves.length < 2) return Random.bool(0.04) ? [] : [poly];

	let out = [];
	for (const h of halves) out = out.concat(subdivideAligned(h, axis, minArea, sizeChaos, gridChaos, alley, depth + 1, !useAxis));
	return out;
}

// Returns an array of building-lot polygons for a patch (empty for open/water types).
export function buildWardGeometry(model, patch, widths) {
	if (patch.isWater) return [];
	const block = patch.block;

	switch (patch.type) {
		case 'plaza':
		case 'market':
			return []; // open square

		case 'cathedral':
			if (!block || block.length < 3) return [];
			return Random.bool(0.4) ? Cutter.ring(block, 2 + Random.float() * 4) : createOrthoBuilding(block, 50, 0.8);

		case 'castle': {
			const b = patch.shape.shrinkEq(widths.main * 2);
			if (!b || b.length < 3) return [];
			return createOrthoBuilding(b, Math.sqrt(Math.abs(b.square)) * 4, 0.6);
		}

		case 'park':
			if (!block || block.length < 3) return [];
			return block.compactness >= 0.7
				? Cutter.radial(block, null, widths.alley)
				: Cutter.semiRadial(block, null, widths.alley);

		case 'farm':
			if (!block || block.length < 3) return [];
			return createAlleys(block, 60 + 40 * Random.float(), 0.3, 0.5, 0.0, true, widths.alley);

		default: {
			if (patch.type !== 'generic' && patch.type !== 'gate' && patch.type !== 'farm') return [];
			// All lots built up — including outskirts (no withinCity gate).
			return createCommonWardGeometry(model, patch, widths);
		}
	}
}
