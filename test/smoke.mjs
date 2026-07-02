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

function pointSegmentDistance(p, a, b) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy || 1;
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function pointDistanceToPolyline(p, path) {
	let best = Infinity;
	for (let i = 0; i < path.length - 1; i++)
		best = Math.min(best, pointSegmentDistance(p, path[i], path[i + 1]));
	return best;
}

function polygonDistanceToPoint(poly, point) {
	if (pointInPolygon(point, poly)) return 0;
	let best = Infinity;
	for (let i = 0; i < poly.length; i++)
		best = Math.min(best, pointSegmentDistance(point, poly[i], poly[(i + 1) % poly.length]));
	return best;
}

function pointInPolygon(p, poly) {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		const crosses = (a.y > p.y) !== (b.y > p.y);
		if (crosses) {
			const x = ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-12) + a.x;
			if (p.x < x) inside = !inside;
		}
	}
	return inside;
}

function polygonCentroid(poly) {
	let x = 0, y = 0;
	for (const p of poly) {
		x += p.x;
		y += p.y;
	}
	return { x: x / poly.length, y: y / poly.length };
}

function polygonArea(poly) {
	let sum = 0;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		sum += a.x * b.y - a.y * b.x;
	}
	return Math.abs(sum) / 2;
}

function chaikinSmooth(pts, iterations) {
	let a = pts;
	for (let it = 0; it < iterations; it++) {
		const h = [a[0]];
		for (let i = 1, n = a.length - 1; i < n; i++) {
			const g = a[i], p = a[i - 1], nx = a[i + 1];
			h.push({ x: g.x * 0.75 + p.x * 0.25, y: g.y * 0.75 + p.y * 0.25 });
			h.push({ x: g.x * 0.75 + nx.x * 0.25, y: g.y * 0.75 + nx.y * 0.25 });
		}
		h.push(a[a.length - 1]);
		a = h;
	}
	return a;
}

function visualRiverPath(river) {
	if (!river || !river.course || river.course.length < 2) return [];
	const course = river.delta
		? [{ x: (river.course[0].x + river.course[1].x) / 2, y: (river.course[0].y + river.course[1].y) / 2 }, ...river.course.slice(1)]
		: river.course;
	return chaikinSmooth(course, 3);
}

function bezierPoint(a, c1, c2, b, t) {
	const mt = 1 - t;
	const mt2 = mt * mt;
	const t2 = t * t;
	return {
		x: a.x * mt2 * mt + 3 * c1.x * mt2 * t + 3 * c2.x * mt * t2 + b.x * t2 * t,
		y: a.y * mt2 * mt + 3 * c1.y * mt2 * t + 3 * c2.y * mt * t2 + b.y * t2 * t,
	};
}

function previewDeltaFromPath(delta, path, width) {
	if (!delta || path.length < 2) return null;
	const p0 = path[0], p1 = path[1];
	const dx = p1.x - p0.x, dy = p1.y - p0.y;
	const len = Math.hypot(dx, dy) || 1;
	const tx = dx / len, ty = dy / len;
	const hw = width / 2;
	const a = { x: p0.x - ty * hw, y: p0.y + tx * hw };
	const b = { x: p0.x + ty * hw, y: p0.y - tx * hw };
	const right = Math.hypot(a.x - delta.right.x, a.y - delta.right.y) <= Math.hypot(b.x - delta.right.x, b.y - delta.right.y) ? a : b;
	const left = right === a ? b : a;
	const ctrlLen = Math.max(Math.hypot(delta.right.x - delta.rightCtrl1.x, delta.right.y - delta.rightCtrl1.y), len * 0.5);
	return {
		...delta,
		right,
		rightCtrl1: { x: right.x - tx * ctrlLen, y: right.y - ty * ctrlLen },
		leftCtrl2: { x: left.x - tx * ctrlLen, y: left.y - ty * ctrlLen },
		left,
	};
}

function visualDeltaMouthPolygon(river, samples = 24) {
	if (!river || !river.delta) return null;
	const path = visualRiverPath(river);
	const dl = previewDeltaFromPath(river.delta, path, river.width || 0);
	if (!dl) return null;
	const pts = [];
	for (let i = 0; i <= samples; i++)
		pts.push(bezierPoint(dl.right, dl.rightCtrl1, dl.rightCtrl2, dl.prevShore, i / samples));
	if (dl.isConvex) pts.push(dl.mouth);
	pts.push(dl.nextShore);
	for (let i = 1; i <= samples; i++)
		pts.push(bezierPoint(dl.nextShore, dl.leftCtrl1, dl.leftCtrl2, dl.left, i / samples));
	return pts;
}

function segmentsIntersect(a, b, c, d) {
	const abx = b.x - a.x, aby = b.y - a.y;
	const cdx = d.x - c.x, cdy = d.y - c.y;
	const acx = c.x - a.x, acy = c.y - a.y;
	const denom = abx * cdy - aby * cdx;
	if (Math.abs(denom) < 1e-9) return false;
	const t = (acx * cdy - acy * cdx) / denom;
	const u = (acx * aby - acy * abx) / denom;
	return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9;
}

function segmentSegmentDistance(a, b, c, d) {
	if (segmentsIntersect(a, b, c, d)) return 0;
	return Math.min(
		pointSegmentDistance(a, c, d),
		pointSegmentDistance(b, c, d),
		pointSegmentDistance(c, a, b),
		pointSegmentDistance(d, a, b)
	);
}

function polygonsIntersect(a, b) {
	for (const p of a) if (pointInPolygon(p, b)) return true;
	for (const p of b) if (pointInPolygon(p, a)) return true;
	for (let i = 0; i < a.length; i++)
		for (let j = 0; j < b.length; j++)
			if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]))
				return true;
	return false;
}

function polygonDistanceToPolygon(a, b) {
	if (!a || !b || a.length < 3 || b.length < 3) return Infinity;
	if (polygonsIntersect(a, b)) return 0;
	let best = Infinity;
	for (let i = 0; i < a.length; i++)
		for (let j = 0; j < b.length; j++)
			best = Math.min(best, segmentSegmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
	return best;
}

function polygonDistanceToPolyline(poly, path, step = 0.35) {
	let best = Infinity;
	for (const p of path) if (pointInPolygon(p, poly)) return 0;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		const steps = Math.max(1, Math.ceil(len / step));
		for (let k = 0; k <= steps; k++) {
			const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
			best = Math.min(best, pointDistanceToPolyline(p, path));
		}
	}
	return best;
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
		seed: 1918711411,
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
	const target = data.wards
		.filter((w) => !w.water && w.type === 'outerGarden')
		.map((w) => ({ ward: w, c: polygonCentroid(w.polygon) }))
		.reduce((best, item) => {
			const d = Math.hypot(item.c.x - 54.3, item.c.y + 206.8);
			return !best || d < best.distance ? { ...item, distance: d } : best;
		}, null);
	check(target && target.distance < 5, 'seed=1918711411 has the west-of-river outer garden ward');
	if (target) {
		const blocks = data.blocks.filter((b) => pointInPolygon(polygonCentroid(b), target.ward.polygon));
		const buildings = data.buildings.filter((b) => pointInPolygon(polygonCentroid(b.polygon), target.ward.polygon));
		check(blocks.length > 0, 'seed=1918711411 west-of-river outer garden keeps its block');
		check(buildings.length > 0, 'seed=1918711411 west-of-river outer garden keeps its buildings');
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
		// WIDE_MAIN_ROADS_50_FLAG: wider road-connected bridge shifts the near-side portal vertex.
		check(route.path.some((p) => Math.abs(p.x - 8.421314) < 1e-4 && Math.abs(p.y - 5.049534) < 1e-4), 'seed=42 bridge-side route exits from the near bridge side');
	}
}

{
	let highrises = 0;
	let stepped = 0;
	let minArea = Infinity;
	const minAreaByKind = { stepped: Infinity, ascendingStair: Infinity, lShape: Infinity };
	let stairRhythmChecks = 0;
	let stairRhythmViolations = 0;
	for (let seed = 1; seed <= 20; seed++) {
		const data = generateWards({
			seed,
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
		const highriseWards = data.wards.filter((w) => !w.water && w.type === 'outerHighrise');
		const stairRhythms = new Map();
		for (const b of data.buildings || []) {
			if (b.class !== 'highrise') continue;
			highrises++;
			const vertices = b.polygon.length;
			const kind = vertices === 12 || vertices === 16
				? 'stepped'
				: vertices === 14 || vertices === 19
					? 'ascendingStair'
					: vertices === 6
						? 'lShape'
						: null;
			const area = polygonArea(b.polygon);
			minArea = Math.min(minArea, area);
			if (kind) minAreaByKind[kind] = Math.min(minAreaByKind[kind], area);
			if (kind === 'stepped') stepped++;
			if (kind === 'stepped' || kind === 'ascendingStair') {
				const c = polygonCentroid(b.polygon);
				const wardIndex = highriseWards.findIndex((w) => pointInPolygon(c, w.polygon));
				if (wardIndex >= 0) {
					const key = `${wardIndex}:${kind}`;
					if (!stairRhythms.has(key)) stairRhythms.set(key, new Set());
					stairRhythms.get(key).add(vertices);
				}
			}
		}
		for (const rhythm of stairRhythms.values()) {
			stairRhythmChecks++;
			if (rhythm.size > 1) stairRhythmViolations++;
		}
	}
	check(highrises > 1000, `outer highrise regression has enough samples (${highrises})`);
	check(stepped / highrises < 0.40, `outer highrise stepped/H-like frequency stays reduced (${(stepped / highrises).toFixed(3)} < 0.400)`);
	check(minArea >= 12.0, `outer highrise minimum footprint area is not tiny (${minArea.toFixed(3)} >= 12.000)`);
	check(minAreaByKind.stepped >= 36.0, `stepped outer highrises keep a larger minimum (${minAreaByKind.stepped.toFixed(3)} >= 36.000)`);
	check(minAreaByKind.ascendingStair >= 22.0, `ascending-stair outer highrises keep a larger minimum (${minAreaByKind.ascendingStair.toFixed(3)} >= 22.000)`);
	check(minAreaByKind.lShape >= 12.0, `L-shaped outer highrises keep a larger minimum (${minAreaByKind.lShape.toFixed(3)} >= 12.000)`);
	check(stairRhythmChecks > 100, `outer highrise stair rhythm regression has enough ward samples (${stairRhythmChecks})`);
	check(stairRhythmViolations === 0, `outer highrise stair rhythm is fixed per ward (${stairRhythmViolations} mixed rhythms)`);
}

for (const seed of [4, 5, 9, 42, 44, 64]) {
	const data = generateWards({
		seed,
		size: 15,
		plaza: true,
		coast: true,
		river: true,
		walls: true,
		streets: true,
	});
	const plaza = data.wards.find((w) => w.type === 'plaza');
	const riverPath = visualRiverPath(data.river);
	const clearance = (data.river?.width || 0) / 2 + 1.0;
	check(plaza && riverPath.length >= 2, `seed=${seed}: has plaza and river for plaza clearance regression`);
	if (plaza && riverPath.length >= 2) {
		for (const f of data.features || []) {
			if (f.kind !== 'tree' || !pointInPolygon(f, plaza.polygon)) continue;
			const d = pointDistanceToPolyline(f, riverPath);
			check(d >= clearance - 0.05, `seed=${seed}: plaza tree keeps river clearance (${d.toFixed(3)} >= ${(clearance - 0.05).toFixed(3)})`);
		}
		for (const b of data.buildings || []) {
			if (b.class !== 'plazaBuilding') continue;
			const d = polygonDistanceToPolyline(b.polygon, riverPath);
			check(d >= clearance - 0.05, `seed=${seed}: plaza building keeps river clearance (${d.toFixed(3)} >= ${(clearance - 0.05).toFixed(3)})`);
		}
	}
}

{
	const data = generateWards({
		seed: 7,
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
	const riverPath = visualRiverPath(data.river);
	const clearance = (data.river?.width || 0) / 2 + 2.0 + 0.25;
	let minBuildingDistance = Infinity;
	for (const b of data.buildings || [])
		minBuildingDistance = Math.min(minBuildingDistance, polygonDistanceToPolyline(b.polygon, riverPath));
	check(
		minBuildingDistance >= clearance - 0.08,
		`seed=7: buildings keep river/shore clearance (${minBuildingDistance.toFixed(3)} >= ${(clearance - 0.08).toFixed(3)})`
	);

	const mouth = visualDeltaMouthPolygon(data.river);
	const mouthClearance = 2.0 + 0.25;
	let minMouthDistance = Infinity;
	for (const b of data.buildings || [])
		minMouthDistance = Math.min(minMouthDistance, polygonDistanceToPolygon(b.polygon, mouth));
	check(
		minMouthDistance >= mouthClearance - 0.08,
		`seed=7: buildings keep river-mouth passage (${minMouthDistance.toFixed(3)} >= ${(mouthClearance - 0.08).toFixed(3)})`
	);
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
	const vg = buildVisibilityGraph({
		polygons: [{
			kind: 'building',
			polygon: [
				{ x: 4, y: -11 },
				{ x: 6, y: -11 },
				{ x: 6, y: 11 },
				{ x: 4, y: 11 },
			],
		}],
		lines: [],
		portals: [],
	}, { clearance: 0 });
	const start = { x: 0, y: 0 };
	const goal = { x: 10, y: 0 };
	const unrestricted = vg.astar(start, goal, { exact: true, timeBudgetMs: 0, maxExpansions: 100000 });
	check(unrestricted && unrestricted.path.some((p) => Math.abs(p.y) > 10), 'unrestricted synthetic route can detour beyond the start-goal lateral limit');
	const bounded = vg.astar(start, goal, { exact: true, timeBudgetMs: 0, maxExpansions: 100000, maxStartGoalPerpendicularFactor: 1 });
	check(!bounded && vg.lastAstarRejectedByLateralLimit, 'route rejects nodes farther sideways than the start-goal distance');
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
		// Tower/river-mouth corner chamfers (TOWER_CLEARANCE, riverWidth/2) shift buildable
		// areas and later building placement; keep both fixtures on open ground.
		{ x: -37, y: 6.5 },
		{ x: -80, y: -15 },
		{ exact: true, timeBudgetMs: 0, maxExpansions: 1000000 },
	);
	check(route && route.path.length >= 2, 'seed=42 house-corner route is passable');
	if (route) {
		const usesWaterNode = route.path.some((p) => routePointOwnerKinds(vg, p).some((kind) => kind === 'water' || kind === 'river' || kind === 'delta'));
		check(!usesWaterNode, 'seed=42 house-corner route does not need a shore tangent node');
	}
}

{
	const data = generateWards({ seed: 42, size: 30, outerRatio: 4, roadDensity: 5, gates: -1 });
	const towerRadius = 1.6;
	let closest = Infinity;
	let closestLabel = '';
	for (const tower of data.wall.towers || []) {
		for (let i = 0; i < data.blocks.length; i++) {
			const d = polygonDistanceToPoint(data.blocks[i], tower);
			if (d < closest) {
				closest = d;
				closestLabel = `block ${i}`;
			}
		}
		for (let i = 0; i < data.buildings.length; i++) {
			const d = polygonDistanceToPoint(data.buildings[i].polygon, tower);
			if (d < closest) {
				closest = d;
				closestLabel = `${data.buildings[i].class || 'building'} ${i}`;
			}
		}
	}
	check(closest >= towerRadius - 1e-6, `seed=42 UI defaults: ${closestLabel} clears wall tower radius (${closest.toFixed(3)} >= ${towerRadius.toFixed(3)})`);
}

{
	const data = generateWards({ seed: 1035038042, size: 30, outerRatio: 4, roadDensity: 5, gates: -1 });
	const required = [
		{ x: 65.24961837909154, y: -26.236711778965844 },
		{ x: -24.94066648870882, y: -86.58624741790842 },
	];
	for (const p of required)
		check(
			data.river.bridges.some((b) => samePoint(b, p)),
			`seed=1035038042 has a bridge at wall-river road crossing (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`,
		);
	const bridgePortals = extractObstacles(data).portals.filter((p) => p.kind === 'bridge');
	check(bridgePortals.length === data.river.bridges.length, 'seed=1035038042 exposes every bridge as an obstacle portal');
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
