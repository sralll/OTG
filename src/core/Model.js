// Model — port of com.watabou.towngenerator.building.Model, reduced to step 1:
// patches + junction cleanup + walls/gates + road pathfinding + shrunken blocks.
// Ward assignment is simplified to labels (no building interiors). The single public
// entry point is generateCity(params) -> plain JSON-serializable CityData.

import { Point } from './Point.js';
import { Polygon } from './Polygon.js';
import { Voronoi } from './Voronoi.js';
import { Patch } from './Patch.js';
import { CurtainWall } from './CurtainWall.js';
import { Topology } from './Topology.js';
import { markOcean, buildRiverGeometry } from './Water.js';
import { Random } from './Random.js';
import { MathUtils } from './MathUtils.js';
import { amin, remove } from './arrays.js';
import { getCityBlock, cathedralRate, marketRate, buildWardGeometry, OPEN_TYPES } from './wards.js';
import { clearFeatures, takeFeatures } from './features.js';

const N = 2147483647;

const DEFAULT_FEATURES = { walls: true, plaza: true, citadel: true, cathedral: true, extraSquares: 2 };
const DEFAULT_WIDTHS = { main: 2.0, regular: 1.0, alley: 0.8 };
// Water params are in multiples of the characteristic city radius (Rc). `sea:false` or
// `river.enabled:false` disable those features. `sea.angle:null` -> random direction per seed.
const DEFAULT_WATER = {
	enabled: true,
	sea: { angle: null, distance: 1.1, waviness: 0.18, waveLength: 0.9 },
	river: { enabled: true, width: 0.16, amplitude: 0.5, frequency: 2.5, startDistance: 2.6, offset: 0.6 },
};
// Mesh smoothing (OFF by default): the reference keeps ward cells as straight Voronoi
// polygons — block coherence comes from district grouping + aligned subdivision, not curved
// cell edges. Kept as an optional effect ("Curved wards" toggle).
const DEFAULT_MESH = { enabled: false, iterations: 3, strength: 0.5, subdivide: 2 };

export function generateCity(params = {}) {
	let seed = params.seed;
	if (!(seed > 0)) seed = Math.trunc(Date.now() % N) || 1;

	const pw = params.water;
	const water =
		pw === false
			? { enabled: false }
			: {
					enabled: pw && pw.enabled === false ? false : true,
					sea: pw && pw.sea === false ? false : { ...DEFAULT_WATER.sea, ...((pw && pw.sea) || {}) },
					river: { ...DEFAULT_WATER.river, ...((pw && pw.river) || {}) },
			  };

	const meshSmoothing =
		params.meshSmoothing === false ? { enabled: false } : { ...DEFAULT_MESH, ...(params.meshSmoothing || {}) };

	const cfg = {
		seed,
		nPatches: params.nPatches != null ? params.nPatches : 15,
		features: { ...DEFAULT_FEATURES, ...(params.features || {}) },
		streetWidths: { ...DEFAULT_WIDTHS, ...(params.streetWidths || {}) },
		water,
		meshSmoothing,
	};

	Random.reset(cfg.seed);

	const model = new Model(cfg);
	let attempts = 0;
	// Like the reference: reset the seed once, then retry build() (which consumes more
	// randoms, so each attempt differs) until one succeeds. Deterministic per seed.
	for (;;) {
		try {
			model.build();
			break;
		} catch (e) {
			if (++attempts > 100) throw new Error('City generation failed after 100 attempts: ' + e.message);
		}
	}
	return model.toData();
}

export class Model {
	constructor(cfg) {
		this.cfg = cfg;
		this.nPatches = cfg.nPatches;
		this.plazaNeeded = !!cfg.features.plaza;
		this.citadelNeeded = !!cfg.features.citadel;
		this.wallsNeeded = !!cfg.features.walls;
	}

	build() {
		// reset (so retries start clean)
		this.patches = [];
		this.inner = [];
		this.districts = [];
		this.buildings = [];
		this.water = null;
		this.riverEdges = new Map();
		this.riverWidth = 0;
		this.plaza = null;
		this.citadel = null;
		this.border = null;
		this.wall = null;
		this.citadelWall = null;
		this.center = null;
		this.gates = [];
		this.streets = [];
		this.roads = [];
		this.arteries = [];
		this.cityRadius = 0;

		this.buildPatches();
		this.optimizeJunctions();
		this.smoothMesh(); // curve the ward edges; walls/streets/river/blocks are built on the result
		this.buildRiver();
		this.buildWalls();
		this.buildStreets();
		this.assignWards();
		this.buildBlocks();
		this.buildGeometry();
	}

	// --- step 1+2: spiral seeds -> Voronoi -> relax -> patches ---
	buildPatches() {
		const n = this.nPatches;

		// Phyllotaxis spiral seeds, matching the reference's buildPatches (origin point first).
		// The sqrt(k) angle makes a sunflower-like even distribution, so NO Lloyd relaxation
		// is needed (and the reference uses none).
		const sa = Random.float() * 2 * Math.PI;
		const points = [new Point(0, 0)];
		let b = 0;
		for (let k = 1; k < n * 8; k++) {
			const r = 10 + k * (2 + Random.float());
			const a = sa + 5 * Math.sqrt(k);
			points.push(new Point(Math.cos(a) * r, Math.sin(a) * r));
			if (r > b) b = r;
		}

		// Characteristic city radius: distance to the n-th closest seed (the inner-city scale).
		const radii = points.map((p) => p.length).sort((x, y) => x - y);
		this.Rc = radii[Math.min(n, radii.length - 1)] || 1;

		// Bound the outer cells with a regular hexagon at radius 2b (like the reference).
		const frame = [];
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * 2 * Math.PI;
			frame.push(new Point(Math.cos(a) * 2 * b, Math.sin(a) * 2 * b));
		}
		const voronoi = Voronoi.build(points.concat(frame));
		const regions = voronoi.partioning();

		for (const r of regions) {
			const patch = Patch.fromRegion(r);
			patch.seed = r.seed;
			this.patches.push(patch);
		}

		// Crop to the seed disk: drop any cell with a vertex farther than b from the centre.
		this.patches = this.patches.filter((p) => {
			for (const v of p.shape) if (v.length > b) return false;
			return true;
		});

		// Order cells by centroid distance from the centre (city is chosen from the middle out).
		this.patches.sort((p1, p2) => {
			const a = p1.shape.centroid;
			const c = p2.shape.centroid;
			return a.x * a.x + a.y * a.y - (c.x * c.x + c.y * c.y);
		});

		// Water-first: mark whole ocean cells, so the city is chosen on dry land and packs
		// against the coast. The river (which follows cell edges) is routed after the centre
		// is known so it can pass through the city.
		const waterEnabled = this.cfg.water && this.cfg.water.enabled !== false;
		const ocean = waterEnabled ? markOcean(this, this.cfg.water, this.Rc) : { sea: null, oceanCells: [], coastDir: null };

		// Select the city from the non-water patches (already ordered by distance).
		let cityCount = 0;
		for (const patch of this.patches) {
			if (patch.isWater) continue;

			if (cityCount === 0) {
				this.center = amin(patch.shape, (v) => v.length);
				if (this.plazaNeeded) this.plaza = patch;
			} else if (cityCount === n && this.citadelNeeded) {
				this.citadel = patch;
				this.citadel.withinCity = true;
			}

			if (cityCount < n) {
				patch.withinCity = true;
				patch.withinWalls = this.wallsNeeded;
				this.inner.push(patch);
			}

			cityCount++;
		}

		if (this.center == null) throw new Error('No land patches generated');

		// Ocean is known now; the river is routed later (in buildRiver), after the mesh is
		// smoothed, so it follows the curved cell edges and passes through the centre.
		this.coastDir = ocean.coastDir;
		this.water = waterEnabled ? { sea: ocean.sea, oceanCells: ocean.oceanCells, river: null, riverPath: null } : null;
	}

	// River along (now-curved) cell edges, through the centre. Run after smoothMesh.
	buildRiver() {
		const waterEnabled = this.cfg.water && this.cfg.water.enabled !== false;
		const river =
			waterEnabled && this.cfg.water.river && this.cfg.water.river.enabled !== false
				? buildRiverGeometry(this, this.cfg.water.river, this.Rc, this.coastDir)
				: { river: null, riverPath: null, riverEdges: new Map(), riverWidth: 0 };

		this.riverEdges = river.riverEdges;
		this.riverWidth = river.riverWidth;
		if (this.water) {
			this.water.river = river.river;
			this.water.riverPath = river.riverPath;
		}
	}

	patchByVertex(v) {
		return this.patches.filter((p) => p.shape.contains(v));
	}

	getNeighbours(patch) {
		return this.patches.filter((p) => p !== patch && p.shape.borders(patch.shape));
	}

	getNeighbour(patch, v) {
		const next = patch.shape.next(v);
		return this.patches.find((p) => p !== patch && p.shape.findEdge(next, v) !== -1) || null;
	}

	isEnclosed(patch) {
		return patch.withinCity && (patch.withinWalls || this.getNeighbours(patch).every((p) => p.withinCity));
	}

	// Vertices shared between a water cell and a land cell = the coastline. Excluded from the
	// road graph so streets/roads never touch the shore.
	_computeShoreVertices() {
		const inWater = new Set();
		const inLand = new Set();
		for (const p of this.patches) for (const v of p.shape) (p.isWater ? inWater : inLand).add(v);
		const shore = new Set();
		for (const v of inWater) if (inLand.has(v)) shore.add(v);
		return shore;
	}

	// Outer-boundary vertices on the LAND side (boundary edges with no land cell across them,
	// excluding coast vertices) — the countryside "exits" roads head toward.
	_landHorizonExits() {
		const dir = new Map();
		for (const p of this.patches) {
			if (p.isWater) continue;
			const s = p.shape;
			for (let i = 0; i < s.length; i++) {
				const a = s[i];
				if (!dir.has(a)) dir.set(a, new Set());
				dir.get(a).add(s[(i + 1) % s.length]);
			}
		}
		const exits = new Set();
		for (const p of this.patches) {
			if (p.isWater) continue;
			const s = p.shape;
			for (let i = 0; i < s.length; i++) {
				const a = s[i];
				const b = s[(i + 1) % s.length];
				const twinLand = dir.get(b) && dir.get(b).has(a);
				if (!twinLand) {
					if (!this.shoreVertices.has(a)) exits.add(a);
					if (!this.shoreVertices.has(b)) exits.add(b);
				}
			}
		}
		return [...exits];
	}

	// Curve the ward edges: subdivide every shared cell edge, then Laplacian-smooth the shared
	// vertices. Because adjacent cells share the SAME inserted points (by identity), the mesh
	// stays watertight and wards/roads/river/walls/blocks (all built afterwards) bend together.
	// Coast (ocean) vertices are pinned so the shoreline stays cell-aligned and crisp.
	smoothMesh() {
		const cfg = this.cfg.meshSmoothing;
		if (!cfg || cfg.enabled === false) return;
		const subdivide = cfg.subdivide != null ? cfg.subdivide : 2;
		const iterations = cfg.iterations != null ? cfg.iterations : 3;
		const strength = cfg.strength != null ? cfg.strength : 0.5;

		if (subdivide > 1) this._subdivideEdges(subdivide);
		if (iterations > 0) this._laplacian(iterations, strength);
	}

	// Insert (k-1) shared points along every cell edge. Shared edges reuse the same point
	// instances (keyed by an unordered vertex-id pair), so the two cells stay stitched together.
	_subdivideEdges(k) {
		let counter = 0;
		const ids = new Map();
		const idOf = (p) => {
			let i = ids.get(p);
			if (i == null) ids.set(p, (i = counter++));
			return i;
		};
		const interiorByEdge = new Map(); // key -> interior points in (low-id -> high-id) order

		const getInterior = (a, b) => {
			const ia = idOf(a);
			const ib = idOf(b);
			const key = ia < ib ? ia + '_' + ib : ib + '_' + ia;
			let arr = interiorByEdge.get(key);
			if (!arr) {
				const lo = ia < ib ? a : b;
				const hi = ia < ib ? b : a;
				arr = [];
				for (let j = 1; j < k; j++) {
					const t = j / k;
					arr.push(new Point(lo.x + (hi.x - lo.x) * t, lo.y + (hi.y - lo.y) * t));
				}
				interiorByEdge.set(key, arr);
			}
			return ia < ib ? arr : arr.slice().reverse();
		};

		for (const p of this.patches) {
			const s = p.shape;
			const out = [];
			for (let i = 0; i < s.length; i++) {
				const a = s[i];
				const b = s[(i + 1) % s.length];
				out.push(a);
				for (const m of getInterior(a, b)) out.push(m);
			}
			p.shape = new Polygon(out);
		}
	}

	_laplacian(iterations, strength) {
		const neighbours = new Map(); // Point -> Set<Point>
		const pinned = new Set();
		for (const p of this.patches) {
			const s = p.shape;
			for (let i = 0; i < s.length; i++) {
				const a = s[i];
				const b = s[(i + 1) % s.length];
				if (!neighbours.has(a)) neighbours.set(a, new Set());
				if (!neighbours.has(b)) neighbours.set(b, new Set());
				neighbours.get(a).add(b);
				neighbours.get(b).add(a);
				if (p.isWater) {
					pinned.add(a);
					pinned.add(b);
				}
			}
		}

		for (let it = 0; it < iterations; it++) {
			const nx = new Map();
			const ny = new Map();
			for (const [v, nb] of neighbours) {
				if (pinned.has(v) || nb.size === 0) continue;
				let sx = 0;
				let sy = 0;
				for (const u of nb) {
					sx += u.x;
					sy += u.y;
				}
				nx.set(v, v.x + (sx / nb.size - v.x) * strength);
				ny.set(v, v.y + (sy / nb.size - v.y) * strength);
			}
			for (const [v, x] of nx) {
				v.x = x;
				v.y = ny.get(v);
			}
		}
	}

	// --- step 3: merge junction vertices closer than 8, then dedup ---
	optimizeJunctions() {
		const patchesToOptimize = this.citadel == null ? this.inner : this.inner.concat([this.citadel]);

		const wards2clean = [];
		for (const w of patchesToOptimize) {
			let index = 0;
			while (index < w.shape.length) {
				const v0 = w.shape[index];
				const v1 = w.shape[(index + 1) % w.shape.length];

				if (v0 !== v1 && Point.distance(v0, v1) < 8) {
					for (const w1 of this.patchByVertex(v1))
						if (w1 !== w) {
							w1.shape[w1.shape.indexOf(v1)] = v0;
							wards2clean.push(w1);
						}

					v0.addEq(v1);
					v0.scaleEq(0.5);

					w.shape.remove(v1);
				}
				index++;
			}
		}

		// Remove duplicate vertices (length captured once, as in Haxe)
		for (const w of wards2clean) {
			const len = w.shape.length;
			for (let i = 0; i < len; i++) {
				const v = w.shape[i];
				let dupIdx;
				while ((dupIdx = w.shape.indexOf(v, i + 1)) !== -1) w.shape.splice(dupIdx, 1);
			}
		}
	}

	// --- walls + gates (border always; castle wall if citadel) ---
	buildWalls() {
		const reserved = this.citadel != null ? this.citadel.shape.slice() : [];

		this.border = new CurtainWall(this.wallsNeeded, this, this.inner, reserved);
		if (this.wallsNeeded) {
			this.wall = this.border;
			this.wall.buildTowers();
			// Suppress wall segments that cross water (river edges, coast) and remove
			// towers at those junctions — the wall should border the river, not plunge into it.
			this.wall.suppressWaterSegments(this);
			this.wall.buildTowers();
		}

		// (cells were already cropped to the seed disk in buildPatches, like the reference)
		this.gates = this.border.gates;

		if (this.citadel != null) {
			const reservedCastle = this.citadel.shape.filter((v) => this.patchByVertex(v).some((p) => !p.withinCity));
			this.citadelWall = new CurtainWall(true, this, [this.citadel], reservedCastle);
			this.citadelWall.suppressWaterSegments(this);
			this.citadelWall.buildTowers();
			this.citadel.type = 'castle';

			if (this.citadel.shape.compactness < 0.75) throw new Error('Bad citadel shape!');

			this.gates = this.gates.concat(this.citadelWall.gates);
		}
	}

	// --- step 4: A* streets (gate -> center/plaza) and roads (outside -> gate) ---
	buildStreets() {
		// Shore vertices are excluded from the road graph (in Topology) so streets/roads never
		// run along or out to the coast — matching the reference (which excludes shore points).
		this.shoreVertices = this._computeShoreVertices();
		this.topology = new Topology(this);

		// Land exits: outer-boundary vertices on the LAND side (not coast). Roads lead to the
		// one best aligned with the gate's outward direction, instead of an arbitrary far point.
		const exits = this._landHorizonExits();

		for (const gate of this.gates) {
			const end =
				this.plaza != null ? amin(this.plaza.shape, (v) => Point.distance(v, gate)) : this.center;

			const street = this.topology.buildPath(gate, end, this.topology.outer);
			if (street != null) {
				this.streets.push(street);

				if (this.border.gates.indexOf(gate) !== -1 && exits.length > 0) {
					const gx = gate.x;
					const gy = gate.y;
					// most aligned with the gate direction first (dot of gate dir with exit dir)
					const sorted = exits
						.slice()
						.sort((a, c) => (c.x * gx + c.y * gy) / (c.length || 1) - (a.x * gx + a.y * gy) / (a.length || 1));
					let road = null;
					for (const ex of sorted) {
						road = this.topology.buildPath(ex, gate, this.topology.inner);
						if (road != null) break;
					}
					if (road != null) this.roads.push(road);
				}
			} else {
				throw new Error('Unable to build a street!');
			}
		}

		this.tidyUpRoads();
		// arteries are kept as raw cell-edge paths; the renderer smooths them with a cubic.
	}

	tidyUpRoads() {
		const segments = [];
		const cut2segments = (street) => {
			let v1 = street[0];
			for (let i = 1; i < street.length; i++) {
				const v0 = v1;
				v1 = street[i];

				// Skip segments running along the plaza
				if (this.plaza != null && this.plaza.shape.contains(v0) && this.plaza.shape.contains(v1)) continue;

				let exists = false;
				for (const seg of segments)
					if (seg.start === v0 && seg.end === v1) {
						exists = true;
						break;
					}

				if (!exists) segments.push({ start: v0, end: v1 });
			}
		};

		for (const street of this.streets) cut2segments(street);
		for (const road of this.roads) cut2segments(road);

		this.arteries = [];
		while (segments.length > 0) {
			const seg = segments.pop();

			let attached = false;
			for (const a of this.arteries) {
				if (a[0] === seg.end) {
					a.unshift(seg.start);
					attached = true;
					break;
				} else if (a[a.length - 1] === seg.start) {
					a.push(seg.end);
					attached = true;
					break;
				}
			}

			if (!attached) this.arteries.push(new Polygon([seg.start, seg.end]));
		}
	}

	// --- simplified ward labeling (no building interiors) ---
	assignWards() {
		if (this.plaza != null) this.plaza.type = 'plaza';

		const unassigned = this.inner.filter((p) => p !== this.plaza);

		if (this.cfg.features.cathedral && unassigned.length > 0) {
			const pick = amin(unassigned, (p) => cathedralRate(this, p));
			pick.type = 'cathedral';
			remove(unassigned, pick);
		}

		let squares = this.cfg.features.extraSquares | 0;
		while (squares-- > 0 && unassigned.length > 0) {
			const pick = amin(unassigned, (p) => marketRate(this, p));
			pick.type = 'market';
			remove(unassigned, pick);
		}

		// Patches touching a border gate become gate wards (cosmetic label)
		for (const gate of this.border.gates)
			for (const patch of this.patchByVertex(gate))
				if (patch.withinCity && patch.type == null) patch.type = 'gate';

		for (const p of unassigned) if (p.type == null) p.type = 'generic';

		// Radius + countryside
		this.cityRadius = 0;
		for (const patch of this.patches) {
			if (patch.withinCity) {
				for (const v of patch.shape) this.cityRadius = Math.max(this.cityRadius, v.length);
			} else if (patch.type == null) {
				patch.type = Random.bool(0.2) && patch.shape.compactness >= 0.7 ? 'farm' : 'generic';
			}
		}

		for (const patch of this.patches) if (patch.type == null) patch.type = 'generic';
	}

	// --- step 5: shrink each patch into a block, leaving room for roads ---
	buildBlocks() {
		// Chamfer "features" (trees/fountains in cut-off corner gaps) are collected from
		// buildBlocks + buildGeometry; reset the shared sink before the run.
		clearFeatures();
		for (const patch of this.patches) {
			if (OPEN_TYPES.has(patch.type)) {
				patch.block = null;
				continue;
			}
			try {
				patch.block = getCityBlock(this, patch, this.cfg.streetWidths);
			} catch (e) {
				patch.block = null; // a single degenerate block shouldn't abort generation
			}
		}
	}

	// Fill wards with building lots. Generic/gate wards use the reference CommonWard alley
	// subdivision per patch; special wards keep their own geometry.
	buildGeometry() {
		const widths = this.cfg.streetWidths;
		this.buildings = [];
		for (const patch of this.patches) {
			if (patch.isWater) continue;
			try {
				for (const b of buildWardGeometry(this, patch, widths)) this.buildings.push(b);
			} catch (e) {
				/* skip */
			}
		}
		this.features = takeFeatures();
	}

	toData() {
		const pt = (p) => ({ x: p.x, y: p.y });
		const poly = (pl) => Array.from(pl, pt);
		const building = (pl) => ({
			polygon: poly(pl),
			class: pl.class || 'building',
		});

		const patches = this.patches.map((p, idx) => ({
			id: idx,
			polygon: poly(p.shape),
			block: p.block ? poly(p.block) : null,
			type: p.type || 'generic',
			isWater: !!p.isWater,
			withinCity: p.withinCity,
			withinWalls: p.withinWalls,
		}));

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		// bounds from land/city patches only (water cells/sea can extend far off-map)
		for (const p of this.patches) {
			if (p.isWater) continue;
			for (const v of p.shape) {
				if (v.x < minX) minX = v.x;
				if (v.y < minY) minY = v.y;
				if (v.x > maxX) maxX = v.x;
				if (v.y > maxY) maxY = v.y;
			}
		}

	const serializeWall = (w, isCastle) => ({
		shape: poly(w.shape),
		gates: w.gates.map(pt),
		towers: w.towers.map(pt),
		isCastle,
		segments: w.segments ? w.segments.slice() : null,
	});

	const walls = [];
	if (this.wall != null) walls.push(serializeWall(this.wall, false));
	if (this.citadelWall != null) walls.push(serializeWall(this.citadelWall, true));

		const water = this.water
			? {
					sea: this.water.sea ? poly(this.water.sea) : null,
					oceanCells: this.water.oceanCells.map((p) => poly(p.shape)),
					river: this.water.river ? poly(this.water.river) : null,
					riverPath: this.water.riverPath ? poly(this.water.riverPath) : null,
					riverWidth: this.riverWidth,
			  }
			: null;

		return {
			seed: this.cfg.seed,
			nPatches: this.nPatches,
			center: pt(this.center),
			cityRadius: this.cityRadius,
			bounds: { minX, minY, maxX, maxY },
			patches,
			buildings: this.buildings.map(building),
			features: (this.features || []).map((f) => ({ x: f.x, y: f.y, kind: f.kind })),
			arteries: this.arteries.map(poly),
			streets: this.streets.map(poly),
			roads: this.roads.map(poly),
			walls,
			water,
			gates: this.gates.map(pt),
		};
	}
}
