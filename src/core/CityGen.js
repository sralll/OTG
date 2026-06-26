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
import { amin } from './arrays.js';

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

	const wards = result.cells.map((cell) => ({
		polygon: cell.map((v) => ({ x: v.x, y: v.y })),
		inner: !!cell.withinCity,
		water: !!cell.water,
		landing: !!cell.landing,
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
	};
}
