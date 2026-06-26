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
	blockFill: {
		plaza: '#c9bd8e',
		market: '#c2a161',
		cathedral: '#9c7da6',
		castle: '#a76668',
		gate: '#85906f',
		generic: '#8d9870',
		farm: '#a3af74',
	},
	blockStroke: '#4b4334',
	building: '#e9dec0',
	buildingStroke: '#3a332a',
	water: '#9ec6dd',
	waterStroke: '#5d829c',
	road: '#5a5247',
	roadCenter: '#84796a',
	wall: '#3a352c',
	castleWall: '#2a2620',
	tower: '#2a2620',
	gateDot: '#c0392b',
	center: '#2266cc',
	background: '#e9e4d4',
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

function makeSmoothPath(pts, { stroke, strokeWidth, opacity } = {}) {
	const el = ns('path');
	el.setAttribute('d', smoothPathD(pts));
	el.setAttribute('fill', 'none');
	if (stroke != null) el.setAttribute('stroke', stroke);
	if (strokeWidth != null) el.setAttribute('stroke-width', String(strokeWidth));
	el.setAttribute('stroke-linecap', 'round');
	el.setAttribute('stroke-linejoin', 'round');
	if (opacity != null) el.setAttribute('opacity', String(opacity));
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

export function renderCity(groupEl, cityData, options = {}) {
	const palette = options.palette || DEFAULT_PALETTE;
	const showMarkers = !!options.showMarkers;
	// cityData itself has no streetWidths field (Model.toData() doesn't echo the config),
	// so callers should pass it via options; fall back to sensible defaults otherwise.
	const widths = options.streetWidths || (cityData && cityData.streetWidths) || { main: 2.0, regular: 1.0, alley: 0.6 };

	while (groupEl.firstChild) groupEl.removeChild(groupEl.firstChild);

	const layerOcean = ns('g');
	layerOcean.setAttribute('id', 'layer-ocean');
	const layerPatches = ns('g');
	layerPatches.setAttribute('id', 'layer-patches');
	const layerBlocks = ns('g');
	layerBlocks.setAttribute('id', 'layer-blocks');
	const layerBuildings = ns('g');
	layerBuildings.setAttribute('id', 'layer-buildings');
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

	// (no per-cell block layer — the buildings below are the content; ward ground is the fill above)

	// 2b. Buildings: the subdivided lots (flat list; residential ones come from merged districts
	// so blocks relate across cells). This is the main city texture.
	// scaling stroke (in user units) — NOT non-scaling: thousands of non-scaling strokes are
	// very slow to rasterize (and would lag on a phone).
	for (const b of cityData.buildings || []) {
		if (!b || b.length < 3) continue;
		layerBuildings.appendChild(makePolygon(b, { fill: palette.building, stroke: palette.buildingStroke, strokeWidth: 0.15 }));
	}

	// 2c. River: drawn as a thick rounded stroke along its cell-edge path (over the buildings it
	// cuts through). A stroked polyline avoids the self-intersection a single offset band can get
	// at sharp bends, and the width scales with the map since it's a real width.
	if (cityData.water && cityData.water.riverPath && cityData.water.riverPath.length >= 2) {
		const w = cityData.water.riverWidth || 1;
		// darker bank underneath, water on top -> thin defining rim (smooth curve)
		layerRiver.appendChild(makeSmoothPath(cityData.water.riverPath, { stroke: palette.waterStroke, strokeWidth: w * 1.18 }));
		layerRiver.appendChild(makeSmoothPath(cityData.water.riverPath, { stroke: palette.water, strokeWidth: w }));
	}

	// 3. Arteries: thick road strokes that scale with the map (they represent real street width),
	// plus a thinner lighter centerline on top for a "paved" look.
	const mainWidth = widths.main || 2.0;
	for (const artery of cityData.arteries || []) {
		if (!artery || artery.length < 2) continue;
		// smooth cubic curve -> roads bend at a nice radius instead of angular polyline joints
		layerArteries.appendChild(makeSmoothPath(artery, { stroke: palette.road, strokeWidth: mainWidth }));
		layerArteries.appendChild(makeSmoothPath(artery, { stroke: palette.roadCenter, strokeWidth: mainWidth * 0.3, opacity: 0.6 }));
	}

	// 4. Walls: stroked polygon (no fill), thicker if castle wall. Towers as small filled
	// circles, gates as small contrasting dots.
	for (const wall of cityData.walls || []) {
		if (!wall.shape || wall.shape.length < 3) continue;
		const isCastle = !!wall.isCastle;
		const strokeColor = isCastle ? palette.castleWall : palette.wall;
		const strokeWidth = isCastle ? mainWidth * 0.9 : mainWidth * 0.6;
		const el = makePolygon(wall.shape, { fill: 'none', stroke: strokeColor, strokeWidth });
		el.setAttribute('stroke-linejoin', 'round');
		layerWalls.appendChild(el);

		const towerR = Math.max(mainWidth * 0.55, 0.6);
		for (const t of wall.towers || []) {
			layerWalls.appendChild(makeCircle(t, towerR, { fill: palette.tower }));
		}

		const gateR = Math.max(mainWidth * 0.45, 0.5);
		for (const g of wall.gates || []) {
			layerWalls.appendChild(makeCircle(g, gateR, { fill: palette.gateDot, stroke: '#fff', strokeWidth: 0.3 }));
		}
	}

	// 5. Debug markers (optional): city center + all gates.
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
