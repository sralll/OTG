// Headless smoke test for the DOM-free generation core (also proves Node/Django reuse).
// Run: node test/smoke.mjs
import { generateWards } from '../src/core/CityGen.js';
import { extractObstacles } from '../src/core/Obstacles.js';
import { buildVisibilityGraph } from '../src/core/VisibilityGraph.js';

let failures = 0;
let checks = 0;
function check(cond, msg) {
	checks++;
	if (!cond) {
		console.error('  FAIL:', msg);
		failures++;
	}
}

function finite(v) {
	return typeof v === 'number' && Number.isFinite(v);
}

function scanPoints(label, list, report) {
	if (!list) return;
	for (const p of list) {
		if (!p) continue;
		if (!finite(p.x) || !finite(p.y)) {
			report.bad++;
			if (report.firstBad == null) report.firstBad = `${label}: (${p.x}, ${p.y})`;
		}
	}
}

function samePoint(a, b) {
	return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function routePointOwnerKinds(vg, p) {
	for (let i = 0; i < vg.nodeCount; i++) {
		if (Math.hypot(vg.nodeX[i] - p.x, vg.nodeY[i] - p.y) > 1e-6) continue;
		const kinds = [];
		for (let k = vg.ownerStarts[i]; k < vg.ownerStarts[i + 1]; k++) {
			const owner = vg.ownerIdx[k];
			if (owner >= 0) kinds.push(vg.rawKinds[owner]);
		}
		return kinds;
	}
	return [];
}

function builtWallSegmentCount(wall, point) {
	const i = wall.shape.findIndex((p) => samePoint(p, point));
	if (i === -1) return 0;
	const prev = wall.segments[(i + wall.shape.length - 1) % wall.shape.length];
	const next = wall.segments[i];
	return (prev ? 1 : 0) + (next ? 1 : 0);
}

const seeds = [1, 2, 3, 7, 42, 99, 1000, 12345, 777, 54321];
const sizes = [6, 10, 15, 24];

{
	const bridgeVG = buildVisibilityGraph({
		polygons: [],
		lines: [{ polyline: [{ x: 0, y: -30 }, { x: 0, y: 30 }], thickness: 6, kind: 'river' }],
		portals: [{
			kind: 'bridge',
			polygon: [{ x: -3.5, y: -0.8 }, { x: 3.5, y: -0.8 }, { x: 3.5, y: 0.8 }, { x: -3.5, y: 0.8 }],
		}],
	}, { clearance: 0.2 });
	const topSideRoute = bridgeVG.astar({ x: 8, y: 0.7 }, { x: -8, y: 0.7 });
	check(topSideRoute && topSideRoute.path.length >= 2, 'bridge side-boundary route is passable');
	if (topSideRoute) {
		const bridgeNodes = topSideRoute.path.filter((p) => Math.abs(p.x) < 4);
		check(bridgeNodes.length > 0 && bridgeNodes.every((p) => p.y > 0.5), 'bridge side-boundary route stays on the near side');
	}
}

{
	const data = generateWards({
		seed: 42,
		size: 30,
		plaza: true,
		coast: true,
		river: true,
		walls: true,
		streets: true,
		outerRatio: 4,
		roadDensity: 5,
		gates: -1,
	});
	const bridgeVG = buildVisibilityGraph(extractObstacles(data), { clearance: 0.2 });
	const route = bridgeVG.astar(
		{ x: 14.245979665816341, y: 14.936383712695582 },
		{ x: 13.269100251319081, y: 4.2021149255644925 },
	);
	check(route && route.path.length >= 2, 'seed=42 bridge-side route is passable');
	if (route) {
		check(route.path.length === 4, 'seed=42 bridge-side route avoids the far-side bridge hop');
		check(route.path.some((p) => Math.abs(p.x - 8.015819) < 1e-4 && Math.abs(p.y - 5.056725) < 1e-4), 'seed=42 bridge-side route exits from the near bridge side');
	}
}

{
	const data = generateWards({
		seed: 42,
		size: 30,
		plaza: true,
		coast: true,
		river: true,
		walls: true,
		streets: true,
		outerRatio: 4,
		roadDensity: 5,
		gates: -1,
	});
	const vg = buildVisibilityGraph(extractObstacles(data), { clearance: 0.2 });
	const start = { x: -20.23013864183214, y: -17.849568765826298 };
	const goal = { x: -36.83885416198647, y: -26.636115041004714 };
	const route = vg.astar(start, goal, { exact: true, timeBudgetMs: 0, maxExpansions: 1000000 });
	check(vg.losClear(start.x, start.y, goal.x, goal.y, -1, -1), 'seed=42 clear direct route has line of sight');
	check(route && route.path.length === 2, 'seed=42 clear direct route is not detoured by soft barriers');
}

{
	const data = generateWards({
		seed: 42,
		size: 30,
		plaza: true,
		coast: true,
		river: true,
		walls: true,
		streets: true,
		outerRatio: 4,
		roadDensity: 5,
		gates: -1,
	});
	const CLEAR = 0.2;
	const vg = buildVisibilityGraph(extractObstacles(data), { clearance: CLEAR });
	const route = vg.astar(
		{ x: 20.158644276117588, y: -34.083117503749726 },
		{ x: -20.465600822860143, y: -49.687664029871655 },
		{ exact: true, timeBudgetMs: 0, maxExpansions: 1000000 },
	);
	check(route && route.path.length >= 2, 'seed=42 blocked direct route is passable');
	if (route) {
		// Clearance-preserving smoothing: string-pulling runs against the DILATED
		// edges, so the path keeps ~clearance off every raw wall instead of sliding
		// tangent onto it (the bug that hugged the river banks / building fronts).
		let minClear = Infinity;
		for (let i = 1; i < route.path.length; i++) {
			const a = route.path[i - 1], b = route.path[i];
			const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
			for (let t = 0; t <= steps; t++) {
				const x = a.x + (b.x - a.x) * t / steps, y = a.y + (b.y - a.y) * t / steps;
				for (let pi = 0; pi < vg.rawPolygons.length; pi++) {
					const bb = vg.rawPolyBboxes[pi];
					if (x < bb.minX - 1 || x > bb.maxX + 1 || y < bb.minY - 1 || y > bb.maxY + 1) continue;
					const poly = vg.rawPolygons[pi], n = poly.length / 2;
					for (let k = 0; k < n; k++) {
						const j = (k + 1) % n;
						const px = poly[k * 2], py = poly[k * 2 + 1], qx = poly[j * 2], qy = poly[j * 2 + 1];
						const dx = qx - px, dy = qy - py, L2 = dx * dx + dy * dy || 1;
						const tt = Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / L2));
						const d = Math.hypot(x - (px + dx * tt), y - (py + dy * tt));
						if (d < minClear) minClear = d;
					}
				}
			}
		}
		check(minClear > CLEAR * 0.6, `seed=42 blocked route keeps clearance off walls (min ${minClear.toFixed(3)} > ${(CLEAR * 0.6).toFixed(3)})`);
	}
}

{
	const data = generateWards({
		seed: 42,
		size: 30,
		plaza: true,
		coast: true,
		river: true,
		walls: true,
		streets: true,
		outerRatio: 4,
		roadDensity: 5,
		gates: -1,
	});
	const vg = buildVisibilityGraph(extractObstacles(data), { clearance: 0.2 });
	const route = vg.astar(
		{ x: -37.084557847483644, y: 6.493791266869135 },
		{ x: -60.073747658371836, y: -14.547162119367517 },
		{ exact: true, timeBudgetMs: 0, maxExpansions: 1000000 },
	);
	check(route && route.path.length >= 2, 'seed=42 house-corner route is passable');
	if (route) {
		const usesWaterNode = route.path.some((p) => routePointOwnerKinds(vg, p).some((kind) => kind === 'water' || kind === 'river' || kind === 'delta'));
		check(!usesWaterNode, 'seed=42 house-corner route does not need a shore tangent node');
	}
}

for (const seed of seeds) {
	for (const size of sizes) {
		let data;
		try {
			data = generateWards({ seed, size });
		} catch (e) {
			check(false, `seed=${seed} size=${size}: threw "${e.message}"`);
			continue;
		}

		check(data.wards.length > 0, `seed=${seed} size=${size}: has wards`);
		check(Array.isArray(data.roads.streets), `seed=${seed} size=${size}: has streets array`);
		// streets/arteries can legitimately be empty for tiny cities (no wall built, so no
		// street network, and plaza-hugging segments get dropped) — only require them for
		// real cities.
		check(data.roads.streets.length > 0 || size < 10, `seed=${seed} size=${size}: has streets`);
		check(data.roads.arteries.length > 0 || size < 10, `seed=${seed} size=${size}: has arteries`);
		check(data.river != null || data.water === false, `seed=${seed} size=${size}: has river data`);

		const report = { bad: 0, firstBad: null };
		scanPoints('center', [data.center], report);
		scanPoints('bounds', [{ x: data.bounds.minX, y: data.bounds.minY }, { x: data.bounds.maxX, y: data.bounds.maxY }], report);
		for (const w of data.wards) scanPoints('ward', w.polygon, report);
		for (const b of data.blocks || []) scanPoints('block', b, report);
		for (const bld of data.buildings || []) scanPoints('building', Array.isArray(bld) ? bld : bld.polygon, report);
		for (const hedge of data.hedges || []) scanPoints('hedge', hedge, report);
		for (const hedge of data.cathedralHedges || []) scanPoints('cathedralHedge', hedge, report);
		scanPoints('features', data.features || [], report);
		for (const r of data.roads.arteries) scanPoints('artery', r, report);
		for (const r of data.roads.roads) scanPoints('road', r, report);
		for (const r of data.roads.streets) scanPoints('street', r, report);
		if (data.wall) {
			scanPoints('wall', data.wall.shape, report);
			scanPoints('gate', data.wall.gates, report);
			scanPoints('tower', data.wall.towers, report);
			scanPoints('gateTower', data.wall.gateTowers, report);
			for (const gate of data.wall.gates) check(builtWallSegmentCount(data.wall, gate) === 2, `seed=${seed} size=${size}: gate is not on wall end`);
		}
		if (data.river) {
			scanPoints('riverCourse', data.river.course, report);
			scanPoints('bridge', data.river.bridges, report);
		}

		check(report.bad === 0, `seed=${seed} size=${size}: ${report.bad} non-finite coords (first: ${report.firstBad})`);

		// determinism
		const data2 = generateWards({ seed, size });
		check(
			data2.wards.length === data.wards.length &&
				JSON.stringify(data2.center) === JSON.stringify(data.center),
			`seed=${seed} size=${size}: deterministic`
		);
	}
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
	console.error(`${failures} FAILURES`);
	process.exit(1);
} else {
	console.log('ALL GOOD');
	// quick stats for one city
	const d = generateWards({ seed: 42, size: 15 });
	const arteries = d.roads.arteries.length;
	console.log(
		`sample seed=42 size=15: wards=${d.wards.length} streets=${d.roads.streets.length} roads=${d.roads.roads.length} arteries=${arteries} wall=${d.wall ? 1 : 0} buildings=${d.buildings.length} features=${d.features.length}`
	);
	console.log('types:', [...new Set(d.wards.map((w) => w.type))].join(', '));
}
