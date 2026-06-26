// Patch — port of com.watabou.towngenerator.building.Patch.
// `shape` reuses the region's circumcenter Point instances (shared between neighbours).
// `type` replaces the Haxe Ward subclass (we only label patches in step 1, no buildings).

import { Polygon } from './Polygon.js';

export class Patch {
	constructor(vertices) {
		this.shape = new Polygon(vertices); // shallow copy -> shared Point refs
		this.withinCity = false;
		this.withinWalls = false;
		this.type = null; // 'plaza' | 'market' | 'cathedral' | 'castle' | 'gate' | 'generic' | 'farm'
		this.block = null; // shrunken Polygon (null = kept open)
	}

	static fromRegion(r) {
		return new Patch(r.vertices.map((tr) => tr.c));
	}
}
