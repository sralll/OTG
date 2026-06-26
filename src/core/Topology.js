// Topology — port of com.watabou.towngenerator.building.Topology.
// Builds a graph whose nodes are patch vertices and whose edges are patch polygon edges
// (weighted by length). Blocked vertices (walls/citadel minus gates) get a node but no
// links, so paths route AROUND them. Roads/streets are shortest paths on this graph.

import { Point } from './Point.js';
import { Graph } from './Graph.js';
import { addUnique, difference } from './arrays.js';

// How strongly roads avoid running ALONG a river edge. High enough that a street never
// follows the river for a stretch, but finite so it can still cross at a single edge (a
// bridge) when that's the only way across.
const RIVER_PENALTY = 40;

export class Topology {
	constructor(model) {
		this.model = model;

		this.graph = new Graph();
		this.pt2node = new Map();
		this.node2pt = new Map();

		this.inner = [];
		this.outer = [];

		// Blocked points: coastline + walls + citadel, excluding gates. Blocking the shore keeps
		// roads/streets off the waterfront (matching the reference's excludePoints(shore)).
		let blocked = [];
		if (model.citadel != null) blocked = blocked.concat(model.citadel.shape);
		if (model.wall != null) blocked = blocked.concat(model.wall.shape);
		if (model.shoreVertices) blocked = blocked.concat([...model.shoreVertices]);
		this.blocked = difference(blocked, model.gates);

		const border = model.border.shape;

		for (const p of model.patches) {
			if (p.isWater) continue; // water cells aren't routable — roads stay on land
			const withinCity = p.withinCity;

			let v1 = p.shape.last();
			let n1 = this._processPoint(v1);

			for (let i = 0; i < p.shape.length; i++) {
				const v0 = v1;
				v1 = p.shape[i];
				const n0 = n1;
				n1 = this._processPoint(v1);

				if (n0 != null && !border.contains(v0)) {
					if (withinCity) addUnique(this.inner, n0);
					else addUnique(this.outer, n0);
				}
				if (n1 != null && !border.contains(v1)) {
					if (withinCity) addUnique(this.inner, n1);
					else addUnique(this.outer, n1);
				}

				if (n0 != null && n1 != null) {
					let w = Point.distance(v0, v1);
					const re = model.riverEdges;
					if (re && ((re.get(v0) && re.get(v0).has(v1)) || (re.get(v1) && re.get(v1).has(v0)))) w *= RIVER_PENALTY;
					n0.link(n1, w);
				}
			}
		}
	}

	_processPoint(v) {
		let n;
		if (this.pt2node.has(v)) {
			n = this.pt2node.get(v);
		} else {
			n = this.graph.add();
			this.pt2node.set(v, n);
			this.node2pt.set(n, v);
		}
		return this.blocked.indexOf(v) !== -1 ? null : n;
	}

	buildPath(from, to, exclude = null) {
		const path = this.graph.aStar(this.pt2node.get(from), this.pt2node.get(to), exclude);
		return path == null ? null : path.map((n) => this.node2pt.get(n));
	}
}
