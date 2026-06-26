// Headless smoke test for the DOM-free generation core (also proves Node/Django reuse).
// Run: node test/smoke.mjs
import { generateCity } from '../src/core/Model.js';

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
	for (const p of list) {
		if (!finite(p.x) || !finite(p.y)) {
			report.bad++;
			if (report.firstBad == null) report.firstBad = `${label}: (${p.x}, ${p.y})`;
		}
	}
}

const seeds = [1, 2, 3, 7, 42, 99, 1000, 12345, 777, 54321];
const sizes = [6, 10, 15, 24];

for (const seed of seeds) {
	for (const nPatches of sizes) {
		let data;
		try {
			data = generateCity({ seed, nPatches });
		} catch (e) {
			check(false, `seed=${seed} n=${nPatches}: threw "${e.message}"`);
			continue;
		}

		check(data.patches.length > 0, `seed=${seed} n=${nPatches}: has patches`);
		check(data.streets.length > 0, `seed=${seed} n=${nPatches}: has streets`);
		// arteries (merged main roads) can legitimately be empty for tiny cities where every
		// street segment runs along the plaza and is dropped — only require them for real cities
		check(data.arteries.length > 0 || nPatches < 10, `seed=${seed} n=${nPatches}: has arteries`);
		check(data.water != null, `seed=${seed} n=${nPatches}: has water`);

		const report = { bad: 0, firstBad: null };
		scanPoints('center', [data.center], report);
		scanPoints('bounds', [{ x: data.bounds.minX, y: data.bounds.minY }, { x: data.bounds.maxX, y: data.bounds.maxY }], report);
		for (const p of data.patches) {
			scanPoints(`patch#${p.id}`, p.polygon, report);
			if (p.block) scanPoints(`block#${p.id}`, p.block, report);
		}
		for (const bld of data.buildings || []) scanPoints('building', bld, report);
		for (const a of data.arteries) scanPoints('artery', a, report);
		for (const r of data.roads) scanPoints('road', r, report);
		for (const w of data.walls) {
			scanPoints('wall', w.shape, report);
			scanPoints('gate', w.gates, report);
			scanPoints('tower', w.towers, report);
		}
		scanPoints('gates', data.gates, report);
		if (data.water) {
			if (data.water.sea) scanPoints('sea', data.water.sea, report);
			for (const cell of data.water.oceanCells || []) scanPoints('oceanCell', cell, report);
			if (data.water.river) scanPoints('river', data.water.river, report);
			if (data.water.riverPath) scanPoints('riverPath', data.water.riverPath, report);
		}

		check(report.bad === 0, `seed=${seed} n=${nPatches}: ${report.bad} non-finite coords (first: ${report.firstBad})`);

		// determinism
		const data2 = generateCity({ seed, nPatches });
		check(
			JSON.stringify(data2.patches.length) === JSON.stringify(data.patches.length) &&
				JSON.stringify(data2.center) === JSON.stringify(data.center),
			`seed=${seed} n=${nPatches}: deterministic`
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
	const d = generateCity({ seed: 42, nPatches: 15 });
	console.log(
		`sample seed=42 n=15: patches=${d.patches.length} streets=${d.streets.length} roads=${d.roads.length} arteries=${d.arteries.length} walls=${d.walls.length} gates=${d.gates.length}`
	);
	console.log('types:', [...new Set(d.patches.map((p) => p.type))].join(', '));
}
