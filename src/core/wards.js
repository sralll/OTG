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

// Open patch types are kept as open space (no shrunken block). 'water' included so water
// cells are never shrunk into blocks.
export const OPEN_TYPES = new Set(['plaza', 'market', 'park', 'water']);

// Port of Ward.getCityBlock (Ward.hx). `widths` = { main, regular, alley } (= MAIN/REGULAR/ALLEY).
// Edges on a main artery (or against a wall) inset by main/2; otherwise regular/2 (inner) or
// alley/2 (outskirts). The gap between two neighbouring blocks becomes the road width.
// Inset an arbitrary polygon edge-by-edge for street widths (used for single wards AND merged
// districts). Edges on a river/artery/wall inset more (main road); otherwise regular/alley.
export function insetShape(model, shape, widths, withinWalls, patch = null) {
	const { main, regular, alley } = widths;
	const insetDist = [];
	const innerPatch = model.wall == null || withinWalls;
	const riverEdges = model.riverEdges;

	shape.forEdge((v0, v1) => {
		// Keep blocks clear of the river (so the city visibly grows around it).
		if (riverEdges && ((riverEdges.get(v0) && riverEdges.get(v0).has(v1)) || (riverEdges.get(v1) && riverEdges.get(v1).has(v0)))) {
			insetDist.push((model.riverWidth + main) / 2);
			return;
		}
		if (patch != null && model.wall != null && model.wall.bordersBy(patch, v0, v1)) {
			insetDist.push(main / 2); // not too close to the wall
			return;
		}
		let onStreet = innerPatch && model.plaza != null && model.plaza.shape.findEdge(v1, v0) !== -1;
		if (!onStreet)
			for (const street of model.arteries)
				if (street.contains(v0) && street.contains(v1)) {
					onStreet = true;
					break;
				}
		insetDist.push((onStreet ? main : innerPatch ? regular : alley) / 2);
	});

	return shape.isConvex() ? shape.shrink(insetDist) : shape.buffer(insetDist);
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
			return createAlleys(block, 60 + 40 * Random.float(), 0.3, 0.5, 0.7, true, widths.alley);

		default: {
			// generic, gate -> residential lots, aligned to the shared district orientation so
			// blocks relate across cell boundaries (falls back to the cell's own axis).
			if (!block || block.length < 3) return [];
			const params = patch.alleyParams || { minSq: 30, gridChaos: 0.5, sizeChaos: 0.6 };
			const axis = patch.districtAxis || principalAxis(block);
			return subdivideAligned(block, axis, params.minSq, params.sizeChaos, params.gridChaos, widths.alley);
		}
	}
}
