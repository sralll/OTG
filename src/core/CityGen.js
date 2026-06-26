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
const PASSAGE_MARGIN = 1.2;
const RIVER_NODE_MARGIN = 1.6;
const TOWER_CLEARANCE = 4.4;

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

	const reach = Math.min(clearance, prevLen * 0.45, nextLen * 0.45);
	if (!(reach > 1e-6)) return poly;

	const a = corner.add(prev.subtract(corner).norm(reach));
	const b = corner.add(next.subtract(corner).norm(reach));
	const halves = poly.cut(a, b);
	if (halves.length < 2) return poly;

	let best = poly;
	let bestDistance = -Infinity;
	const minKeptArea = Math.abs(poly.square) * 0.55;
	for (const half of halves) {
		if (!half || half.length < 3 || Math.abs(half.square) < Math.max(1, minKeptArea)) continue;
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
		if (!clipped || clipped.length < 3) return null;
	}
	return clipped;
}

function computeAvailableArea(cell, ctx) {
	const edgeInsets = [];
	cell.forEdge((v0, v1) => {
		let inset = DEFAULT_BLOCK_INSET;
		if (hasEdgeRef(ctx.riverEdges, v0, v1) || hasEdgeRef(ctx.riverEdges, v1, v0))
			inset = Math.max(inset, ctx.riverWidth / 2 + PASSAGE_MARGIN);
		if (hasEdgeRef(ctx.shoreEdges, v0, v1) || hasEdgeRef(ctx.shoreEdges, v1, v0))
			inset = Math.max(inset, Math.max(ctx.riverWidth / 2 + PASSAGE_MARGIN, 1.8));
		if (isActiveWallEdge(ctx, v0, v1)) inset = Math.max(inset, WALL_THICKNESS / 2 + PASSAGE_MARGIN);
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
		return clipObstacleCorners(base, cell, ctx.nodeClearance);
	} catch (e) { return null; }
}

function buildBuildings(cells, inner, center, wallData, streetData, riverData, plazaEnabled) {
	if (!inner || inner.length === 0 || !center) return { blocks: [], buildings: [], wardTypes: new Map() };

	// River edges map (shared Point identity)
	const riverEdges = new Map();
	const nodeClearance = new Map();
	if (riverData && riverData.course) {
		for (let i = 0; i < riverData.course.length - 1; i++) {
			const a = riverData.course[i], b = riverData.course[i + 1];
			addEdgeRef(riverEdges, a, b);
			addEdgeRef(riverEdges, b, a);
		}
		for (const v of riverData.course) setMax(nodeClearance, v, riverData.width / 2 + RIVER_NODE_MARGIN);
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
		shoreEdges, nodeClearance,
		roads: rawRoads, plazaCell,
		wallShape: wallData ? wallData.shape : null,
		wallSegments: wallData ? wallData.segments : null,
	};

	const blocks = [];
	const buildings = [];
	for (const p of patches) {
		if (OPEN_TYPES.has(p.type) || p.isWater) continue;
		const avail = computeAvailableArea(p.shape, ctx);
		if (avail && avail.length >= 3) {
			p.block = avail;
			blocks.push(avail);
			if ((p.type === 'generic' || p.type === 'gate') && p.withinCity) {
				for (const b of createCommonWardGeometry(model, p, { main: 2.0, regular: 1.0, alley: 0.6 })) buildings.push(b);
			}
		}
	}

	const wardTypes = new Map();
	for (const p of patches) wardTypes.set(p.shape, p.type);

	return { blocks, buildings, wardTypes };
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

	const { blocks, buildings, wardTypes } = buildBuildings(
		result.cells, result.inner, result.center,
		result.wall, result.streets, result.river, plaza
	);

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
	};
}
