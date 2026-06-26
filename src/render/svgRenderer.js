// svgRenderer.js — builds the SVG scene graph for a generated city.
// Pure DOM/SVG, no dependencies. renderCity() clears groupEl and re-populates it.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Default palette: muted, distinct, legible colors. Provisional — easy to restyle later.
const DEFAULT_PALETTE = {
	patchFill: {
		plaza: '#d8cfa8',
		market: '#d9b97a',
		cathedral: '#b79bbf',
		castle: '#c98a8a',
		gate: '#a9b3a0',
		generic: '#b9c2a8',
		farm: '#c4cf9a',
	},
	patchStroke: {
		plaza: '#a89c6c',
		market: '#a6843f',
		cathedral: '#8a6a93',
		castle: '#92484a',
		gate: '#74806c',
		generic: '#838f6e',
		farm: '#94a263',
	},
	blockFill: '#888888',
	building: '#6c6c6c',
	buildingStroke: '#000000',
	garden: '#a6b93c',
	gardenStroke: '#000000',
	// Alleys drawn as the block color on top of buildings -> reads as a gap, not a road.
	alley: '#c8c8c8',
	water: '#9ec6dd',
	waterStroke: '#5d829c',
	bridgeDock: '#c8a46a',
	bridgeDockOutline: '#000000',
	wall: '#888888',
	castleWall: '#888888',
	wallOutline: '#000000',
	tower: '#888888',
	gateDot: '#c0392b',
	center: '#2266cc',
	background: '#e9e4d4',
	// Orienteering landmarks dropped into chamfered corner gaps (green tree / blue fountain).
	featureTree: '#2f8f3e',
	featureFountain: '#2b7fc4',
	featureOutline: '#1c1c1c',
};

function ns(tag) {
	return document.createElementNS(SVG_NS, tag);
}

function pointsAttr(pts) {
	return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

function makePolygon(pts, { fill, stroke, strokeWidth, nonScaling } = {}) {
	const el = ns('polygon');
	el.setAttribute('points', pointsAttr(pts));
	if (fill != null) el.setAttribute('fill', fill);
	if (stroke != null) el.setAttribute('stroke', stroke);
	if (strokeWidth != null) el.setAttribute('stroke-width', String(strokeWidth));
	// Thin outlines use non-scaling-stroke so they stay a constant pixel width
	// regardless of zoom level (the parent <g> is scaled for pan/zoom).
	if (nonScaling) el.setAttribute('vector-effect', 'non-scaling-stroke');
	return el;
}

function makePolyline(pts, { stroke, strokeWidth, linecap = 'round', linejoin = 'round', opacity } = {}) {
	const el = ns('polyline');
	el.setAttribute('points', pointsAttr(pts));
	el.setAttribute('fill', 'none');
	if (stroke != null) el.setAttribute('stroke', stroke);
	if (strokeWidth != null) el.setAttribute('stroke-width', String(strokeWidth));
	el.setAttribute('stroke-linecap', linecap);
	el.setAttribute('stroke-linejoin', linejoin);
	if (opacity != null) el.setAttribute('opacity', String(opacity));
	return el;
}

// Tangent-continuous cubic smoothing, ported from the reference's Cubic.smoothOpen. Control
// handle lengths are curvature-aware (scaled by segment length and the turn angle), so a road
// keeps going in the direction it was heading instead of turning abruptly at each cell vertex.
function norm(x, y) {
	const l = Math.hypot(x, y) || 1;
	return { x: x / l, y: y / l };
}
function smoothPathD(pts) {
	if (pts.length < 2) return '';
	if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;

	// extrapolate virtual endpoints by reflecting the end turn (the reference's rotate trick)
	const extrap = (a, b, c) => {
		const ax = b.x - a.x;
		const ay = b.y - a.y;
		const bx = c.x - b.x;
		const by = c.y - b.y;
		const d = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
		const sin = (ax * by - ay * bx) / d;
		const cos = (ax * bx + ay * by) / d;
		return { x: c.x + (bx * cos - by * sin), y: c.y + (by * cos + bx * sin) };
	};

	const a = [extrap(pts[2], pts[1], pts[0]), ...pts, extrap(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1])];

	let d = `M ${pts[0].x},${pts[0].y}`;
	for (let k = 1; k < a.length - 2; k++) {
		const g = a[k];
		const m = a[k + 1];
		const P = a[k + 2];
		const inD = norm(g.x - a[k - 1].x, g.y - a[k - 1].y);
		const segD = norm(m.x - g.x, m.y - g.y);
		const outD = norm(P.x - m.x, P.y - m.y);
		const tN = norm(inD.x + segD.x, inD.y + segD.y);
		const tP = norm(segD.x + outD.x, segD.y + outD.y);
		const L = Math.hypot(g.x - m.x, g.y - m.y);
		// 1/(1+dot+dot) blows up at sharp turns (cell-edge arteries have them) -> clamp the
		// handle length to [0, L] so we never emit Infinity coordinates (which hang rendering).
		let w = 1 / (1 + (tN.x * segD.x + tN.y * segD.y) + (tP.x * segD.x + tP.y * segD.y));
		if (!isFinite(w) || w < 0) w = 1 / 3;
		const q = L * Math.min(w, 1);
		d += ` C ${g.x + tN.x * q},${g.y + tN.y * q} ${m.x - tP.x * q},${m.y - tP.y * q} ${m.x},${m.y}`;
	}
	return d;
}

function makeSmoothPath(pts, { stroke, strokeWidth, opacity, linecap = 'round' } = {}) {
	const el = ns('path');
	el.setAttribute('d', smoothPathD(pts));
	el.setAttribute('fill', 'none');
	if (stroke != null) el.setAttribute('stroke', stroke);
	if (strokeWidth != null) el.setAttribute('stroke-width', String(strokeWidth));
	el.setAttribute('stroke-linecap', linecap);
	el.setAttribute('stroke-linejoin', 'round');
	if (opacity != null) el.setAttribute('opacity', String(opacity));
	return el;
}

// For a tower at a water/river endpoint (either adjacent segment suppressed or the tower
// is a river node), offset it along the active wall segment to where the wall actually
// ends (the pulled-back endpoint), so the tower sits on land, not in the water.
function adjustedTowerPos(wall, tower, riverWidth, riverNodes, towerR) {
	const n = wall.shape.length;
	const segs = wall.segments;
	if (!segs) return tower;
	const idx = wall.shape.findIndex((v) => Math.abs(v.x - tower.x) < 1e-6 && Math.abs(v.y - tower.y) < 1e-6);
	if (idx === -1) return tower;
	const prevActive = segs[(idx + n - 1) % n] !== false;
	const nextActive = segs[idx] !== false;
	const isRiverNode = riverNodes && riverNodes.has(`${tower.x},${tower.y}`);
	// Only offset if the tower is at a water boundary (a suppressed neighbor) or is a river node.
	if (prevActive && nextActive && !isRiverNode) return tower;
	// Pick the direction along the active (on-land) segment.
	let dx = 0;
	let dy = 0;
	if (nextActive && !prevActive) {
		const next = wall.shape[(idx + 1) % n];
		dx = next.x - tower.x; dy = next.y - tower.y;
	} else if (prevActive && !nextActive) {
		const prev = wall.shape[(idx + n - 1) % n];
		dx = prev.x - tower.x; dy = prev.y - tower.y;
	} else if (isRiverNode) {
		// Both segments may be suppressed (river node at a shore); offset along whichever
		// neighbor is farther inland (longer edge = more on land).
		const prev = wall.shape[(idx + n - 1) % n];
		const next = wall.shape[(idx + 1) % n];
		const pLen = Math.hypot(prev.x - tower.x, prev.y - tower.y);
		const nLen = Math.hypot(next.x - tower.x, next.y - tower.y);
		if (nLen >= pLen) { dx = next.x - tower.x; dy = next.y - tower.y; }
		else { dx = prev.x - tower.x; dy = prev.y - tower.y; }
	} else {
		return tower; // both suppressed, not a river node — leave as-is
	}
	const len = Math.hypot(dx, dy) || 1;
	// Place the tower center where the wall ends (pulled back by halfRiver from the node),
	// plus the tower radius so the tower is fully clear of the water.
	const halfRiver = (riverWidth || 0) / 2;
	const offset = halfRiver + towerR;
	return { x: tower.x + dx / len * offset, y: tower.y + dy / len * offset };
}

// Build the wall as individual active segments (skip suppressed = water/coast segments).
// For segment endpoints that are river nodes OR adjacent to a suppressed segment, pull the
// endpoint back by half the river width so the wall extends toward the water but stops at
// the riverbank, not inside it.
function wallSegmentsPath(wall, riverWidth, riverNodes) {
	const shape = wall.shape;
	const segs = wall.segments;
	const n = shape.length;
	if (!segs || segs.length < n) return null;
	const halfRiver = (riverWidth || 0) / 2;
	let d = '';
	for (let i = 0; i < n; i++) {
		if (!segs[i]) continue;
		const a = shape[i];
		const b = shape[(i + 1) % n];
		let ax = a.x;
		let ay = a.y;
		let bx = b.x;
		let by = b.y;
		if (halfRiver > 0) {
			const dx = bx - ax;
			const dy = by - ay;
			const len = Math.hypot(dx, dy) || 1;
			// pull back at `a` if the previous segment is suppressed OR `a` is a river node
			if (!segs[(i + n - 1) % n] || (riverNodes && riverNodes.has(`${a.x},${a.y}`))) { ax += dx / len * halfRiver; ay += dy / len * halfRiver; }
			// pull back at `b` if the next segment is suppressed OR `b` is a river node
			if (!segs[(i + 1) % n] || (riverNodes && riverNodes.has(`${b.x},${b.y}`))) { bx -= dx / len * halfRiver; by -= dy / len * halfRiver; }
		}
		d += `M${ax},${ay} L${bx},${by} `;
	}
	return d || null;
}

function makePath(d, { stroke, strokeWidth, linecap = 'butt', linejoin = 'round' } = {}) {
	const el = ns('path');
	el.setAttribute('d', d);
	el.setAttribute('fill', 'none');
	if (stroke != null) el.setAttribute('stroke', stroke);
	if (strokeWidth != null) el.setAttribute('stroke-width', String(strokeWidth));
	el.setAttribute('stroke-linecap', linecap);
	el.setAttribute('stroke-linejoin', linejoin);
	return el;
}

function makeCircle(p, r, { fill, stroke, strokeWidth, nonScaling } = {}) {
	const el = ns('circle');
	el.setAttribute('cx', String(p.x));
	el.setAttribute('cy', String(p.y));
	el.setAttribute('r', String(r));
	if (fill != null) el.setAttribute('fill', fill);
	if (stroke != null) el.setAttribute('stroke', stroke);
	if (strokeWidth != null) el.setAttribute('stroke-width', String(strokeWidth));
	if (nonScaling) el.setAttribute('vector-effect', 'non-scaling-stroke');
	return el;
}

function makeGateSquare(gate, wall, size, { fill, stroke, strokeWidth } = {}) {
	const idx = wall.shape.findIndex((p) => Math.abs(p.x - gate.x) < 1e-6 && Math.abs(p.y - gate.y) < 1e-6);
	const h = size / 2;
	let tx = 1;
	let ty = 0;
	if (idx !== -1) {
		const prev = wall.shape[(idx + wall.shape.length - 1) % wall.shape.length];
		const next = wall.shape[(idx + 1) % wall.shape.length];
		const dx = next.x - prev.x;
		const dy = next.y - prev.y;
		const len = Math.hypot(dx, dy) || 1;
		tx = dx / len;
		ty = dy / len;
	}
	const nx = -ty;
	const ny = tx;
	return makePolygon(
		[
			{ x: gate.x - tx * h - nx * h, y: gate.y - ty * h - ny * h },
			{ x: gate.x + tx * h - nx * h, y: gate.y + ty * h - ny * h },
			{ x: gate.x + tx * h + nx * h, y: gate.y + ty * h + ny * h },
			{ x: gate.x - tx * h + nx * h, y: gate.y - ty * h + ny * h },
		],
		{ fill, stroke, strokeWidth }
	);
}

export function renderCity(groupEl, cityData, options = {}) {
	const palette = options.palette || DEFAULT_PALETTE;
	const showMarkers = !!options.showMarkers;
	// cityData itself has no streetWidths field (Model.toData() doesn't echo the config),
	// so callers should pass it via options; fall back to sensible defaults otherwise.
	const widths = options.streetWidths || (cityData && cityData.streetWidths) || { main: 2.0, regular: 1.0, alley: 0.8 };

	while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);

	const layerOcean = ns('g');
	layerOcean.setAttribute('id', 'layer-ocean');
	const layerPatches = ns('g');
	layerPatches.setAttribute('id', 'layer-patches');
	const layerBlocks = ns('g');
	layerBlocks.setAttribute('id', 'layer-blocks');
	const layerBuildings = ns('g');
	layerBuildings.setAttribute('id', 'layer-buildings');
	const layerAlleys = ns('g');
	layerAlleys.setAttribute('id', 'layer-alleys');
	const layerRiver = ns('g');
	layerRiver.setAttribute('id', 'layer-river');
	const layerArteries = ns('g');
	layerArteries.setAttribute('id', 'layer-arteries');
	const layerWalls = ns('g');
	layerWalls.setAttribute('id', 'layer-walls');
	const layerMarkers = ns('g');
	layerMarkers.setAttribute('id', 'layer-markers');

	// Ocean at the very bottom (whole water cells -> cell-aligned natural coast); the river
	// is drawn over the buildings since it cuts through them; roads/bridges on top of that.
	groupEl.appendChild(layerOcean);
	groupEl.appendChild(layerPatches);
	groupEl.appendChild(layerBlocks);
	groupEl.appendChild(layerBuildings);
	groupEl.appendChild(layerAlleys);
	groupEl.appendChild(layerRiver);
	groupEl.appendChild(layerArteries);
	groupEl.appendChild(layerWalls);
	groupEl.appendChild(layerMarkers);

	// 0. Ocean: sea backdrop + whole water cells.
	if (cityData.water) {
		const w = cityData.water;
		if (w.sea && w.sea.length >= 3) layerOcean.appendChild(makePolygon(w.sea, { fill: palette.water }));
		for (const cell of w.oceanCells || []) {
			if (cell && cell.length >= 3) layerOcean.appendChild(makePolygon(cell, { fill: palette.water }));
		}
	}

	// 1. Ward ground: a faint type-colored fill, NO cell outline (the reference doesn't draw the
	// raw Voronoi edges — drawing them produced a "honeycomb" look). Districts read via fill +
	// the buildings on top; streets read as the gaps between buildings.
	for (const patch of cityData.patches || []) {
		if (patch.isWater) continue;
		if (!patch.polygon || patch.polygon.length < 3) continue;
		const fill = palette.patchFill[patch.type] || palette.patchFill.generic;
		const el = makePolygon(patch.polygon, { fill, stroke: 'none' });
		el.setAttribute('fill-opacity', '0.4');
		layerPatches.appendChild(el);
	}

	const zones = [];
	for (const block of cityData.blocks || []) if (block && block.length >= 3) zones.push(block);
	for (const patch of cityData.patches || []) if (patch.block && patch.block.length >= 3) zones.push(patch.block);
	for (const zone of zones) layerBlocks.appendChild(makePolygon(zone, { fill: palette.blockFill, stroke: 'none' }));

	// (no per-cell block layer — the buildings below are the content; ward ground is the fill above)

	// 2b. Buildings: the subdivided lots (flat list; residential ones come from merged districts
	// so blocks relate across cells). This is the main city texture.
	// scaling stroke (in user units) — NOT non-scaling: thousands of non-scaling strokes are
	// very slow to rasterize (and would lag on a phone).
	for (const b of cityData.buildings || []) {
		const polygon = Array.isArray(b) ? b : b.polygon;
		if (!polygon || polygon.length < 3) continue;
		const isGarden = !Array.isArray(b) && b.class === 'garden';
		layerBuildings.appendChild(makePolygon(polygon, {
			fill: isGarden ? palette.garden : palette.building,
			stroke: isGarden ? palette.gardenStroke : palette.buildingStroke,
			strokeWidth: 0.18,
		}));
	}

	// 2c. Alleys: hidden for now.
	// for (const alley of cityData.alleys || []) {
	// 	if (!alley || alley.length < 2) continue;
	// 	layerAlleys.appendChild(makePolyline(alley, { stroke: palette.alley, strokeWidth: 0.8 }));
	// }

	// 2c. River: drawn as a thick stroke along its cell-edge path (over the buildings it
	// cuts through). Butt linecap so the stroke ends cleanly at the coast (no round bump).
	if (cityData.water && cityData.water.riverPath && cityData.water.riverPath.length >= 2) {
		const w = cityData.water.riverWidth || 1;
		layerRiver.appendChild(makeSmoothPath(cityData.water.riverPath, { stroke: palette.waterStroke, strokeWidth: w * 1.18, linecap: 'butt' }));
		layerRiver.appendChild(makeSmoothPath(cityData.water.riverPath, { stroke: palette.water, strokeWidth: w, linecap: 'butt' }));
	}

	if (cityData.river && cityData.river.bridges) {
		const riverWidth = Number.isFinite(cityData.river.width) ? cityData.river.width : 5;
		const halfSpan = riverWidth * 0.6;
		for (const bridge of cityData.river.bridges) {
			let d = '';
			const along = (edgePoint) => {
				const dx = edgePoint.x - bridge.x, dy = edgePoint.y - bridge.y;
				const len = Math.hypot(dx, dy) || 1;
				const dist = Math.min(len * 0.85, halfSpan);
				return { x: bridge.x + dx / len * dist, y: bridge.y + dy / len * dist };
			};
			if (bridge.from && bridge.to) {
				const a = along(bridge.from);
				const b = along(bridge.to);
				d = `M${a.x},${a.y} Q${bridge.x},${bridge.y} ${b.x},${b.y}`;
			} else {
				d = `M${bridge.x - halfSpan},${bridge.y} L${bridge.x + halfSpan},${bridge.y}`;
			}
			layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDockOutline, strokeWidth: 1.5, linecap: 'butt' }));
			layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDock, strokeWidth: 0.75, linecap: 'butt' }));
		}
	}

	for (const dock of cityData.docks || []) {
		const scale = dock.large ? 2 : 1;
		for (const pier of dock.piers || []) {
			if (!pier.from || !pier.to) continue;
			const d = `M${pier.from.x},${pier.from.y} L${pier.to.x},${pier.to.y}`;
			layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDockOutline, strokeWidth: 3.0 * scale, linecap: 'butt' }));
			layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDock, strokeWidth: 1.5 * scale, linecap: 'butt' }));
		}
	}

	// 3. Roads are intentionally not drawn; their geometry still creates building-zone insets.
	const mainWidth = widths.main || 2.0;

	// 4. Walls: drawn as individual segments (skip suppressed = river/coast segments).
	// Towers as small filled circles, gates as small contrasting dots.
	const riverWidth = (cityData.water && cityData.water.riverWidth) || 0;
	// Build a Set of river-node coordinate keys for endpoint pullback (walls extend toward
	// the river but stop at the riverbank). Uses a string key because toData() produces
	// fresh plain objects — reference equality wouldn't match.
	const riverNodes = new Set();
	if (cityData.water && cityData.water.riverPath) {
		for (const v of cityData.water.riverPath) riverNodes.add(`${v.x},${v.y}`);
	}
	for (const wall of cityData.walls || []) {
		if (!wall.shape || wall.shape.length < 3) continue;
		const isCastle = !!wall.isCastle;
		const strokeColor = isCastle ? palette.castleWall : palette.wall;
		const strokeWidth = 0.18; // match building lot stroke width
		const segPath = wallSegmentsPath(wall, riverWidth, riverNodes);
		if (segPath) {
			layerWalls.appendChild(makePath(segPath, { stroke: palette.wallOutline, strokeWidth: strokeWidth + 0.45, linecap: 'round' }));
			layerWalls.appendChild(makePath(segPath, { stroke: strokeColor, strokeWidth, linecap: 'round' }));
		} else {
			const outline = makePolygon(wall.shape, { fill: 'none', stroke: palette.wallOutline, strokeWidth: strokeWidth + 0.45 });
			outline.setAttribute('stroke-linejoin', 'round');
			layerWalls.appendChild(outline);
			const el = makePolygon(wall.shape, { fill: 'none', stroke: strokeColor, strokeWidth });
			el.setAttribute('stroke-linejoin', 'round');
			layerWalls.appendChild(el);
		}

		const towerR = Math.max(mainWidth * 1.5, 0.6);
		for (const t of wall.towers || []) {
			const pos = adjustedTowerPos(wall, t, riverWidth, riverNodes, towerR);
			layerWalls.appendChild(makeCircle(pos, towerR, { fill: palette.tower, stroke: palette.wallOutline, strokeWidth: 0.18 }));
		}

		for (const g of wall.gates || []) {
			// Skip gates at river nodes — those are bridges with towers, not gates.
			if (riverNodes.has(`${g.x},${g.y}`)) continue;
			layerWalls.appendChild(makeGateSquare(g, wall, strokeWidth, { fill: palette.gateDot, stroke: '#fff', strokeWidth: 0.2 }));
		}
	}

	// 5. Chamfer features: small green (tree) / blue (fountain) circles where a corner
	// triangle was cut off a buildable area or building lot. Kept small so each fits its gap.
	for (const f of cityData.features || []) {
		if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
		layerMarkers.appendChild(makeCircle(f, 0.45, {
			fill: f.kind === 'fountain' ? palette.featureFountain : palette.featureTree,
			stroke: palette.featureOutline,
			strokeWidth: 0.12,
		}));
	}

	// 6. Debug markers (optional): city center + all gates.
	if (showMarkers) {
		if (cityData.center) {
			const c = makeCircle(cityData.center, 1.5, {
				fill: 'none',
				stroke: palette.center,
				strokeWidth: 2,
				nonScaling: true,
			});
			layerMarkers.appendChild(c);
			const cross = ns('path');
			const r = 6;
			cross.setAttribute(
				'd',
				`M ${cityData.center.x - r},${cityData.center.y} L ${cityData.center.x + r},${cityData.center.y} ` +
					`M ${cityData.center.x},${cityData.center.y - r} L ${cityData.center.x},${cityData.center.y + r}`
			);
			cross.setAttribute('stroke', palette.center);
			cross.setAttribute('stroke-width', '1');
			cross.setAttribute('vector-effect', 'non-scaling-stroke');
			layerMarkers.appendChild(cross);
		}
		for (const g of cityData.gates || []) {
			layerMarkers.appendChild(
				makeCircle(g, 1.2, { fill: palette.gateDot, stroke: '#fff', strokeWidth: 0.3, nonScaling: false })
			);
		}
	}
}

export { DEFAULT_PALETTE };
