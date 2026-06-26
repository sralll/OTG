// viewport.js — pan/zoom controller for the city SVG.
// Mutates groupEl's `transform` attribute as `translate(tx,ty) scale(s)`.
// No dependencies, no build step: plain pointer events + wheel.

const MIN_SCALE = 0.05;
const MAX_SCALE = 200;
const WHEEL_ZOOM_FACTOR = 1.1;

export function attachViewport(svgEl, groupEl) {
	let tx = 0;
	let ty = 0;
	let scale = 1;

	// active pointers (mouse/touch) for 1-finger pan and 2-finger pinch-zoom
	const pointers = new Map();
	let lastPanX = 0;
	let lastPanY = 0;
	let lastDist = 0;
	let lastMidX = 0;
	let lastMidY = 0;

	function apply() {
		groupEl.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
	}

	function clampScale(s) {
		return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
	}

	// Convert a client-space (pixel) point to the SVG element's local pixel space,
	// accounting for the SVG's own bounding box (so this works regardless of CSS layout).
	function clientToSvgPoint(clientX, clientY) {
		const rect = svgEl.getBoundingClientRect();
		return { x: clientX - rect.left, y: clientY - rect.top };
	}

	function zoomAt(svgX, svgY, factor) {
		const newScale = clampScale(scale * factor);
		const actualFactor = newScale / scale;
		// Keep the point under the cursor fixed: (svgX - tx) / scale must stay constant.
		tx = svgX - (svgX - tx) * actualFactor;
		ty = svgY - (svgY - ty) * actualFactor;
		scale = newScale;
		apply();
	}

	function onWheel(ev) {
		ev.preventDefault();
		const { x, y } = clientToSvgPoint(ev.clientX, ev.clientY);
		const factor = ev.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
		zoomAt(x, y, factor);
	}

	// Re-establish gesture baselines from the current set of pointers (call after the set changes).
	function resetGesture() {
		const pts = [...pointers.values()];
		if (pts.length === 1) {
			lastPanX = pts[0].x;
			lastPanY = pts[0].y;
		} else if (pts.length >= 2) {
			lastMidX = (pts[0].x + pts[1].x) / 2;
			lastMidY = (pts[0].y + pts[1].y) / 2;
			lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
		}
	}

	function onPointerDown(ev) {
		pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		try {
			svgEl.setPointerCapture(ev.pointerId);
		} catch (e) {
			// ignore
		}
		resetGesture();
		svgEl.style.cursor = 'grabbing';
	}

	function onPointerMove(ev) {
		if (!pointers.has(ev.pointerId)) return;
		pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		const pts = [...pointers.values()];

		if (pts.length === 1) {
			// single-finger / mouse pan
			tx += pts[0].x - lastPanX;
			ty += pts[0].y - lastPanY;
			lastPanX = pts[0].x;
			lastPanY = pts[0].y;
			apply();
		} else if (pts.length >= 2) {
			// two-finger pinch-zoom about the midpoint, plus pan by midpoint movement
			const midX = (pts[0].x + pts[1].x) / 2;
			const midY = (pts[0].y + pts[1].y) / 2;
			const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;

			// pan (client px == svg-local px; the SVG rect offset is constant)
			tx += midX - lastMidX;
			ty += midY - lastMidY;

			// zoom about the current midpoint in SVG-local coordinates
			const m = clientToSvgPoint(midX, midY);
			zoomAt(m.x, m.y, dist / lastDist);

			lastMidX = midX;
			lastMidY = midY;
			lastDist = dist;
		}
	}

	function onPointerUp(ev) {
		if (!pointers.has(ev.pointerId)) return;
		pointers.delete(ev.pointerId);
		try {
			svgEl.releasePointerCapture(ev.pointerId);
		} catch (e) {
			// ignore: capture may already be released
		}
		resetGesture(); // avoid a jump when lifting one of two fingers
		if (pointers.size === 0) svgEl.style.cursor = 'grab';
	}

	svgEl.addEventListener('wheel', onWheel, { passive: false });
	svgEl.addEventListener('pointerdown', onPointerDown);
	svgEl.addEventListener('pointermove', onPointerMove);
	svgEl.addEventListener('pointerup', onPointerUp);
	svgEl.addEventListener('pointercancel', onPointerUp);
	svgEl.style.cursor = 'grab';

	function fit(bounds, padding = 0.08) {
		const w = svgEl.clientWidth || 1;
		const h = svgEl.clientHeight || 1;

		let bw = bounds.maxX - bounds.minX;
		let bh = bounds.maxY - bounds.minY;
		// Robust to zero-size or degenerate bounds.
		if (!(bw > 0)) bw = 1;
		if (!(bh > 0)) bh = 1;

		const cx = (bounds.minX + bounds.maxX) / 2;
		const cy = (bounds.minY + bounds.maxY) / 2;

		const availW = w * (1 - 2 * padding);
		const availH = h * (1 - 2 * padding);

		scale = clampScale(Math.min(availW / bw, availH / bh));
		tx = w / 2 - cx * scale;
		ty = h / 2 - cy * scale;
		apply();
	}

	function reset() {
		tx = 0;
		ty = 0;
		scale = 1;
		apply();
	}

	apply();

	return { fit, reset };
}
