// Headless smoke test for the DOM-free generation core (also proves Node/Django reuse).
// Run: node test/smoke.mjs
import { generateWards } from '../src/core/CityGen.js';

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

const seeds = [1, 2, 3, 7, 42, 99, 1000, 12345, 777, 54321];
const sizes = [6, 10, 15, 24];

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
