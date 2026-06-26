// CurtainWall — port of com.watabou.towngenerator.building.CurtainWall + Model.findCircumference.
// Builds the outer ring of a set of patches and selects gates on it. Used for the city
// border (always, since it provides the road network's gates) and for the citadel/castle.

import { Point } from './Point.js';
import { Polygon } from './Polygon.js';
import { Patch } from './Patch.js';
import { Random } from './Random.js';
import { count, replace, amax } from './arrays.js';

// A boundary edge between a land and a water cell (biotope in the reference).
function isShoreEdge(model, v0, v1) {
	if (!model.patchByVertex) return false;
	const edgePatches = model.patchByVertex(v0).filter((p) => p.shape.findEdge(v0, v1) !== -1 || p.shape.findEdge(v1, v0) !== -1);
	return edgePatches.some((p) => p.isWater) && edgePatches.some((p) => !p.isWater);
}

// Outer boundary polygon of a group of patches (Model.findCircumference).
export function findCircumference(wards) {
	if (wards.length === 0) return new Polygon();
	if (wards.length === 1) return new Polygon(wards[0].shape);

	const A = [];
	const B = [];

	for (const w1 of wards)
		w1.shape.forEdge((a, b) => {
			let outerEdge = true;
			for (const w2 of wards)
				if (w2.shape.findEdge(b, a) !== -1) {
					outerEdge = false;
					break;
				}
			if (outerEdge) {
				A.push(a);
				B.push(b);
			}
		});

	const result = new Polygon();
	let index = 0;
	let guard = 0;
	do {
		result.push(A[index]);
		index = A.indexOf(B[index]);
		if (index === -1 || ++guard > A.length + 1) throw new Error('Broken circumference');
	} while (index !== 0);

	return result;
}

export class CurtainWall {
	constructor(real, model, patches, reserved) {
		this.real = real;
		this.patches = patches;
		this.gates = [];
		this.towers = [];

		if (patches.length === 1) {
			this.shape = patches[0].shape;
		} else {
			this.shape = findCircumference(patches);

			if (real) {
				const smoothFactor = Math.min(1, 40 / patches.length);
				// set() mutates the shared vertices in place (so patches follow the smoothing)
				this.shape.set(
					this.shape.map((v) => (reserved.indexOf(v) !== -1 ? v : this.shape.smoothVertex(v, smoothFactor)))
				);
			}
		}

		this.segments = this.shape.map(() => true);
		this.edges = this.shape.map((origin, i) => ({ origin, end: this.shape[(i + 1) % this.shape.length] }));

		this.buildGates(real, model, reserved);
	}

	buildGates(real, model, reserved) {
		this.gates = [];

		// Entrances: wall vertices shared by >1 inner ward, so a street can reach the center.
		const entrances =
			this.patches.length > 1
				? this.shape.filter(
						(v) => reserved.indexOf(v) === -1 && count(this.patches, (p) => p.shape.contains(v)) > 1
				  )
				: this.shape.filter((v) => reserved.indexOf(v) === -1);

		if (entrances.length === 0) throw new Error('Bad walled area shape!');

		do {
			const index = Random.int(0, entrances.length);
			const gate = entrances[index];
			this.gates.push(gate);

			if (real) {
				const outerWards = model.patchByVertex(gate).filter((w) => this.patches.indexOf(w) === -1);
				if (outerWards.length === 1) {
					// No road leads out from here — split an outer ward to make one.
					const outer = outerWards[0];
					if (outer.shape.length > 3) {
						const wall = this.shape.next(gate).subtract(this.shape.prev(gate));
						const out = new Point(wall.y, -wall.x);

						const farthest = amax(outer.shape, (v) => {
							if (this.shape.contains(v) || reserved.indexOf(v) !== -1) return Number.NEGATIVE_INFINITY;
							const dir = v.subtract(gate);
							return dir.dot(out) / dir.length;
						});

						const newPatches = outer.shape.split(gate, farthest).map((half) => new Patch(half));
						replace(model.patches, outer, newPatches);
					}
				}
			}

			// Drop neighbouring entrances so gates aren't too close.
			if (index === 0) {
				entrances.splice(0, 2);
				entrances.pop();
			} else if (index === entrances.length - 1) {
				entrances.splice(index - 1, 2);
				entrances.shift();
			} else {
				entrances.splice(index - 1, 3);
			}
		} while (entrances.length >= 3);

		if (this.gates.length === 0) throw new Error('Bad walled area shape!');

		// Smooth the wall around the gates.
		if (real) for (const gate of this.gates) gate.set(this.shape.smoothVertex(gate));
	}

	buildTowers() {
		this.towers = [];
		if (this.real) {
			const len = this.shape.length;
			for (let i = 0; i < len; i++) {
				const t = this.shape[i];
				// Place a tower if at least one adjacent segment is active (OR logic).
				// Towers at water/river endpoints are offset inland by the renderer so
				// they sit fully on land, not in the water.
				if (this.gates.indexOf(t) === -1 && (this.segments[i] || this.segments[(i + len - 1) % len]))
					this.towers.push(t);
			}
		}
	}

	bothSegments(i) {
		const len = this.shape.length;
		return this.segments[i] && this.segments[(i + len - 1) % len];
	}

	// Mark wall segments that run over water (river edges + coast) as inactive. Only
	// segments that ARE river edges or shore edges are suppressed — segments merely
	// touching a river node are kept and pulled back by the renderer to the riverbank.
	suppressWaterSegments(model) {
		if (!this.real) return;
		const len = this.shape.length;
		const isWaterVertex = (v) => {
			const patches = model.patchByVertex ? model.patchByVertex(v) : [];
			return patches.length > 0 && patches.some((p) => p.isWater);
		};
		const isRiverEdge = (a, b) =>
			!!(model.riverEdges && ((model.riverEdges.get(a) && model.riverEdges.get(a).has(b)) || (model.riverEdges.get(b) && model.riverEdges.get(b).has(a))));

		for (let i = 0; i < len; i++) {
			const a = this.shape[i];
			const b = this.shape[(i + 1) % len];
			if (isRiverEdge(a, b) || isShoreEdge(model, a, b) || isWaterVertex(a) || isWaterVertex(b)) {
				this.segments[i] = false;
			}
		}
	}

	getRadius() {
		let radius = 0.0;
		for (const v of this.shape) radius = Math.max(radius, v.length);
		return radius;
	}

	bordersBy(p, v0, v1) {
		const index = this.patches.indexOf(p) !== -1 ? this.shape.findEdge(v0, v1) : this.shape.findEdge(v1, v0);
		return index !== -1 && this.segments[index];
	}

	borders(p) {
		const withinWalls = this.patches.indexOf(p) !== -1;
		const length = this.shape.length;
		for (let i = 0; i < length; i++)
			if (this.segments[i]) {
				const v0 = this.shape[i];
				const v1 = this.shape[(i + 1) % length];
				const index = withinWalls ? p.shape.findEdge(v0, v1) : p.shape.findEdge(v1, v0);
				if (index !== -1) return true;
			}
		return false;
	}
}
