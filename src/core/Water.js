// Water.js — patch/edge-aligned water, in the spirit of the reference (mfcg) generator.
//
//  - OCEAN: whole Voronoi cells beyond a (wavy) coastline are marked water. The shore is
//    therefore the boundary between land and ocean CELLS — naturally organic, never cutting
//    a cell in half. A straight sea backdrop fills the open water beyond the outermost cells.
//  - RIVER: an A* path along cell EDGES, from a coastal vertex, through the city centre, to
//    the most-opposite boundary vertex (like mfcg's regularRiver). Drawn as a band along the
//    edges; adjacent blocks are inset from it so the city grows around the river.
//
// `generateWater(model, cfg, Rc)` mutates patches (sets isWater/ocean) and returns the
// renderable geometry + the set of river edges (for block insetting).

import { Point } from './Point.js';
import { Polygon } from './Polygon.js';
import { Random } from './Random.js';
import { Graph } from './Graph.js';

const TAU = Math.PI * 2;

// Mark whole cells beyond the (wavy) coastline as ocean. Must run BEFORE the city centre is
// chosen (so the centre lands on dry land). Returns the sea backdrop + ocean cells + coastDir.
export function markOcean(model, cfg, Rc) {
	const out = { sea: null, oceanCells: [], coastDir: null };
	if (!cfg || cfg.sea === false) return out;

	const sea = cfg.sea || {};
	const angle = sea.angle != null ? sea.angle : Random.float() * TAU;
	const coastDir = new Point(Math.cos(angle), Math.sin(angle)); // points out to sea
	const tan = coastDir.rotate90();
	const coastDist = (sea.distance != null ? sea.distance : 1.1) * Rc;
	const wavAmp = (sea.waviness != null ? sea.waviness : 0.18) * Rc;
	const wavLen = (sea.waveLength != null ? sea.waveLength : 0.9) * Rc;
	const phases = [Random.float() * TAU, Random.float() * TAU, Random.float() * TAU];
	const wave = (u) => {
		let v = 0;
		let a = 1;
		let f = 1;
		let nrm = 0;
		for (const ph of phases) {
			v += a * Math.sin(u * f * TAU + ph);
			nrm += a;
			a *= 0.5;
			f *= 2;
		}
		return v / nrm;
	};

	for (const patch of model.patches) {
		const c = patch.shape.centroid;
		const along = c.x * coastDir.x + c.y * coastDir.y;
		const t = c.x * tan.x + c.y * tan.y;
		if (along > coastDist + wavAmp * wave(t / wavLen)) {
			patch.isWater = true;
			patch.ocean = true;
			patch.type = 'water';
			out.oceanCells.push(patch);
		}
	}

	out.coastDir = coastDir;
	if (out.oceanCells.length > 0) out.sea = seaBackdrop(coastDir, tan, coastDist, Rc);
	return out;
}

// Route the river along cell edges (needs model.center). Returns band + path + edge set.
export function buildRiverGeometry(model, cfg, Rc, coastDir) {
	const out = { river: null, riverPath: null, riverEdges: new Map(), riverWidth: 0 };
	if (!cfg || cfg.enabled === false) return out;

	const width = (cfg.width != null ? cfg.width : 0.16) * Rc;
	const river = buildRiver(model, coastDir);
	if (!river || river.path.length < 2) return out;

	out.riverWidth = width;
	out.riverPath = new Polygon(river.path);
	out.river = riverBand(river.path, width);
	for (let i = 0; i < river.path.length - 1; i++) {
		addEdge(out.riverEdges, river.path[i], river.path[i + 1]);
		addEdge(out.riverEdges, river.path[i + 1], river.path[i]);
	}
	return out;
}

function addEdge(map, a, b) {
	let s = map.get(a);
	if (!s) map.set(a, (s = new Set()));
	s.add(b);
}

export function isRiverEdge(riverEdges, v0, v1) {
	const s = riverEdges.get(v0);
	return s != null && s.has(v1);
}

// Big quad covering the open water on the sea side (behind the ocean cells).
function seaBackdrop(coastDir, tan, coastDist, Rc) {
	const span = 8 * Rc;
	const depth = 8 * Rc;
	const base = coastDir.scale(coastDist);
	const a = new Point(base.x + tan.x * span, base.y + tan.y * span);
	const b = new Point(base.x - tan.x * span, base.y - tan.y * span);
	const c = new Point(b.x + coastDir.x * depth, b.y + coastDir.y * depth);
	const d = new Point(a.x + coastDir.x * depth, a.y + coastDir.y * depth);
	return new Polygon([a, b, c, d]);
}

// Build a graph of land-cell edges and route a river along it.
function buildRiver(model, coastDir) {
	const graph = new Graph();
	const pt2node = new Map();
	const node2pt = new Map();
	const proc = (v) => {
		let n = pt2node.get(v);
		if (!n) {
			n = graph.add();
			pt2node.set(v, n);
			node2pt.set(n, v);
		}
		return n;
	};

	// directed land edges, and ocean directed edges (to find the coast)
	const landDir = new Map();
	const oceanDir = new Map();
	for (const p of model.patches) {
		const s = p.shape;
		for (let i = 0; i < s.length; i++) {
			const v0 = s[i];
			const v1 = s[(i + 1) % s.length];
			if (p.isWater) {
				addEdge(oceanDir, v0, v1);
			} else {
				const n0 = proc(v0);
				const n1 = proc(v1);
				n0.link(n1, Point.distance(v0, v1));
				addEdge(landDir, v0, v1);
			}
		}
	}

	// boundary edge: a land edge with no land cell on the other side
	const horizon = new Set();
	const coastal = [];
	for (const [v0, set] of landDir) {
		for (const v1 of set) {
			const reverseIsLand = landDir.get(v1) && landDir.get(v1).has(v0);
			if (!reverseIsLand) {
				horizon.add(v0);
				horizon.add(v1);
				const reverseIsOcean = oceanDir.get(v1) && oceanDir.get(v1).has(v0);
				if (reverseIsOcean) coastal.push(v0);
			}
		}
	}

	const horizonArr = [...horizon];
	if (horizonArr.length < 2) return null;

	// mouth: a coastal vertex (river flows into the sea) — else any horizon vertex
	const candidates = coastal.length > 0 ? coastal : horizonArr;
	const mouth = candidates[Math.trunc(Random.float() * candidates.length)];

	// opposite end: horizon vertex whose direction from origin is most opposite the mouth's
	const md = mouth.norm(1);
	let opposite = null;
	let best = Infinity;
	for (const v of horizonArr) {
		const d = v.norm(1);
		const dot = d.x * md.x + d.y * md.y;
		if (dot < best) {
			best = dot;
			opposite = v;
		}
	}
	if (opposite == null || opposite === mouth) return null;

	const centerNode = pt2node.get(model.center);
	const mouthNode = pt2node.get(mouth);
	const oppNode = pt2node.get(opposite);
	if (!centerNode || !mouthNode || !oppNode) return null;

	// route opposite -> centre -> mouth (so the river passes through the city)
	const a = graph.aStar(oppNode, centerNode);
	const b = graph.aStar(centerNode, mouthNode);
	if (a == null || b == null) return null;

	// aStar returns goal-first ([goal..start]); normalise to a single opposite->mouth chain
	const segA = a.map((n) => node2pt.get(n)).reverse(); // [opposite..centre]
	const segB = b.map((n) => node2pt.get(n)).reverse(); // [centre..mouth]
	const path = segA.concat(segB.slice(1));
	return { path, mouth, opposite };
}

// Offset a centreline polyline into a closed band polygon.
function riverBand(path, width) {
	const hw = width / 2;
	const left = [];
	const right = [];
	for (let i = 0; i < path.length; i++) {
		const a = i === 0 ? path[i + 1].subtract(path[i]) : path[i].subtract(path[i - 1]);
		const len = Math.hypot(a.x, a.y) || 1;
		const nx = -a.y / len;
		const ny = a.x / len;
		left.push(new Point(path[i].x + nx * hw, path[i].y + ny * hw));
		right.push(new Point(path[i].x - nx * hw, path[i].y - ny * hw));
	}
	return new Polygon(left.concat(right.reverse()));
}
