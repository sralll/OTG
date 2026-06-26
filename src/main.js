// main.js — wires up the control panel, generation core, and renderer.
// No build step: this is loaded directly as <script type="module">.

import { generateCity } from './core/Model.js';
import { attachViewport } from './render/viewport.js';
import { renderCity } from './render/svgRenderer.js';

const svgEl = document.getElementById('city-svg');
const groupEl = document.getElementById('viewport');
const statusEl = document.getElementById('status');

const els = {
	seed: document.getElementById('seed'),
	randomSeed: document.getElementById('random-seed'),
	nPatches: document.getElementById('nPatches'),
	nPatchesValue: document.getElementById('nPatches-value'),
	extraSquares: document.getElementById('extraSquares'),
	walls: document.getElementById('walls'),
	plaza: document.getElementById('plaza'),
	citadel: document.getElementById('citadel'),
	cathedral: document.getElementById('cathedral'),
	widthMain: document.getElementById('width-main'),
	widthRegular: document.getElementById('width-regular'),
	widthAlley: document.getElementById('width-alley'),
	waterEnabled: document.getElementById('water-enabled'),
	seaEnabled: document.getElementById('sea-enabled'),
	coastDistance: document.getElementById('coast-distance'),
	coastWaviness: document.getElementById('coast-waviness'),
	riverEnabled: document.getElementById('river-enabled'),
	riverWidth: document.getElementById('river-width'),
	riverAmplitude: document.getElementById('river-amplitude'),
	riverFrequency: document.getElementById('river-frequency'),
	curvedWards: document.getElementById('curved-wards'),
	showMarkers: document.getElementById('show-markers'),
	regenerate: document.getElementById('regenerate'),
	fitView: document.getElementById('fit-view'),
};

const viewport = attachViewport(svgEl, groupEl);

let lastCityData = null;

function readParams() {
	return {
		seed: parseInt(els.seed.value, 10) || 1,
		nPatches: parseInt(els.nPatches.value, 10),
		features: {
			walls: els.walls.checked,
			plaza: els.plaza.checked,
			citadel: els.citadel.checked,
			cathedral: els.cathedral.checked,
			extraSquares: parseInt(els.extraSquares.value, 10) || 0,
		},
		streetWidths: {
			main: parseFloat(els.widthMain.value) || 2.0,
			regular: parseFloat(els.widthRegular.value) || 1.0,
			alley: parseFloat(els.widthAlley.value) || 0.6,
		},
		water: readWaterParams(),
		meshSmoothing: { enabled: els.curvedWards.checked },
	};
}

function num(el, fallback) {
	const v = parseFloat(el.value);
	return Number.isFinite(v) ? v : fallback; // allow 0 (e.g. straight river / flat coast)
}

function readWaterParams() {
	return {
		enabled: els.waterEnabled.checked,
		sea: els.seaEnabled.checked
			? { distance: num(els.coastDistance, 1.1), waviness: num(els.coastWaviness, 0.18) }
			: false,
		river: {
			enabled: els.riverEnabled.checked,
			width: num(els.riverWidth, 0.16),
			amplitude: num(els.riverAmplitude, 0.5),
			frequency: num(els.riverFrequency, 2.5),
		},
	};
}

function setStatus(text, isError = false) {
	statusEl.textContent = text;
	statusEl.classList.toggle('error', isError);
}

function randomSeed() {
	// Positive integer, safely within Number range used by the core (N = 2147483647).
	return Math.floor(Math.random() * 2147483646) + 1;
}

function regenerate(refit = true) {
	const params = readParams();
	try {
		const cityData = generateCity(params);
		lastCityData = cityData;
		renderCity(groupEl, cityData, {
			showMarkers: els.showMarkers.checked,
			streetWidths: params.streetWidths,
		});
		if (refit) viewport.fit(cityData.bounds);

		setStatus(
			`OK — seed=${cityData.seed}  patches=${cityData.patches.length}  ` +
				`arteries=${cityData.arteries.length}  walls=${cityData.walls.length}  gates=${cityData.gates.length}`
		);
	} catch (e) {
		console.error(e);
		setStatus(`Error: ${e && e.message ? e.message : e}`, true);
	}
}

els.nPatches.addEventListener('input', () => {
	els.nPatchesValue.textContent = els.nPatches.value;
});

els.randomSeed.addEventListener('click', () => {
	els.seed.value = String(randomSeed());
	regenerate(true);
});

els.regenerate.addEventListener('click', () => regenerate(true));

els.fitView.addEventListener('click', () => {
	if (lastCityData) viewport.fit(lastCityData.bounds);
});

els.showMarkers.addEventListener('change', () => {
	if (lastCityData) {
		const params = readParams();
		renderCity(groupEl, lastCityData, {
			showMarkers: els.showMarkers.checked,
			streetWidths: params.streetWidths,
		});
	}
});

// Initial render on load.
regenerate(true);
