// Headless perf test for the lazy visibility graph.
// Run: node test/vgperf.mjs
import { generateWards } from '../src/core/CityGen.js';
import { extractObstacles } from '../src/core/Obstacles.js';
import { buildVisibilityGraph } from '../src/core/VisibilityGraph.js';

const SEED = 42;
const SIZE = 15;

const t0 = performance.now();
const data = generateWards({ seed: SEED, size: SIZE });
const tGen = performance.now() - t0;

const obstacles = extractObstacles(data);
const obsCount = (obstacles.polygons?.length || 0) + (obstacles.lines?.length || 0);

const t1 = performance.now();
const vg = buildVisibilityGraph(obstacles);
const tScaffold = performance.now() - t1;

console.log('--- city ---');
console.log(`  wards=${data.wards.length} buildings=${data.buildings.length}`);
console.log(`  obstacle shapes=${obsCount} polygons=${obstacles.polygons.length} lines=${obstacles.lines.length} portals=${obstacles.portals.length}`);
console.log(`  city-gen=${tGen.toFixed(1)}ms`);

console.log('--- VG scaffolding ---');
console.log(`  nodes=${vg.nodeCount} blockerEdges=${vg.blockerCount} portals=${vg.portals.length}`);
let blocked = 0; for (let i = 0; i < vg.nodeCount; i++) if (vg.nodeBlocked[i]) blocked++;
console.log(`  blocked=${blocked} (${(blocked/vg.nodeCount*100).toFixed(1)}%)`);
console.log(`  scaffold=${tScaffold.toFixed(2)}ms (buildTimeMs=${vg.buildTimeMs.toFixed(2)})`);
console.log(`  blockerGrid ${vg.blockerGrid.cols}x${vg.blockerGrid.rows} cell=${vg.blockerGrid.cell.toFixed(2)}`);
console.log(`  nodeGrid    ${vg.nodeGrid.cols}x${vg.nodeGrid.rows} cell=${vg.nodeGrid.cell.toFixed(2)} ring=${vg.neighborRing}`);

// Try several start/goal pairs spanning the city and report success rate + timing.
console.log('--- A* queries across node pairs ---');
const samplePairs = [
	[0, Math.floor(vg.nodeCount * 0.25)],
	[Math.floor(vg.nodeCount * 0.1), Math.floor(vg.nodeCount * 0.5)],
	[Math.floor(vg.nodeCount * 0.2), Math.floor(vg.nodeCount * 0.8)],
	[Math.floor(vg.nodeCount * 0.3), Math.floor(vg.nodeCount * 0.7)],
	[Math.floor(vg.nodeCount * 0.5), Math.floor(vg.nodeCount * 0.9)],
];
let successCount = 0, totalQueryTime = 0, maxIter = 0, maxExpanded = 0;
for (const [si, gi] of samplePairs) {
	const s = { x: vg.nodeX[si], y: vg.nodeY[si] };
	const g = { x: vg.nodeX[gi], y: vg.nodeY[gi] };
	const tQ = performance.now();
	const r = vg.astar(s, g);
	const dt = performance.now() - tQ;
	totalQueryTime += dt;
	if (r) {
		successCount++;
		maxIter = Math.max(maxIter, r.iterations);
		const len = r.path.reduce((acc, p, i, arr) => i ? acc + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) : 0, 0);
		console.log(`  pair (${si}→${gi}): path ${r.path.length} nodes, len=${len.toFixed(2)}, ${r.iterations} iters, ${dt.toFixed(2)}ms`);
	} else {
		console.log(`  pair (${si}→${gi}): NO PATH, ${dt.toFixed(2)}ms`);
	}
}
let expanded = 0;
for (let i = 0; i < vg.adjCache.length; i++) if (vg.adjCache[i]) expanded++;
maxExpanded = expanded;
console.log(`  success: ${successCount}/${samplePairs.length}  total=${totalQueryTime.toFixed(1)}ms  avg=${(totalQueryTime / samplePairs.length).toFixed(2)}ms  nodesExpanded(cached)=${expanded}/${vg.nodeCount}  maxIter=${maxIter}`);

// Repeat all queries to show fully-cached speed.
const t3 = performance.now();
for (const [si, gi] of samplePairs) {
	vg.astar({ x: vg.nodeX[si], y: vg.nodeY[si] }, { x: vg.nodeX[gi], y: vg.nodeY[gi] });
}
console.log(`  repeat all (cached): ${(performance.now() - t3).toFixed(2)}ms`);

// Also time raw LOS oracle cost.
let losCalls = 0, losBlocked = 0;
const t4 = performance.now();
for (let i = 0; i < vg.nodeCount; i++) {
	for (let j = i + 1; j < Math.min(i + 50, vg.nodeCount); j++) {
		losCalls++;
		if (!vg.losClear(vg.nodeX[i], vg.nodeY[i], vg.nodeX[j], vg.nodeY[j])) losBlocked++;
	}
}
const tLOS = performance.now() - t4;
console.log(`--- LOS oracle bulk (${losCalls} calls, ${losBlocked} blocked) ---`);
console.log(`  total=${tLOS.toFixed(2)}ms  per-call=${(tLOS * 1000 / losCalls).toFixed(2)}us`);

// Point query (start/goal off-graph) — splice test.
console.log('--- A* off-graph point queries ---');
const offPairs = [
	[{ x: vg.nodeX[0] + 0.5, y: vg.nodeY[0] + 0.5 }, { x: vg.nodeX[253] + 0.5, y: vg.nodeY[253] + 0.5 }],
	[{ x: vg.nodeX[101] + 0.5, y: vg.nodeY[101] + 0.5 }, { x: vg.nodeX[507] + 0.5, y: vg.nodeY[507] + 0.5 }],
	[{ x: vg.nodeX[202] + 0.5, y: vg.nodeY[202] + 0.5 }, { x: vg.nodeX[811] + 0.5, y: vg.nodeY[811] + 0.5 }],
	[{ x: 0, y: 0 }, { x: 100, y: 100 }],
];
for (let i = 0; i < offPairs.length; i++) {
	const [s, g] = offPairs[i];
	const t5 = performance.now();
	const r2 = vg.astar(s, g);
	const tOff = performance.now() - t5;
	if (r2) {
		const len = r2.path.reduce((acc, p, j, arr) => j ? acc + Math.hypot(p.x - arr[j - 1].x, p.y - arr[j - 1].y) : 0, 0);
		console.log(`  pair ${i}: ${r2.path.length} hops, len=${len.toFixed(2)}, ${r2.iterations} iters, ${tOff.toFixed(2)}ms`);
	} else {
		console.log(`  pair ${i}: NO PATH, ${tOff.toFixed(2)}ms`);
	}
}
