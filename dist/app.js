(() => {
  // src/core/Point.js
  var Point = class _Point {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    // openfl: length is a getter (distance from origin)
    get length() {
      return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    static distance(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
    clone() {
      return new _Point(this.x, this.y);
    }
    // --- returning new Point (openfl) ---
    add(q) {
      return new _Point(this.x + q.x, this.y + q.y);
    }
    subtract(q) {
      return new _Point(this.x - q.x, this.y - q.y);
    }
    // --- mutating in place (openfl) ---
    normalize(thickness = 1) {
      const len = this.length;
      if (len !== 0) {
        const norm3 = thickness / len;
        this.x *= norm3;
        this.y *= norm3;
      }
    }
    offset(dx, dy) {
      this.x += dx;
      this.y += dy;
    }
    setTo(x, y) {
      this.x = x;
      this.y = y;
    }
    // --- PointExtender (used via `using`, so called as instance methods) ---
    set(q) {
      this.x = q.x;
      this.y = q.y;
    }
    scale(f) {
      return new _Point(this.x * f, this.y * f);
    }
    // norm: clone, then normalize -> returns a fresh Point; `this` is unchanged
    norm(length = 1) {
      const p = this.clone();
      p.normalize(length);
      return p;
    }
    addEq(q) {
      this.x += q.x;
      this.y += q.y;
    }
    subEq(q) {
      this.x -= q.x;
      this.y -= q.y;
    }
    scaleEq(f) {
      this.x *= f;
      this.y *= f;
    }
    atan() {
      return Math.atan2(this.y, this.x);
    }
    dot(q) {
      return this.x * q.x + this.y * q.y;
    }
    rotate90() {
      return new _Point(-this.y, this.x);
    }
  };

  // src/core/GeomUtils.js
  var GeomUtils = class {
    static intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2) {
      const d = dx1 * dy2 - dy1 * dx2;
      if (d === 0)
        return null;
      const t2 = (dy1 * (x2 - x1) - dx1 * (y2 - y1)) / d;
      const t1 = dx1 !== 0 ? (x2 - x1 + dx2 * t2) / dx1 : (y2 - y1 + dy2 * t2) / dy1;
      return new Point(t1, t2);
    }
    static interpolate(p1, p2, ratio = 0.5) {
      const d = p2.subtract(p1);
      return new Point(p1.x + d.x * ratio, p1.y + d.y * ratio);
    }
    static scalar(x1, y1, x2, y2) {
      return x1 * x2 + y1 * y2;
    }
    static cross(x1, y1, x2, y2) {
      return x1 * y2 - y1 * x2;
    }
    static distance2line(x1, y1, dx1, dy1, x0, y0) {
      return (dx1 * y0 - dy1 * x0 + (y1 + dy1) * x1 - (x1 + dx1) * y1) / Math.sqrt(dx1 * dx1 + dy1 * dy1);
    }
  };

  // src/core/MathUtils.js
  var MathUtils = class {
    static gate(value, min, max) {
      return value < min ? min : value < max ? value : max;
    }
    static gatei(value, min, max) {
      return value < min ? min : value < max ? value : max;
    }
    static sign(value) {
      return value === 0 ? 0 : value < 0 ? -1 : 1;
    }
  };

  // src/core/Random.js
  var g = 48271;
  var n = 2147483647;
  var seed = 1;
  var Random = class _Random {
    static reset(seed_ = -1) {
      seed = seed_ !== -1 ? seed_ : Math.trunc(Date.now() % n);
    }
    static getSeed() {
      return seed;
    }
    static next() {
      return seed = Math.trunc(seed * g % n);
    }
    static float() {
      return _Random.next() / n;
    }
    static normal() {
      return (_Random.float() + _Random.float() + _Random.float()) / 3;
    }
    static int(min, max) {
      return Math.trunc(min + _Random.next() / n * (max - min));
    }
    static bool(chance = 0.5) {
      return _Random.float() < chance;
    }
    static fuzzy(f = 1) {
      return f === 0 ? 0.5 : (1 - f) / 2 + f * _Random.normal();
    }
  };

  // src/core/arrays.js
  function remove(arr, x) {
    const i = arr.indexOf(x);
    if (i === -1) return false;
    arr.splice(i, 1);
    return true;
  }
  function amin(arr, f) {
    let result = arr[0];
    let min = f(result);
    for (let i = 1; i < arr.length; i++) {
      const el = arr[i];
      const m = f(el);
      if (m < min) {
        result = el;
        min = m;
      }
    }
    return result;
  }
  function amax(arr, f) {
    let result = arr[0];
    let max = f(result);
    for (let i = 1; i < arr.length; i++) {
      const el = arr[i];
      const m = f(el);
      if (m > max) {
        result = el;
        max = m;
      }
    }
    return result;
  }
  function count(arr, test) {
    let c = 0;
    for (const e of arr) if (test(e)) c++;
    return c;
  }
  function difference(a, b) {
    return a.filter((el) => b.indexOf(el) === -1);
  }
  function addUnique(arr, el) {
    if (arr.indexOf(el) === -1) arr.push(el);
  }
  function replace(arr, el, newEls) {
    let index = arr.indexOf(el);
    arr[index++] = newEls[0];
    for (let i = 1; i < newEls.length; i++) arr.splice(index++, 0, newEls[i]);
  }

  // src/core/Polygon.js
  var DELTA = 1e-6;
  var Polygon = class _Polygon extends Array {
    // Make derived-array methods (slice/concat/map/filter) return plain Array,
    // so they don't try to construct `new Polygon(length)`.
    static get [Symbol.species]() {
      return Array;
    }
    constructor(vertices = null) {
      super();
      if (vertices != null) for (const v of vertices) this.push(v);
    }
    // --- small array helpers Haxe gets from ArrayExtender / Array, scoped to `this` ---
    last() {
      return this[this.length - 1];
    }
    remove(x) {
      const i = this.indexOf(x);
      if (i === -1) return false;
      this.splice(i, 1);
      return true;
    }
    set(p) {
      for (let i = 0; i < p.length; i++) this[i].set(p[i]);
    }
    // --- metrics ---
    get square() {
      let v1 = this.last();
      let v2 = this[0];
      let s = v1.x * v2.y - v2.x * v1.y;
      for (let i = 1; i < this.length; i++) {
        v1 = v2;
        v2 = this[i];
        s += v1.x * v2.y - v2.x * v1.y;
      }
      return s * 0.5;
    }
    get perimeter() {
      let len = 0;
      this.forEdge((v0, v1) => {
        len += Point.distance(v0, v1);
      });
      return len;
    }
    // circle = 1.00, square = 0.79, triangle = 0.60
    get compactness() {
      const p = this.perimeter;
      return 4 * Math.PI * this.square / (p * p);
    }
    // Faster approximation of centroid (average of vertices)
    get center() {
      const c = new Point();
      for (const v of this) c.addEq(v);
      c.scaleEq(1 / this.length);
      return c;
    }
    get centroid() {
      let x = 0;
      let y = 0;
      let a = 0;
      this.forEdge((v0, v1) => {
        const f = GeomUtils.cross(v0.x, v0.y, v1.x, v1.y);
        a += f;
        x += (v0.x + v1.x) * f;
        y += (v0.y + v1.y) * f;
      });
      const s6 = 1 / (3 * a);
      return new Point(s6 * x, s6 * y);
    }
    contains(v) {
      return this.indexOf(v) !== -1;
    }
    forEdge(f) {
      const len = this.length;
      for (let i = 0; i < len; i++) f(this[i], this[(i + 1) % len]);
    }
    // like forEdge but skips the closing v(n-1)->v(0) edge
    forSegment(f) {
      for (let i = 0; i < this.length - 1; i++) f(this[i], this[i + 1]);
    }
    offset(p) {
      const dx = p.x;
      const dy = p.y;
      for (const v of this) v.offset(dx, dy);
    }
    rotate(a) {
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      for (const v of this) {
        const vx = v.x * cosA - v.y * sinA;
        const vy = v.y * cosA + v.x * sinA;
        v.setTo(vx, vy);
      }
    }
    isConvexVertexi(i) {
      const len = this.length;
      const v0 = this[(i + len - 1) % len];
      const v1 = this[i];
      const v2 = this[(i + 1) % len];
      return GeomUtils.cross(v1.x - v0.x, v1.y - v0.y, v2.x - v1.x, v2.y - v1.y) > 0;
    }
    isConvexVertex(v1) {
      const v0 = this.prev(v1);
      const v2 = this.next(v1);
      return GeomUtils.cross(v1.x - v0.x, v1.y - v0.y, v2.x - v1.x, v2.y - v1.y) > 0;
    }
    isConvex() {
      for (const v of this) if (!this.isConvexVertex(v)) return false;
      return true;
    }
    smoothVertexi(i, f = 1) {
      const v = this[i];
      const len = this.length;
      const prev = this[(i + len - 1) % len];
      const next = this[(i + 1) % len];
      return new Point((prev.x + v.x * f + next.x) / (2 + f), (prev.y + v.y * f + next.y) / (2 + f));
    }
    smoothVertex(v, f = 1) {
      const prev = this.prev(v);
      const next = this.next(v);
      return new Point(prev.x + v.x * f + next.x, prev.y + v.y * f + next.y).scale(1 / (2 + f));
    }
    // NOTE: faithful port — the original only ever returns the distance to the FIRST vertex
    // (the loop updates v0 but never updates `d`). Kept verbatim for behavioral parity.
    distance(p) {
      let v0 = this[0];
      const d = Point.distance(v0, p);
      for (let i = 1; i < this.length; i++) {
        const v1 = this[i];
        const d1 = Point.distance(v1, p);
        if (d1 < d) v0 = v1;
      }
      return d;
    }
    smoothVertexEq(f = 1) {
      const len = this.length;
      let v1 = this[len - 1];
      let v2 = this[0];
      const out = [];
      for (let i = 0; i < len; i++) {
        const v0 = v1;
        v1 = v2;
        v2 = this[(i + 1) % len];
        out.push(new Point((v0.x + v1.x * f + v2.x) / (2 + f), (v0.y + v1.y * f + v2.y) / (2 + f)));
      }
      return new _Polygon(out);
    }
    filterShort(threshold) {
      let i = 1;
      let v0 = this[0];
      let v1 = this[1];
      const result = [v0];
      do {
        do {
          v1 = this[i++];
        } while (Point.distance(v0, v1) < threshold && i < this.length);
        result.push(v0 = v1);
      } while (i < this.length);
      return new _Polygon(result);
    }
    // Insets one edge defined by its first vertex. Doesn't change vertex count.
    inset(p1, d) {
      const i1 = this.indexOf(p1);
      const i0 = i1 > 0 ? i1 - 1 : this.length - 1;
      const p0 = this[i0];
      const i2 = i1 < this.length - 1 ? i1 + 1 : 0;
      const p2 = this[i2];
      const i3 = i2 < this.length - 1 ? i2 + 1 : 0;
      const p3 = this[i3];
      const v0 = p1.subtract(p0);
      const v1 = p2.subtract(p1);
      const v2 = p3.subtract(p2);
      let cos = v0.dot(v1) / v0.length / v1.length;
      let z = v0.x * v1.y - v0.y * v1.x;
      let t = d / Math.sqrt(1 - cos * cos);
      if (z > 0) t = Math.min(t, v0.length * 0.99);
      else t = Math.min(t, v1.length * 0.5);
      t *= MathUtils.sign(z);
      this[i1] = p1.subtract(v0.norm(t));
      cos = v1.dot(v2) / v1.length / v2.length;
      z = v1.x * v2.y - v1.y * v2.x;
      t = d / Math.sqrt(1 - cos * cos);
      if (z > 0) t = Math.min(t, v2.length * 0.99);
      else t = Math.min(t, v1.length * 0.5);
      this[i2] = p2.add(v2.norm(t));
    }
    insetAll(d) {
      const p = new _Polygon(this);
      for (let i = 0; i < p.length; i++) if (d[i] !== 0) p.inset(p[i], d[i]);
      return p;
    }
    insetEq(d) {
      for (let i = 0; i < this.length; i++) this.inset(this[i], d);
    }
    // Insets all edges by per-edge distances. Reliable for convex & concave, but changes
    // vertex count and can create "steps" when distances differ. Handles self-intersection.
    buffer(d) {
      const q = new _Polygon();
      let i = 0;
      this.forEdge((v0, v1) => {
        const dd = d[i++];
        if (dd === 0) {
          q.push(v0);
          q.push(v1);
        } else {
          const v = v1.subtract(v0);
          const n2 = v.rotate90().norm(dd);
          q.push(v0.add(n2));
          q.push(v1.add(n2));
        }
      });
      let wasCut;
      let lastEdge = 0;
      do {
        wasCut = false;
        const n2 = q.length;
        for (i = lastEdge; i < n2 - 2; i++) {
          lastEdge = i;
          const p11 = q[i];
          const p12 = q[i + 1];
          const x1 = p11.x;
          const y1 = p11.y;
          const dx1 = p12.x - x1;
          const dy1 = p12.y - y1;
          const jmax = i > 0 ? n2 : n2 - 1;
          for (let j = i + 2; j < jmax; j++) {
            const p21 = q[j];
            const p22 = j < n2 - 1 ? q[j + 1] : q[0];
            const x2 = p21.x;
            const y2 = p21.y;
            const dx2 = p22.x - x2;
            const dy2 = p22.y - y2;
            const int = GeomUtils.intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2);
            if (int != null && int.x > DELTA && int.x < 1 - DELTA && int.y > DELTA && int.y < 1 - DELTA) {
              const pn = new Point(x1 + dx1 * int.x, y1 + dy1 * int.x);
              q.splice(j + 1, 0, pn);
              q.splice(i + 1, 0, pn);
              wasCut = true;
              break;
            }
          }
          if (wasCut) break;
        }
      } while (wasCut);
      const regular = [];
      for (i = 0; i < q.length; i++) regular.push(i);
      let bestPart = null;
      let bestPartSq = Number.NEGATIVE_INFINITY;
      while (regular.length > 0) {
        const indices = [];
        const start = regular[0];
        let k = start;
        do {
          indices.push(k);
          remove(regular, k);
          const next = (k + 1) % q.length;
          const v = q[next];
          let next1 = q.indexOf(v);
          if (next1 === next) next1 = q.lastIndexOf(v);
          k = next1 === -1 ? next : next1;
        } while (k !== start);
        const p = new _Polygon(indices.map((ix) => q[ix]));
        const s = p.square;
        if (s > bestPartSq) {
          bestPart = p;
          bestPartSq = s;
        }
      }
      return bestPart;
    }
    bufferEq(d) {
      return this.buffer(this.map(() => d));
    }
    // Insets all edges by per-edge distances by repeatedly cutting. Can't outset; best for
    // convex polygons; produces a convex polygon; changes vertex count.
    shrink(d) {
      let q = new _Polygon(this);
      let i = 0;
      this.forEdge((v1, v2) => {
        const dd = d[i++];
        if (dd > 0) {
          const v = v2.subtract(v1);
          const n2 = v.rotate90().norm(dd);
          q = q.cut(v1.add(n2), v2.add(n2), 0)[0];
        }
      });
      return q;
    }
    shrinkEq(d) {
      return this.shrink(this.map(() => d));
    }
    // Robust uniform inset: shift every edge inward by d, compute new vertices as
    // intersections of adjacent offset lines, then resolve any self-intersections
    // (which arise at concave vertices). Works for both convex and concave polygons.
    shrinkRobust(d) {
      const n2 = this.length;
      if (n2 < 3 || !(d > 0)) return new _Polygon(this.map((v) => v.clone()));
      const area = this.square;
      if (Math.abs(area) < 1e-10) return null;
      const s = area > 0 ? 1 : -1;
      const edges = [];
      for (let i = 0; i < n2; i++) {
        const a = this[i];
        const b = this[(i + 1) % n2];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-10) {
          edges.push(null);
        } else {
          edges.push({
            dx,
            dy,
            nx: -dy / len * d * s,
            ny: dx / len * d * s
          });
        }
      }
      for (let i = 0; i < n2; i++) {
        if (!edges[i]) edges[i] = edges[(i + 1) % n2] || edges[(i + n2 - 1) % n2];
      }
      if (!edges[0]) return null;
      const q = [];
      for (let i = 0; i < n2; i++) {
        const prev = (i + n2 - 1) % n2;
        const e0 = edges[prev];
        const e1 = edges[i];
        const ox0 = this[prev].x + e0.nx;
        const oy0 = this[prev].y + e0.ny;
        const ox1 = this[i].x + e1.nx;
        const oy1 = this[i].y + e1.ny;
        const t = GeomUtils.intersectLines(ox0, oy0, e0.dx, e0.dy, ox1, oy1, e1.dx, e1.dy);
        if (!t || Math.abs(t.x) > 1e8) {
          q.push(new Point((ox0 + ox1) / 2, (oy0 + oy1) / 2));
        } else {
          q.push(new Point(ox0 + e0.dx * t.x, oy0 + e0.dy * t.x));
        }
      }
      let wasCut;
      let lastEdge = 0;
      do {
        wasCut = false;
        const m = q.length;
        for (let i = lastEdge; i < m - 2; i++) {
          lastEdge = i;
          const p11 = q[i];
          const p12 = q[i + 1];
          const x1 = p11.x, y1 = p11.y;
          const dx1 = p12.x - x1, dy1 = p12.y - y1;
          const jmax = i > 0 ? m : m - 1;
          for (let j = i + 2; j < jmax; j++) {
            const p21 = q[j];
            const p22 = j < m - 1 ? q[j + 1] : q[0];
            const x2 = p21.x, y2 = p21.y;
            const dx2 = p22.x - x2, dy2 = p22.y - y2;
            const int = GeomUtils.intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2);
            if (int != null && int.x > DELTA && int.x < 1 - DELTA && int.y > DELTA && int.y < 1 - DELTA) {
              const pn = new Point(x1 + dx1 * int.x, y1 + dy1 * int.x);
              q.splice(j + 1, 0, pn);
              q.splice(i + 1, 0, pn);
              wasCut = true;
              break;
            }
          }
          if (wasCut) break;
        }
      } while (wasCut);
      if (q.length === n2) return new _Polygon(q);
      const regular = [];
      for (let i = 0; i < q.length; i++) regular.push(i);
      let bestPart = null;
      let bestPartSq = 0;
      while (regular.length > 0) {
        const indices = [];
        const start = regular[0];
        let k = start;
        do {
          indices.push(k);
          remove(regular, k);
          const next = (k + 1) % q.length;
          const v = q[next];
          let next1 = q.indexOf(v);
          if (next1 === next) next1 = q.lastIndexOf(v);
          k = next1 === -1 ? next : next1;
        } while (k !== start);
        const p = new _Polygon(indices.map((ix) => q[ix]));
        const sq = Math.abs(p.square);
        if (sq > bestPartSq) {
          bestPart = p;
          bestPartSq = sq;
        }
      }
      return bestPart;
    }
    // Cuts a peel along one edge (inset of a single edge via cut).
    peel(v1, d) {
      const i1 = this.indexOf(v1);
      const i2 = i1 === this.length - 1 ? 0 : i1 + 1;
      const v2 = this[i2];
      const v = v2.subtract(v1);
      const n2 = v.rotate90().norm(d);
      return this.cut(v1.add(n2), v2.add(n2), 0)[0];
    }
    // Simplifies the polygon down to n vertices (drops the lowest-area vertices). Mutates.
    simplyfy(n2) {
      let len = this.length;
      while (len > n2) {
        let result = 0;
        let min = Number.POSITIVE_INFINITY;
        let b = this[len - 1];
        let c = this[0];
        for (let i = 0; i < len; i++) {
          const a = b;
          b = c;
          c = this[(i + 1) % len];
          const measure = Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
          if (measure < min) {
            result = i;
            min = measure;
          }
        }
        this.splice(result, 1);
        len--;
      }
    }
    findEdge(a, b) {
      const index = this.indexOf(a);
      return index !== -1 && this[(index + 1) % this.length] === b ? index : -1;
    }
    next(a) {
      return this[(this.indexOf(a) + 1) % this.length];
    }
    prev(a) {
      return this[(this.indexOf(a) + this.length - 1) % this.length];
    }
    vector(v) {
      return this.next(v).subtract(v);
    }
    vectori(i) {
      return this[i === this.length - 1 ? 0 : i + 1].subtract(this[i]);
    }
    borders(another) {
      const len1 = this.length;
      const len2 = another.length;
      for (let i = 0; i < len1; i++) {
        const j = another.indexOf(this[i]);
        if (j !== -1) {
          const next = this[(i + 1) % len1];
          if (next === another[(j + 1) % len2] || next === another[(j + len2 - 1) % len2]) return true;
        }
      }
      return false;
    }
    getBounds() {
      const rect = { left: this[0].x, top: this[0].y, right: this[0].x, bottom: this[0].y };
      for (const v of this) {
        rect.left = Math.min(rect.left, v.x);
        rect.right = Math.max(rect.right, v.x);
        rect.top = Math.min(rect.top, v.y);
        rect.bottom = Math.max(rect.bottom, v.y);
      }
      return rect;
    }
    split(p1, p2) {
      return this.spliti(this.indexOf(p1), this.indexOf(p2));
    }
    spliti(i1, i2) {
      if (i1 > i2) {
        const t = i1;
        i1 = i2;
        i2 = t;
      }
      return [
        new _Polygon(this.slice(i1, i2 + 1)),
        new _Polygon(this.slice(i2).concat(this.slice(0, i1 + 1)))
      ];
    }
    cut(p1, p2, gap = 0) {
      const x1 = p1.x;
      const y1 = p1.y;
      const dx1 = p2.x - x1;
      const dy1 = p2.y - y1;
      const len = this.length;
      let edge1 = 0;
      let ratio1 = 0;
      let edge2 = 0;
      let ratio2 = 0;
      let count2 = 0;
      for (let i = 0; i < len; i++) {
        const v0 = this[i];
        const v1 = this[(i + 1) % len];
        const x2 = v0.x;
        const y2 = v0.y;
        const dx2 = v1.x - x2;
        const dy2 = v1.y - y2;
        const t = GeomUtils.intersectLines(x1, y1, dx1, dy1, x2, y2, dx2, dy2);
        if (t != null && t.y >= 0 && t.y <= 1) {
          if (count2 === 0) {
            edge1 = i;
            ratio1 = t.x;
          } else if (count2 === 1) {
            edge2 = i;
            ratio2 = t.x;
          }
          count2++;
        }
      }
      if (count2 === 2) {
        const point1 = p1.add(p2.subtract(p1).scale(ratio1));
        const point2 = p1.add(p2.subtract(p1).scale(ratio2));
        let half1 = new _Polygon(this.slice(edge1 + 1, edge2 + 1));
        half1.unshift(point1);
        half1.push(point2);
        let half2 = new _Polygon(this.slice(edge2 + 1).concat(this.slice(0, edge1 + 1)));
        half2.unshift(point2);
        half2.push(point1);
        if (gap > 0) {
          half1 = half1.peel(point2, gap / 2);
          half2 = half2.peel(point1, gap / 2);
        }
        const v = this.vectori(edge1);
        return GeomUtils.cross(dx1, dy1, v.x, v.y) > 0 ? [half1, half2] : [half2, half1];
      } else {
        return [new _Polygon(this)];
      }
    }
    interpolate(p) {
      let sum = 0;
      const dd = this.map((v) => {
        const d = 1 / Point.distance(v, p);
        sum += d;
        return d;
      });
      return dd.map((d) => d / sum);
    }
    static rect(w = 1, h = 1) {
      return new _Polygon([
        new Point(-w / 2, -h / 2),
        new Point(w / 2, -h / 2),
        new Point(w / 2, h / 2),
        new Point(-w / 2, h / 2)
      ]);
    }
    static regular(n2 = 8, r = 1) {
      const pts = [];
      for (let i = 0; i < n2; i++) {
        const a = i / n2 * Math.PI * 2;
        pts.push(new Point(r * Math.cos(a), r * Math.sin(a)));
      }
      return new _Polygon(pts);
    }
    static circle(r = 1) {
      return _Polygon.regular(16, r);
    }
  };

  // src/core/Voronoi.js
  var Triangle = class {
    constructor(p1, p2, p3) {
      const s = (p2.x - p1.x) * (p2.y + p1.y) + (p3.x - p2.x) * (p3.y + p2.y) + (p1.x - p3.x) * (p1.y + p3.y);
      this.p1 = p1;
      this.p2 = s > 0 ? p2 : p3;
      this.p3 = s > 0 ? p3 : p2;
      const x1 = (p1.x + p2.x) / 2;
      const y1 = (p1.y + p2.y) / 2;
      const x2 = (p2.x + p3.x) / 2;
      const y2 = (p2.y + p3.y) / 2;
      const dx1 = p1.y - p2.y;
      const dy1 = p2.x - p1.x;
      const dx2 = p2.y - p3.y;
      const dy2 = p3.x - p2.x;
      const tg1 = dy1 / dx1;
      const t2 = (y1 - y2 - (x1 - x2) * tg1) / (dy2 - dx2 * tg1);
      this.c = new Point(x2 + dx2 * t2, y2 + dy2 * t2);
      this.r = Point.distance(this.c, p1);
    }
    hasEdge(a, b) {
      return this.p1 === a && this.p2 === b || this.p2 === a && this.p3 === b || this.p3 === a && this.p1 === b;
    }
  };
  var Region = class {
    constructor(seed2) {
      this.seed = seed2;
      this.vertices = [];
    }
    sortVertices() {
      this.vertices.sort((a, b) => this._compareAngles(a, b));
      return this;
    }
    center() {
      const c = new Point();
      for (const v of this.vertices) c.addEq(v.c);
      c.scaleEq(1 / this.vertices.length);
      return c;
    }
    borders(r) {
      const len1 = this.vertices.length;
      const len2 = r.vertices.length;
      for (let i = 0; i < len1; i++) {
        const j = r.vertices.indexOf(this.vertices[i]);
        if (j !== -1) return this.vertices[(i + 1) % len1] === r.vertices[(j + len2 - 1) % len2];
      }
      return false;
    }
    _compareAngles(v1, v2) {
      const x1 = v1.c.x - this.seed.x;
      const y1 = v1.c.y - this.seed.y;
      const x2 = v2.c.x - this.seed.x;
      const y2 = v2.c.y - this.seed.y;
      if (x1 >= 0 && x2 < 0) return 1;
      if (x2 >= 0 && x1 < 0) return -1;
      if (x1 === 0 && x2 === 0) return y2 > y1 ? 1 : -1;
      return MathUtils.sign(x2 * y1 - x1 * y2);
    }
  };
  var Voronoi = class _Voronoi {
    constructor(minx, miny, maxx, maxy) {
      this.triangles = [];
      const c1 = new Point(minx, miny);
      const c2 = new Point(minx, maxy);
      const c3 = new Point(maxx, miny);
      const c4 = new Point(maxx, maxy);
      this.frame = [c1, c2, c3, c4];
      this.points = [c1, c2, c3, c4];
      this.triangles.push(new Triangle(c1, c2, c3));
      this.triangles.push(new Triangle(c2, c3, c4));
      this._regions = /* @__PURE__ */ new Map();
      for (const p of this.points) this._regions.set(p, this.buildRegion(p));
      this._regionsDirty = false;
    }
    addPoint(p) {
      const toSplit = [];
      for (const tr of this.triangles) if (Point.distance(p, tr.c) < tr.r) toSplit.push(tr);
      if (toSplit.length > 0) {
        this.points.push(p);
        const a = [];
        const b = [];
        for (const t1 of toSplit) {
          let e1 = true;
          let e2 = true;
          let e3 = true;
          for (const t2 of toSplit) {
            if (t2 !== t1) {
              if (e1 && t2.hasEdge(t1.p2, t1.p1)) e1 = false;
              if (e2 && t2.hasEdge(t1.p3, t1.p2)) e2 = false;
              if (e3 && t2.hasEdge(t1.p1, t1.p3)) e3 = false;
              if (!(e1 || e2 || e3)) break;
            }
          }
          if (e1) {
            a.push(t1.p1);
            b.push(t1.p2);
          }
          if (e2) {
            a.push(t1.p2);
            b.push(t1.p3);
          }
          if (e3) {
            a.push(t1.p3);
            b.push(t1.p1);
          }
        }
        let index = 0;
        do {
          this.triangles.push(new Triangle(p, a[index], b[index]));
          index = a.indexOf(b[index]);
        } while (index !== 0);
        for (const tr of toSplit) remove(this.triangles, tr);
        this._regionsDirty = true;
      }
    }
    buildRegion(p) {
      const r = new Region(p);
      for (const tr of this.triangles) if (tr.p1 === p || tr.p2 === p || tr.p3 === p) r.vertices.push(tr);
      return r.sortVertices();
    }
    get regions() {
      if (this._regionsDirty) {
        this._regions = /* @__PURE__ */ new Map();
        this._regionsDirty = false;
        for (const p of this.points) this._regions.set(p, this.buildRegion(p));
      }
      return this._regions;
    }
    isReal(tr) {
      return !(this.frame.indexOf(tr.p1) !== -1 || this.frame.indexOf(tr.p2) !== -1 || this.frame.indexOf(tr.p3) !== -1);
    }
    triangulation() {
      return this.triangles.filter((tr) => this.isReal(tr));
    }
    partioning() {
      const result = [];
      const regions = this.regions;
      for (const p of this.points) {
        const r = regions.get(p);
        let isReal = true;
        for (const v of r.vertices)
          if (!this.isReal(v)) {
            isReal = false;
            break;
          }
        if (isReal) result.push(r);
      }
      return result;
    }
    getNeighbours(r1) {
      const out = [];
      for (const r2 of this.regions.values()) if (r1.borders(r2)) out.push(r2);
      return out;
    }
    static relax(voronoi, toRelax = null) {
      const regions = voronoi.partioning();
      const points = voronoi.points.slice();
      for (const p of voronoi.frame) remove(points, p);
      if (toRelax == null) toRelax = voronoi.points;
      for (const r of regions)
        if (toRelax.indexOf(r.seed) !== -1) {
          remove(points, r.seed);
          points.push(r.center());
        }
      return _Voronoi.build(points);
    }
    static build(vertices) {
      let minx = 1e10;
      let miny = 1e10;
      let maxx = -1e9;
      let maxy = -1e9;
      for (const v of vertices) {
        if (v.x < minx) minx = v.x;
        if (v.y < miny) miny = v.y;
        if (v.x > maxx) maxx = v.x;
        if (v.y > maxy) maxy = v.y;
      }
      const dx = (maxx - minx) * 0.5;
      const dy = (maxy - miny) * 0.5;
      const voronoi = new _Voronoi(minx - dx / 2, miny - dy / 2, maxx + dx / 2, maxy + dy / 2);
      for (const v of vertices) voronoi.addPoint(v);
      return voronoi;
    }
  };

  // src/core/Patch.js
  var Patch = class _Patch {
    constructor(vertices) {
      this.shape = new Polygon(vertices);
      this.withinCity = false;
      this.withinWalls = false;
      this.type = null;
      this.block = null;
    }
    static fromRegion(r) {
      return new _Patch(r.vertices.map((tr) => tr.c));
    }
  };

  // src/core/CurtainWall.js
  function isShoreEdge(model, v0, v1) {
    if (!model.patchByVertex) return false;
    const edgePatches = model.patchByVertex(v0).filter((p) => p.shape.findEdge(v0, v1) !== -1 || p.shape.findEdge(v1, v0) !== -1);
    return edgePatches.some((p) => p.isWater) && edgePatches.some((p) => !p.isWater);
  }
  function findCircumference(wards) {
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
      if (index === -1 || ++guard > A.length + 1) throw new Error("Broken circumference");
    } while (index !== 0);
    return result;
  }
  var CurtainWall = class {
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
          this.shape.set(
            this.shape.map((v) => reserved.indexOf(v) !== -1 ? v : this.shape.smoothVertex(v, smoothFactor))
          );
        }
      }
      this.segments = this.shape.map(() => true);
      this.edges = this.shape.map((origin, i) => ({ origin, end: this.shape[(i + 1) % this.shape.length] }));
      this.buildGates(real, model, reserved);
    }
    buildGates(real, model, reserved) {
      this.gates = [];
      const entrances = this.patches.length > 1 ? this.shape.filter(
        (v) => reserved.indexOf(v) === -1 && count(this.patches, (p) => p.shape.contains(v)) > 1
      ) : this.shape.filter((v) => reserved.indexOf(v) === -1);
      if (entrances.length === 0) throw new Error("Bad walled area shape!");
      do {
        const index = Random.int(0, entrances.length);
        const gate = entrances[index];
        this.gates.push(gate);
        if (real) {
          const outerWards = model.patchByVertex(gate).filter((w) => this.patches.indexOf(w) === -1);
          if (outerWards.length === 1) {
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
      if (this.gates.length === 0) throw new Error("Bad walled area shape!");
      if (real) for (const gate of this.gates) gate.set(this.shape.smoothVertex(gate));
    }
    buildTowers() {
      this.towers = [];
      if (this.real) {
        const len = this.shape.length;
        for (let i = 0; i < len; i++) {
          const t = this.shape[i];
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
      const isRiverEdge = (a, b) => !!(model.riverEdges && (model.riverEdges.get(a) && model.riverEdges.get(a).has(b) || model.riverEdges.get(b) && model.riverEdges.get(b).has(a)));
      for (let i = 0; i < len; i++) {
        const a = this.shape[i];
        const b = this.shape[(i + 1) % len];
        if (isRiverEdge(a, b) || isShoreEdge(model, a, b) || isWaterVertex(a) || isWaterVertex(b)) {
          this.segments[i] = false;
        }
      }
    }
    getRadius() {
      let radius = 0;
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
  };

  // src/core/Graph.js
  function arrayRemove(a, value) {
    const index = a.indexOf(value);
    if (index === -1)
      return false;
    a.splice(index, 1);
    return true;
  }
  var Node = class {
    constructor() {
      this.links = /* @__PURE__ */ new Map();
    }
    link(node, price = 1, symmetrical = true) {
      this.links.set(node, price);
      if (symmetrical) {
        node.links.set(this, price);
      }
    }
    unlink(node, symmetrical = true) {
      this.links.delete(node);
      if (symmetrical) {
        node.links.delete(this);
      }
    }
    unlinkAll() {
      for (const node of this.links.keys()) {
        this.unlink(node);
      }
    }
  };
  var Graph = class {
    constructor() {
      this.nodes = [];
    }
    add(node = null) {
      if (node === null) {
        node = new Node();
      }
      this.nodes.push(node);
      return node;
    }
    remove(node) {
      node.unlinkAll();
      arrayRemove(this.nodes, node);
    }
    aStar(start, goal, exclude = null) {
      const closedSet = exclude !== null ? exclude.slice() : [];
      const openSet = [start];
      const cameFrom = /* @__PURE__ */ new Map();
      const gScore = /* @__PURE__ */ new Map();
      gScore.set(start, 0);
      while (openSet.length > 0) {
        const current = openSet.shift();
        if (current === goal)
          return this.buildPath(cameFrom, current);
        arrayRemove(openSet, current);
        closedSet.push(current);
        const curScore = gScore.get(current);
        for (const neighbour of current.links.keys()) {
          if (closedSet.indexOf(neighbour) !== -1)
            continue;
          const score = curScore + current.links.get(neighbour);
          if (openSet.indexOf(neighbour) === -1)
            openSet.push(neighbour);
          else if (score >= gScore.get(neighbour))
            continue;
          cameFrom.set(neighbour, current);
          gScore.set(neighbour, score);
        }
      }
      return null;
    }
    buildPath(cameFrom, current) {
      const path = [current];
      while (cameFrom.has(current))
        path.push(current = cameFrom.get(current));
      return path;
    }
    calculatePrice(path) {
      if (path.length < 2) {
        return 0;
      }
      let price = 0;
      let current = path[0];
      let next = path[1];
      for (let i = 0; i < path.length - 1; i++) {
        if (current.links.has(next)) {
          price += current.links.get(next);
        } else {
          return NaN;
        }
        current = next;
        next = path[i + 1];
      }
      return price;
    }
  };

  // src/core/Topology.js
  var RIVER_PENALTY = 40;
  var Topology = class {
    constructor(model) {
      this.model = model;
      this.graph = new Graph();
      this.pt2node = /* @__PURE__ */ new Map();
      this.node2pt = /* @__PURE__ */ new Map();
      this.inner = [];
      this.outer = [];
      let blocked = [];
      if (model.citadel != null) blocked = blocked.concat(model.citadel.shape);
      if (model.wall != null) blocked = blocked.concat(model.wall.shape);
      if (model.shoreVertices) blocked = blocked.concat([...model.shoreVertices]);
      this.blocked = difference(blocked, model.gates);
      const border = model.border.shape;
      for (const p of model.patches) {
        if (p.isWater) continue;
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
            if (re && (re.get(v0) && re.get(v0).has(v1) || re.get(v1) && re.get(v1).has(v0))) w *= RIVER_PENALTY;
            n0.link(n1, w);
          }
        }
      }
    }
    _processPoint(v) {
      let n2;
      if (this.pt2node.has(v)) {
        n2 = this.pt2node.get(v);
      } else {
        n2 = this.graph.add();
        this.pt2node.set(v, n2);
        this.node2pt.set(n2, v);
      }
      return this.blocked.indexOf(v) !== -1 ? null : n2;
    }
    buildPath(from, to, exclude = null) {
      const path = this.graph.aStar(this.pt2node.get(from), this.pt2node.get(to), exclude);
      return path == null ? null : path.map((n2) => this.node2pt.get(n2));
    }
  };

  // src/core/Water.js
  var TAU = Math.PI * 2;
  function markOcean(model, cfg, Rc) {
    const out = { sea: null, oceanCells: [], coastDir: null };
    if (!cfg || cfg.sea === false) return out;
    const sea = cfg.sea || {};
    const angle = sea.angle != null ? sea.angle : Random.float() * TAU;
    const coastDir = new Point(Math.cos(angle), Math.sin(angle));
    const tan = coastDir.rotate90();
    const coastDist = (sea.distance != null ? sea.distance : 1.1) * Rc;
    const wavAmp = (sea.waviness != null ? sea.waviness : 0.18) * Rc;
    const wavLen = (sea.waveLength != null ? sea.waveLength : 0.9) * Rc;
    const phases = [Random.float() * TAU, Random.float() * TAU, Random.float() * TAU];
    const wave = (u) => {
      let v = 0;
      let a = 1;
      let f = 1;
      let nrm = 0;
      for (const ph of phases) {
        v += a * Math.sin(u * f * TAU + ph);
        nrm += a;
        a *= 0.5;
        f *= 2;
      }
      return v / nrm;
    };
    for (const patch of model.patches) {
      const c = patch.shape.centroid;
      const along = c.x * coastDir.x + c.y * coastDir.y;
      const t = c.x * tan.x + c.y * tan.y;
      if (along > coastDist + wavAmp * wave(t / wavLen)) {
        patch.isWater = true;
        patch.ocean = true;
        patch.type = "water";
        out.oceanCells.push(patch);
      }
    }
    out.coastDir = coastDir;
    if (out.oceanCells.length > 0) out.sea = seaBackdrop(coastDir, tan, coastDist, Rc);
    return out;
  }
  function buildRiverGeometry(model, cfg, Rc, coastDir) {
    const out = { river: null, riverPath: null, riverEdges: /* @__PURE__ */ new Map(), riverWidth: 0 };
    if (!cfg || cfg.enabled === false) return out;
    const width = (cfg.width != null ? cfg.width : 0.16) * Rc;
    const river = buildRiver(model, coastDir);
    if (!river || river.path.length < 2) return out;
    out.riverWidth = width;
    out.riverPath = new Polygon(river.path);
    out.river = riverBand(river.path, width);
    for (let i = 0; i < river.path.length - 1; i++) {
      addEdge(out.riverEdges, river.path[i], river.path[i + 1]);
      addEdge(out.riverEdges, river.path[i + 1], river.path[i]);
    }
    return out;
  }
  function addEdge(map, a, b) {
    let s = map.get(a);
    if (!s) map.set(a, s = /* @__PURE__ */ new Set());
    s.add(b);
  }
  function seaBackdrop(coastDir, tan, coastDist, Rc) {
    const span = 8 * Rc;
    const depth = 8 * Rc;
    const base = coastDir.scale(coastDist);
    const a = new Point(base.x + tan.x * span, base.y + tan.y * span);
    const b = new Point(base.x - tan.x * span, base.y - tan.y * span);
    const c = new Point(b.x + coastDir.x * depth, b.y + coastDir.y * depth);
    const d = new Point(a.x + coastDir.x * depth, a.y + coastDir.y * depth);
    return new Polygon([a, b, c, d]);
  }
  function buildRiver(model, coastDir) {
    const graph = new Graph();
    const pt2node = /* @__PURE__ */ new Map();
    const node2pt = /* @__PURE__ */ new Map();
    const proc = (v) => {
      let n2 = pt2node.get(v);
      if (!n2) {
        n2 = graph.add();
        pt2node.set(v, n2);
        node2pt.set(n2, v);
      }
      return n2;
    };
    const landDir = /* @__PURE__ */ new Map();
    const oceanDir = /* @__PURE__ */ new Map();
    for (const p of model.patches) {
      const s = p.shape;
      for (let i = 0; i < s.length; i++) {
        const v0 = s[i];
        const v1 = s[(i + 1) % s.length];
        if (p.isWater) {
          addEdge(oceanDir, v0, v1);
        } else {
          const n0 = proc(v0);
          const n1 = proc(v1);
          n0.link(n1, Point.distance(v0, v1));
          addEdge(landDir, v0, v1);
        }
      }
    }
    const horizon = /* @__PURE__ */ new Set();
    const coastal = [];
    for (const [v0, set] of landDir) {
      for (const v1 of set) {
        const reverseIsLand = landDir.get(v1) && landDir.get(v1).has(v0);
        if (!reverseIsLand) {
          horizon.add(v0);
          horizon.add(v1);
          const reverseIsOcean = oceanDir.get(v1) && oceanDir.get(v1).has(v0);
          if (reverseIsOcean) coastal.push(v0);
        }
      }
    }
    const horizonArr = [...horizon];
    if (horizonArr.length < 2) return null;
    const candidates = coastal.length > 0 ? coastal : horizonArr;
    const mouth = candidates[Math.trunc(Random.float() * candidates.length)];
    const md = mouth.norm(1);
    let opposite = null;
    let best = Infinity;
    for (const v of horizonArr) {
      const d = v.norm(1);
      const dot = d.x * md.x + d.y * md.y;
      if (dot < best) {
        best = dot;
        opposite = v;
      }
    }
    if (opposite == null || opposite === mouth) return null;
    const centerNode = pt2node.get(model.center);
    const mouthNode = pt2node.get(mouth);
    const oppNode = pt2node.get(opposite);
    if (!centerNode || !mouthNode || !oppNode) return null;
    const a = graph.aStar(oppNode, centerNode);
    const b = graph.aStar(centerNode, mouthNode);
    if (a == null || b == null) return null;
    const segA = a.map((n2) => node2pt.get(n2)).reverse();
    const segB = b.map((n2) => node2pt.get(n2)).reverse();
    const path = segA.concat(segB.slice(1));
    return { path, mouth, opposite };
  }
  function riverBand(path, width) {
    const hw = width / 2;
    const left = [];
    const right = [];
    for (let i = 0; i < path.length; i++) {
      const a = i === 0 ? path[i + 1].subtract(path[i]) : path[i].subtract(path[i - 1]);
      const len = Math.hypot(a.x, a.y) || 1;
      const nx = -a.y / len;
      const ny = a.x / len;
      left.push(new Point(path[i].x + nx * hw, path[i].y + ny * hw));
      right.push(new Point(path[i].x - nx * hw, path[i].y - ny * hw));
    }
    return new Polygon(left.concat(right.reverse()));
  }

  // src/core/Cutter.js
  var Cutter = class {
    // Cut a polygon across the edge starting at `vertex`, at `ratio` along it, rotated by `angle`.
    static bisect(poly, vertex, ratio = 0.5, angle = 0, gap = 0) {
      const next = poly.next(vertex);
      const p1 = GeomUtils.interpolate(vertex, next, ratio);
      const d = next.subtract(vertex);
      const cosB = Math.cos(angle);
      const sinB = Math.sin(angle);
      const vx = d.x * cosB - d.y * sinB;
      const vy = d.y * cosB + d.x * sinB;
      const p2 = new Point(p1.x - vy, p1.y + vx);
      return poly.cut(p1, p2, gap);
    }
    static radial(poly, center = null, gap = 0) {
      if (center == null) center = poly.centroid;
      const sectors = [];
      poly.forEdge((v0, v1) => {
        let sector = new Polygon([center, v0, v1]);
        if (gap > 0) sector = sector.shrink([gap / 2, 0, gap / 2]);
        sectors.push(sector);
      });
      return sectors;
    }
    static semiRadial(poly, center = null, gap = 0) {
      if (center == null) {
        const centroid = poly.centroid;
        center = amin(poly, (v) => Point.distance(v, centroid));
      }
      gap /= 2;
      const sectors = [];
      poly.forEdge((v0, v1) => {
        if (v0 !== center && v1 !== center) {
          let sector = new Polygon([center, v0, v1]);
          if (gap > 0) {
            const d = [poly.findEdge(center, v0) === -1 ? gap : 0, 0, poly.findEdge(v1, center) === -1 ? gap : 0];
            sector = sector.shrink(d);
          }
          sectors.push(sector);
        }
      });
      return sectors;
    }
    static ring(poly, thickness) {
      const slices = [];
      poly.forEdge((v1, v2) => {
        const v = v2.subtract(v1);
        const n2 = v.rotate90().norm(thickness);
        slices.push({ p1: v1.add(n2), p2: v2.add(n2), len: v.length });
      });
      slices.sort((s1, s2) => s1.len - s2.len);
      const peel = [];
      let p = poly;
      for (let i = 0; i < slices.length; i++) {
        const halves = p.cut(slices[i].p1, slices[i].p2);
        p = halves[0];
        if (halves.length === 2) peel.push(halves[1]);
      }
      return peel;
    }
  };

  // src/core/features.js
  var _features = [];
  function clearFeatures() {
    _features.length = 0;
  }
  function takeFeatures() {
    const out = _features.slice();
    _features.length = 0;
    return out;
  }
  function featureKind(x, y) {
    const h = (Math.imul(Math.round(x * 16), 73856093) ^ Math.imul(Math.round(y * 16), 19349663)) >>> 0;
    return h % 4 === 0 ? "fountain" : "tree";
  }
  function recordFeature(x, y, kind) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    _features.push({ x, y, kind: kind || featureKind(x, y) });
  }
  function recordRemovedTriangle(a, b, c) {
    if (!a || !b || !c) return;
    recordFeature((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
  }

  // src/core/AlleySlicer.js
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
    if (p.length < 3) return p.slice();
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const pt of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
      lower.push(pt);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const pt = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
      upper.push(pt);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }
  function aabb(pts) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return [new Point(minX, minY), new Point(maxX, minY), new Point(maxX, maxY), new Point(minX, maxY)];
  }
  function obb(poly) {
    const hull = convexHull(poly);
    if (hull == null || hull.length < 3) return aabb(poly);
    let bestArea = Infinity;
    let best = null;
    let bestDir = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      if (a.x === b.x && a.y === b.y) continue;
      const dir = b.subtract(a);
      dir.normalize(1);
      const cos2 = dir.x;
      const sin2 = dir.y;
      let minL = Infinity;
      let maxL = -Infinity;
      let minM = Infinity;
      let maxM = -Infinity;
      for (const p of hull) {
        const l = p.x * cos2 + p.y * sin2;
        const m = p.y * cos2 - p.x * sin2;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
        if (m < minM) minM = m;
        if (m > maxM) maxM = m;
      }
      const area = (maxL - minL) * (maxM - minM);
      if (area < bestArea) {
        bestArea = area;
        best = [new Point(minL, minM), new Point(maxL, minM), new Point(maxL, maxM), new Point(minL, maxM)];
        bestDir = dir;
      }
    }
    const cos = bestDir.x;
    const sin = bestDir.y;
    return best.map((p) => new Point(p.x * cos - p.y * sin, p.y * cos + p.x * sin));
  }
  function containsPoint(poly, pt) {
    let inside = false;
    const n2 = poly.length;
    for (let i = 0, j = n2 - 1; i < n2; j = i++) {
      const a = poly[j];
      const b = poly[i];
      if (a.y > pt.y !== b.y > pt.y) {
        const xCross = a.x + (pt.y - a.y) * (b.x - a.x) / (b.y - a.y);
        if (pt.x < xCross) inside = !inside;
      }
    }
    return inside;
  }
  function splitAlong(poly, e1, e2, cut) {
    const n2 = poly.length;
    const en = cut[0];
    const ex = cut[cut.length - 1];
    const cutN = cut.length - 1;
    const interior = cut.slice(1, cut.length - 1);
    const interiorRev = interior.slice().reverse();
    const arcF = [];
    for (let i = (e1 + 1) % n2; ; i = (i + 1) % n2) {
      arcF.push(poly[i]);
      if (i === e2) break;
    }
    const arcB = [];
    for (let i = (e2 + 1) % n2; ; i = (i + 1) % n2) {
      arcB.push(poly[i]);
      if (i === e1) break;
    }
    const half1 = new Polygon([en, ...arcF, ex, ...interiorRev]);
    const half2 = new Polygon([ex, ...arcB, en, ...interior]);
    const ranges = [
      { start: arcF.length + 1, count: cutN },
      { start: arcB.length + 1, count: cutN }
    ];
    return { halves: [half1, half2], ranges };
  }
  function insetCutChainEdges(half, start, count2, gap) {
    if (!half || half.length < 3 || !(gap > 0) || count2 <= 0) return half;
    const n2 = half.length;
    const area0 = Math.abs(half.square);
    let result = half;
    try {
      for (let j = 0; j < count2; j++) {
        const idx = (start + j) % result.length;
        result = result.peel(result[idx], gap / 2);
        if (!result || result.length < 3) return half;
      }
    } catch (e) {
      return half;
    }
    if (!result || result.length < 3 || Math.abs(result.square) < area0 * 0.15) return half;
    return result;
  }
  function lotMinWidth(poly) {
    if (!poly || poly.length < 3) return 0;
    const corners = obb(poly);
    const w = Point.distance(corners[0], corners[1]);
    const h = Point.distance(corners[1], corners[2]);
    return Math.min(w, h);
  }
  function longestEdgeIndex(poly) {
    let best = 0;
    let bestLen = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const len = Point.distance(poly[i], poly[(i + 1) % poly.length]);
      if (len > bestLen) {
        best = i;
        bestLen = len;
      }
    }
    return best;
  }
  function inwardNormal(poly, edgeIndex) {
    const a = poly[edgeIndex];
    const b = poly[(edgeIndex + 1) % poly.length];
    const edge = b.subtract(a);
    if (edge.length < 1e-6) return new Point(0, 0);
    let n2 = edge.rotate90().norm(1);
    const mid = new Point((a.x + b.x) / 2, (a.y + b.y) / 2);
    const probe = mid.add(n2.scale(0.5));
    if (!containsPoint(poly, probe)) n2 = n2.scale(-1);
    return n2;
  }
  function rotateDir(v, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Point(v.x * c - v.y * s, v.x * s + v.y * c);
  }
  function rayExit(poly, origin, dir, skipEdge = -1, minT = 1e-5) {
    let best = null;
    for (let i = 0; i < poly.length; i++) {
      if (i === skipEdge) continue;
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ev = b.subtract(a);
      if (ev.length < 1e-10) continue;
      const hit = GeomUtils.intersectLines(origin.x, origin.y, dir.x, dir.y, a.x, a.y, ev.x, ev.y);
      if (hit && hit.x > minT && hit.y > 1e-5 && hit.y < 1 - 1e-5) {
        if (!best || hit.x < best.t) {
          best = {
            t: hit.x,
            edge: i,
            point: new Point(origin.x + dir.x * hit.x, origin.y + dir.y * hit.x)
          };
        }
      }
    }
    return best;
  }
  function minAngle(poly) {
    if (!poly || poly.length < 3) return 0;
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i + poly.length - 1) % poly.length];
      const b = poly[i];
      const c = poly[(i + 1) % poly.length];
      const u = a.subtract(b);
      const v = c.subtract(b);
      if (u.length < 1e-6 || v.length < 1e-6) return 0;
      const cos = Math.max(-1, Math.min(1, u.dot(v) / (u.length * v.length)));
      best = Math.min(best, Math.acos(cos));
    }
    return best;
  }
  function chamferSharpCorners(poly, minAngle2, size, edgeFrac = 0.4) {
    if (!poly || poly.length < 3 || !(size > 0)) return poly;
    const n2 = poly.length;
    const out = [];
    let changed = false;
    for (let i = 0; i < n2; i++) {
      const v = poly[i];
      const prev = poly[(i + n2 - 1) % n2];
      const next = poly[(i + 1) % n2];
      const u = prev.subtract(v);
      const w = next.subtract(v);
      const lu = u.length;
      const lw = w.length;
      if (lu < 1e-9 || lw < 1e-9) {
        out.push(v);
        continue;
      }
      const cos = Math.max(-1, Math.min(1, u.dot(w) / (lu * lw)));
      if (Math.acos(cos) >= minAngle2) {
        out.push(v);
        continue;
      }
      const d = Math.min(size, Math.min(lu, lw) * edgeFrac);
      if (!(d > 1e-9)) {
        out.push(v);
        continue;
      }
      const p1 = v.add(u.norm(d));
      const p2 = v.add(w.norm(d));
      out.push(p1);
      out.push(p2);
      recordRemovedTriangle(v, p1, p2);
      changed = true;
    }
    return changed ? new Polygon(out) : poly;
  }
  function chamferLots(lots, minAngle2, size, edgeFrac) {
    if (!(size > 0)) return lots;
    return lots.map((lot) => {
      if (!lot || lot.length < 3) return lot;
      try {
        const c = chamferSharpCorners(lot, minAngle2, size, edgeFrac);
        if (c && c.length >= 3) return c;
      } catch (e) {
      }
      return lot;
    });
  }
  function pointSegmentDistance(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return Point.distance(p, a);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function minNeckWidth(poly) {
    if (!poly || poly.length < 4) return Infinity;
    const n2 = poly.length;
    let best = Infinity;
    for (let i = 0; i < n2; i++) {
      const v = poly[i];
      for (let j = 0; j < n2; j++) {
        if (j === i || j === (i + n2 - 1) % n2) continue;
        const d = pointSegmentDistance(v, poly[j], poly[(j + 1) % n2]);
        if (d < best) best = d;
      }
    }
    return best;
  }
  function validElbowLots(halves, ranges, gap, minLotArea, minLotAngle, minLotWidth, minLotNeck = 0) {
    const lots = [];
    for (let i = 0; i < halves.length; i++) {
      let lot = halves[i];
      if (minLotWidth > 0 && lotMinWidth(lot) < minLotWidth) return null;
      if (gap > 0) lot = insetCutChainEdges(lot, ranges[i].start, ranges[i].count, gap);
      if (!lot || lot.length < 3) return null;
      if (Math.abs(lot.square) < minLotArea) return null;
      if (minAngle(lot) < minLotAngle) return null;
      if (minLotNeck > 0 && minNeckWidth(lot) < minLotNeck) return null;
      lots.push(lot);
    }
    return lots;
  }
  function makeEdgeElbowCut(poly, params) {
    if (!poly || poly.length < 4) return null;
    const minLotArea = params.minLotArea || 40;
    const minLotAngle = params.minLotAngle || Math.PI / 9;
    const gap = params.gap || 0;
    const minLotWidth = params.minLotWidth || 0;
    const minLotNeck = params.minLotNeck || 0;
    const angleMin = params.elbowAngleMin || Math.PI / 9;
    const angleMax = params.elbowAngleMax || Math.PI / 2;
    const edgeIndex = longestEdgeIndex(poly);
    const a = poly[edgeIndex];
    const b = poly[(edgeIndex + 1) % poly.length];
    const edge = b.subtract(a);
    const edgeLen = edge.length;
    if (edgeLen < 1e-6) return null;
    const inward = inwardNormal(poly, edgeIndex);
    if (inward.length < 1e-6) return null;
    for (let attempt = 0; attempt < (params.attempts || 14); attempt++) {
      const slotCount = params.maxCuts || 2;
      const slot = attempt % Math.max(1, slotCount);
      const baseT = (slot + 1) / (slotCount + 1);
      const jitter = (Random.float() - 0.5) * (0.55 / (slotCount + 1));
      const t = Math.max(0.12, Math.min(0.88, baseT + jitter));
      const entry = new Point(a.x + edge.x * t, a.y + edge.y * t);
      const inwardExit = rayExit(poly, entry, inward, edgeIndex);
      if (!inwardExit || inwardExit.t < Math.sqrt(minLotArea) * 1.5) continue;
      const firstLen = inwardExit.t * (0.28 + Random.float() * 0.38);
      const elbow = new Point(entry.x + inward.x * firstLen, entry.y + inward.y * firstLen);
      if (!containsPoint(poly, elbow)) continue;
      const signs = Random.bool() ? [1, -1] : [-1, 1];
      for (const sign of signs) {
        const turn = angleMin + Random.float() * (angleMax - angleMin);
        const dir = rotateDir(inward, sign * turn);
        const exit = rayExit(poly, elbow, dir, edgeIndex);
        if (!exit || exit.edge === edgeIndex || exit.t < Math.sqrt(minLotArea)) continue;
        const cut = [entry, elbow, exit.point];
        const split = splitAlong(poly, edgeIndex, exit.edge, cut);
        const lots = validElbowLots(split.halves, split.ranges, gap, minLotArea, minLotAngle, minLotWidth, minLotNeck);
        if (lots) return { lots, alley: cut };
      }
    }
    return null;
  }
  function makeEdgeStraightCut(poly, params) {
    if (!poly || poly.length < 4) return null;
    const minLotArea = params.minLotArea || 40;
    const minLotAngle = params.minLotAngle || Math.PI / 9;
    const gap = params.gap || 0;
    const minLotWidth = params.minLotWidth || 0;
    const minLotNeck = params.minLotNeck || 0;
    const edgeIndex = longestEdgeIndex(poly);
    const a = poly[edgeIndex];
    const b = poly[(edgeIndex + 1) % poly.length];
    const edge = b.subtract(a);
    const edgeLen = edge.length;
    if (edgeLen < 1e-6) return null;
    const inward = inwardNormal(poly, edgeIndex);
    if (inward.length < 1e-6) return null;
    for (let attempt = 0; attempt < (params.attempts || 14); attempt++) {
      const t = Math.max(0.12, Math.min(0.88, 0.5 + (Random.float() - 0.5) * 0.62));
      const entry = new Point(a.x + edge.x * t, a.y + edge.y * t);
      const exit = rayExit(poly, entry, inward, edgeIndex);
      if (!exit || exit.t < Math.sqrt(minLotArea) * 2) continue;
      const cut = [entry, exit.point];
      const split = splitAlong(poly, edgeIndex, exit.edge, cut);
      const lots = validElbowLots(split.halves, split.ranges, gap, minLotArea, minLotAngle, minLotWidth, minLotNeck);
      if (lots) return { lots, alley: cut };
    }
    return null;
  }
  function sliceWardEdgeElbows(block, params = {}) {
    const gap = params.gap || 0;
    const neckFloor = params.minLotNeck != null ? params.minLotNeck : gap > 0 ? gap * 0.6 : 0;
    const cutParams = gap > 0 ? { ...params, gap: 0, minLotWidth: 2 * gap, minLotNeck: neckFloor + gap } : { ...params, minLotNeck: neckFloor };
    const schedule = params.schedule || ["elbow", "straight", "elbow"];
    const maxFailedInRow = params.maxFailedInRow != null ? params.maxFailedInRow : 3;
    let lots = [block];
    const alleys = [];
    let failedInRow = 0;
    for (let i = 0; i < schedule.length; i++) {
      let targetIndex = -1;
      let targetArea = -Infinity;
      for (let j = 0; j < lots.length; j++) {
        const area = Math.abs(lots[j].square);
        if (area > targetArea) {
          targetArea = area;
          targetIndex = j;
        }
      }
      if (targetIndex === -1 || targetArea < (params.minLotArea || 40) * 2.6) break;
      const cut = schedule[i] === "straight" ? makeEdgeStraightCut(lots[targetIndex], cutParams) : makeEdgeElbowCut(lots[targetIndex], cutParams);
      if (!cut) {
        failedInRow++;
        if (failedInRow >= maxFailedInRow) break;
        i--;
        continue;
      }
      lots.splice(targetIndex, 1, ...cut.lots);
      alleys.push(cut.alley);
      failedInRow = 0;
    }
    if (gap > 0) {
      lots = lots.map((lot) => {
        if (!lot || lot.length < 3) return lot;
        const area0 = Math.abs(lot.square);
        try {
          const shrunk = lot.shrinkRobust(gap / 2);
          if (shrunk && shrunk.length >= 3 && Math.abs(shrunk.square) > area0 * 0.15) return shrunk;
        } catch (e) {
        }
        return lot;
      });
    }
    if (neckFloor > 0) lots = lots.filter((lot) => lot && lot.length >= 3 && minNeckWidth(lot) >= neckFloor);
    if (params.chamfer !== false) {
      const chamferAngle = params.chamferAngle != null ? params.chamferAngle : Math.PI / 6;
      const charLen = Math.sqrt(params.minLotArea || 40);
      const chamferSize = params.chamferSize != null ? params.chamferSize : gap > 0 ? gap : charLen * 0.5;
      lots = chamferLots(lots, chamferAngle, chamferSize, params.chamferEdgeFrac);
    }
    if (params.emptyProb > 0) lots = lots.filter(() => Random.bool(1 - params.emptyProb));
    return { lots, alleys };
  }

  // src/core/wards.js
  var OPEN_TYPES = /* @__PURE__ */ new Set(["plaza", "market", "park", "water"]);
  function isShoreEdge2(model, v0, v1) {
    if (!model.patchByVertex) return false;
    const edgePatches = model.patchByVertex(v0).filter((p) => p.shape.findEdge(v0, v1) !== -1 || p.shape.findEdge(v1, v0) !== -1);
    return edgePatches.some((p) => p.isWater) && edgePatches.some((p) => !p.isWater);
  }
  function isShoreVertex(model, v) {
    if (!model.patchByVertex) return false;
    const patches = model.patchByVertex(v);
    return patches.some((p) => p.isWater) && patches.some((p) => !p.isWater);
  }
  function isBuiltWallVertex(wall, v) {
    if (!wall || !wall.shape) return false;
    const i = wall.shape.indexOf(v);
    if (i === -1) return false;
    const len = wall.shape.length;
    if (!wall.segments) return true;
    return wall.segments[i] || wall.segments[(i + len - 1) % len];
  }
  function nodeClearance(model, v, widths) {
    const clearances = obstacleClearances(model, widths);
    let clearance = 0;
    if (model.water && model.water.riverPath && model.water.riverPath.includes(v))
      clearance = Math.max(clearance, clearances.river);
    if (isShoreVertex(model, v))
      clearance = Math.max(clearance, clearances.shore);
    if (model.wall && model.wall.towers && model.wall.towers.includes(v))
      clearance = Math.max(clearance, clearances.tower);
    if (model.citadelWall && model.citadelWall.towers && model.citadelWall.towers.includes(v))
      clearance = Math.max(clearance, clearances.tower);
    if (isBuiltWallVertex(model.wall, v) || isBuiltWallVertex(model.citadelWall, v))
      clearance = Math.max(clearance, clearances.wall);
    return clearance;
  }
  function clippedCorner(poly, sourceShape, corner, clearance) {
    if (!poly || poly.length < 3 || !(clearance > 0)) return poly;
    const idx = sourceShape.indexOf(corner);
    if (idx === -1) return poly;
    const dir = sourceShape.centroid.subtract(corner);
    if (dir.length > 1e-6) {
      dir.normalize(1);
      const n2 = new Point(-dir.y, dir.x);
      const cutCenter = corner.add(dir.scale(clearance));
      const capped = clipToOffsetSide(poly, cutCenter.subtract(n2), cutCenter.add(n2), -1, 0);
      if (capped && capped.length >= 3 && Math.abs(capped.square) >= Math.abs(poly.square) * 0.01)
        return capped;
    }
    const prev = sourceShape[(idx + sourceShape.length - 1) % sourceShape.length];
    const next = sourceShape[(idx + 1) % sourceShape.length];
    const prevLen = Point.distance(corner, prev);
    const nextLen = Point.distance(corner, next);
    if (prevLen < 1e-6 || nextLen < 1e-6) return poly;
    const reach = Math.min(clearance, prevLen * 0.65, nextLen * 0.65);
    if (!(reach > 1e-6)) return poly;
    const a = corner.add(prev.subtract(corner).norm(reach));
    const b = corner.add(next.subtract(corner).norm(reach));
    const halves = poly.cut(a, b);
    if (halves.length < 2) return poly;
    let best = poly;
    let bestDistance = -Infinity;
    const minKeptArea = Math.abs(poly.square) * 0.35;
    for (const half of halves) {
      if (!half || half.length < 3 || Math.abs(half.square) < minKeptArea) continue;
      const d = Point.distance(half.center, corner);
      if (d > bestDistance) {
        best = half;
        bestDistance = d;
      }
    }
    return best;
  }
  function clipObstacleCorners(poly, sourceShape, model, widths) {
    let clipped = poly;
    for (const v of sourceShape) {
      const clearance = nodeClearance(model, v, widths);
      if (clearance > 0) clipped = clippedCorner(clipped, sourceShape, v, clearance);
      if (!clipped || clipped.length < 3) return poly;
    }
    return clipped || poly;
  }
  function passageMargin(widths) {
    return Math.max(widths.regular || 0, (widths.main || 0) * 0.6, 0.8);
  }
  function obstacleClearances(model, widths) {
    const passage = passageMargin(widths);
    return {
      river: (model.riverWidth || 0) * 0.59 + passage,
      // Shore is one-sided: roads get their width from two blocks each inset by
      // regular/2, so the coast needs one full regular width for the same path.
      shore: Math.max(widths.regular || 0, 0.6),
      wall: Math.max((widths.main || 0) * 0.45, 0.6) + passage,
      tower: Math.max((widths.main || 0) * 0.4, 0.4) + passage
    };
  }
  function lineSignedDistance(a, b, p) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) return 0;
    return (dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
  }
  function sideForShape(shape, a, b) {
    let side = lineSignedDistance(a, b, shape.centroid);
    if (Math.abs(side) < 1e-6) {
      for (const v of shape) {
        const d = lineSignedDistance(a, b, v);
        if (Math.abs(d) > Math.abs(side)) side = d;
      }
    }
    return side >= 0 ? 1 : -1;
  }
  function clipToOffsetSide(poly, a, b, side, clearance) {
    if (!poly || poly.length < 3 || clearance == null || clearance < 0) return poly;
    if (Point.distance(a, b) < 1e-6) return poly;
    const out = [];
    let prev = poly[poly.length - 1];
    let prevD = side * lineSignedDistance(a, b, prev);
    let prevInside = prevD >= clearance - 1e-6;
    for (const cur of poly) {
      const curD = side * lineSignedDistance(a, b, cur);
      const curInside = curD >= clearance - 1e-6;
      if (curInside !== prevInside) {
        const denom = curD - prevD;
        if (Math.abs(denom) > 1e-9) {
          const t = (clearance - prevD) / denom;
          out.push(new Point(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t));
        }
      }
      if (curInside) out.push(cur);
      prev = cur;
      prevD = curD;
      prevInside = curInside;
    }
    const clipped = new Polygon(out);
    return clipped.length >= 3 && Math.abs(clipped.square) > 1e-6 ? clipped : null;
  }
  function cutAwayFromSegment(poly, sourceShape, a, b, clearance) {
    const clipped = clipToOffsetSide(poly, a, b, sideForShape(sourceShape, a, b), clearance);
    if (!clipped || clipped.length < 3) return poly;
    if (Math.abs(clipped.square) < Math.abs(poly.square) * 0.01) return poly;
    return clipped;
  }
  function cutAwayFromPoint(poly, sourceShape, point, clearance) {
    const dir = sourceShape.centroid.subtract(point);
    if (!poly || poly.length < 3 || !(clearance > 0) || dir.length < 1e-6) return poly;
    dir.normalize(1);
    const n2 = new Point(-dir.y, dir.x);
    const cutCenter = point.add(dir.scale(clearance));
    const clipped = clipToOffsetSide(poly, cutCenter.subtract(n2), cutCenter.add(n2), -1, 0);
    if (!clipped || clipped.length < 3) return poly;
    if (Math.abs(clipped.square) < Math.abs(poly.square) * 0.01) return poly;
    return clipped;
  }
  function norm(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }
  function cubicPoint(a, c1, c2, b, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return new Point(
      a.x * mt2 * mt + 3 * c1.x * mt2 * t + 3 * c2.x * mt * t2 + b.x * t2 * t,
      a.y * mt2 * mt + 3 * c1.y * mt2 * t + 3 * c2.y * mt * t2 + b.y * t2 * t
    );
  }
  function smoothPathSegments(pts, samplesPerSegment = 16) {
    if (!pts || pts.length < 2) return [];
    if (pts.length === 2) return [{ from: pts[0], to: pts[1], samples: [pts[0], pts[1]] }];
    const extrap = (a2, b, c) => {
      const ax = b.x - a2.x;
      const ay = b.y - a2.y;
      const bx = c.x - b.x;
      const by = c.y - b.y;
      const d = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
      const sin = (ax * by - ay * bx) / d;
      const cos = (ax * bx + ay * by) / d;
      return new Point(c.x + (bx * cos - by * sin), c.y + (by * cos + bx * sin));
    };
    const a = [extrap(pts[2], pts[1], pts[0]), ...pts, extrap(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1])];
    const segments = [];
    for (let k = 1; k < a.length - 2; k++) {
      const g2 = a[k];
      const m = a[k + 1];
      const p = a[k + 2];
      const inD = norm(g2.x - a[k - 1].x, g2.y - a[k - 1].y);
      const segD = norm(m.x - g2.x, m.y - g2.y);
      const outD = norm(p.x - m.x, p.y - m.y);
      const tN = norm(inD.x + segD.x, inD.y + segD.y);
      const tP = norm(segD.x + outD.x, segD.y + outD.y);
      const len = Point.distance(g2, m);
      let w = 1 / (1 + (tN.x * segD.x + tN.y * segD.y) + (tP.x * segD.x + tP.y * segD.y));
      if (!isFinite(w) || w < 0) w = 1 / 3;
      const q = len * Math.min(w, 1);
      const c1 = new Point(g2.x + tN.x * q, g2.y + tN.y * q);
      const c2 = new Point(m.x - tP.x * q, m.y - tP.y * q);
      const samples = [];
      for (let i = 0; i <= samplesPerSegment; i++) samples.push(cubicPoint(g2, c1, c2, m, i / samplesPerSegment));
      segments.push({ from: g2, to: m, samples });
    }
    return segments;
  }
  function pointInPolygon(point, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      const crosses = a.y > point.y !== b.y > point.y;
      if (crosses) {
        const x = (b.x - a.x) * (point.y - a.y) / (b.y - a.y || 1e-12) + a.x;
        if (point.x < x) inside = !inside;
      }
    }
    return inside;
  }
  function pointPolygonDistance(point, poly) {
    let best = Infinity;
    poly.forEdge((a, b) => {
      best = Math.min(best, pointSegmentDistance2(point, a, b));
    });
    return best;
  }
  function pathSamplesTouchShape(samples, shape, clearance) {
    for (const p of samples)
      if (pointInPolygon(p, shape) || pointPolygonDistance(p, shape) <= clearance)
        return true;
    return false;
  }
  function clipFromPathObstacle(poly, sourceShape, path, clearance) {
    let clipped = poly;
    let touched = false;
    const sampledPath = [];
    for (const seg of smoothPathSegments(path)) {
      if (!pathSamplesTouchShape(seg.samples, sourceShape, clearance)) continue;
      touched = true;
      if (sampledPath.length === 0) sampledPath.push(seg.samples[0]);
      for (let i = 1; i < seg.samples.length; i++) sampledPath.push(seg.samples[i]);
      for (const p of seg.samples) clipped = cutAwayFromPoint(clipped, sourceShape, p, clearance);
      for (let i = 0; i < seg.samples.length - 1; i++)
        clipped = cutAwayFromSegment(clipped, sourceShape, seg.samples[i], seg.samples[i + 1], clearance);
    }
    if (touched && minDistanceToPolyline(clipped, sampledPath) < clearance * 0.9) return null;
    return clipped;
  }
  function pointSegmentDistance2(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function minDistanceToPolyline(poly, path) {
    if (!poly || poly.length < 3 || !path || path.length < 2) return Infinity;
    let best = Infinity;
    for (const v of poly)
      for (let i = 0; i < path.length - 1; i++)
        best = Math.min(best, pointSegmentDistance2(v, path[i], path[i + 1]));
    return best;
  }
  function activeWallEdges(wall) {
    const out = [];
    if (!wall || !wall.shape) return out;
    for (let i = 0; i < wall.shape.length; i++) {
      if (wall.segments && wall.segments[i] === false) continue;
      out.push([wall.shape[i], wall.shape[(i + 1) % wall.shape.length]]);
    }
    return out;
  }
  function clipFromWallObstacle(poly, sourceShape, patch, wall, clearance) {
    if (!wall || !wall.shape) return poly;
    let clipped = poly;
    for (const [a, b] of activeWallEdges(wall)) {
      const bordersPatch = patch != null && typeof wall.bordersBy === "function" ? wall.bordersBy(patch, a, b) || wall.bordersBy(patch, b, a) : sourceShape.findEdge(a, b) !== -1 || sourceShape.findEdge(b, a) !== -1;
      if (bordersPatch) clipped = cutAwayFromSegment(clipped, sourceShape, a, b, clearance);
    }
    return clipped;
  }
  function clipFromShoreObstacle(poly, sourceShape, model, clearance) {
    if (!model || typeof model.patchByVertex !== "function") return poly;
    let clipped = poly;
    sourceShape.forEdge((v0, v1) => {
      if (isShoreEdge2(model, v0, v1)) clipped = cutAwayFromSegment(clipped, sourceShape, v0, v1, clearance);
    });
    return clipped;
  }
  function clipObstacleEdges(poly, sourceShape, model, widths, patch) {
    const clearance = obstacleClearances(model, widths);
    let clipped = poly;
    if (model.water && model.water.riverPath)
      clipped = clipFromPathObstacle(clipped, sourceShape, model.water.riverPath, clearance.river);
    if (!clipped || clipped.length < 3) return null;
    clipped = clipFromShoreObstacle(clipped, sourceShape, model, clearance.shore);
    clipped = clipFromWallObstacle(clipped, sourceShape, patch, model.wall, clearance.wall);
    clipped = clipFromWallObstacle(clipped, sourceShape, patch, model.citadelWall, clearance.wall);
    return clipped;
  }
  function triangleHeight(a, b, c) {
    const base = Point.distance(a, c);
    if (base < 1e-6) return 0;
    return Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / base;
  }
  function cornerCos(a, b, c) {
    const ux = a.x - b.x;
    const uy = a.y - b.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const ul = Math.hypot(ux, uy);
    const vl = Math.hypot(vx, vy);
    if (ul < 1e-6 || vl < 1e-6) return -1;
    return (ux * vx + uy * vy) / (ul * vl);
  }
  function cleanupBuildablePolygon(poly, widths) {
    if (!poly || poly.length < 3) return null;
    let cleaned = new Polygon(poly);
    const minEdge = Math.max((widths.alley || 0) * 0.6, 0.35);
    const maxTipHeight = Math.max((widths.regular || 0) * 0.45, 0.35);
    const acuteCos = Math.cos(Math.PI / 9);
    for (let pass = 0; pass < 8 && cleaned.length > 3; pass++) {
      let removed = false;
      for (let i = 0; i < cleaned.length; i++) {
        const a = cleaned[(i + cleaned.length - 1) % cleaned.length];
        const b = cleaned[i];
        const c = cleaned[(i + 1) % cleaned.length];
        const prevLen = Point.distance(a, b);
        const nextLen = Point.distance(b, c);
        const height = triangleHeight(a, b, c);
        const sharp = cornerCos(a, b, c) > acuteCos;
        if (sharp && height < maxTipHeight * 2.5 || Math.min(prevLen, nextLen) < minEdge || height < maxTipHeight) {
          cleaned.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (!removed) break;
    }
    const area = Math.abs(cleaned.square);
    const minArea = Math.max(1, (widths.regular || 1) * (widths.regular || 1) * 2);
    if (cleaned.length < 3 || area < minArea) return null;
    if (cleaned.length === 3) {
      let minHeight = Infinity;
      for (let i = 0; i < 3; i++)
        minHeight = Math.min(minHeight, triangleHeight(cleaned[(i + 2) % 3], cleaned[i], cleaned[(i + 1) % 3]));
      if (minHeight < maxTipHeight || cleaned.compactness < 0.08) return null;
    }
    return cleaned;
  }
  function insetShape(model, shape, widths, withinWalls, patch = null) {
    const { regular, alley } = widths;
    const innerPatch = model.wall == null || withinWalls;
    const fixedInset = (innerPatch ? regular : alley) / 2;
    const insetDist = shape.map(() => fixedInset);
    const base = shape.isConvex() ? shape.shrink(insetDist) : shape.buffer(insetDist);
    const edgeClipped = clipObstacleEdges(base, shape, model, widths, patch);
    if (!edgeClipped || edgeClipped.length < 3) return null;
    return cleanupBuildablePolygon(clipObstacleCorners(edgeClipped, shape, model, widths), widths);
  }
  function getCityBlock(model, patch, widths) {
    return insetShape(model, patch.shape, widths, patch.withinWalls, patch);
  }
  function cathedralRate(model, patch) {
    if (model.plaza != null && patch.shape.borders(model.plaza.shape)) return -1 / patch.shape.square;
    return patch.shape.distance(model.plaza != null ? model.plaza.shape.center : model.center) * patch.shape.square;
  }
  function marketRate(model, patch) {
    for (const p of model.inner)
      if (p.type === "market" && p.shape.borders(patch.shape)) return Number.POSITIVE_INFINITY;
    return model.plaza != null ? patch.shape.square / model.plaza.shape.square : patch.shape.distance(model.center);
  }
  function createAlleys(p, minSq, gridChaos, sizeChaos, emptyProb = 0.04, split = true, alley = 0.6, depth = 0) {
    if (!p || p.length < 3) return [];
    let v = null;
    let length = -1;
    p.forEdge((p0, p1) => {
      const len = Point.distance(p0, p1);
      if (len > length) {
        length = len;
        v = p0;
      }
    });
    const spread = 0.8 * gridChaos;
    const ratio = (1 - spread) / 2 + Random.float() * spread;
    const angleSpread = Math.PI / 6 * gridChaos * (p.square < minSq * 4 ? 0 : 1);
    const b = (Random.float() - 0.5) * angleSpread;
    const halves = Cutter.bisect(p, v, ratio, b, split ? alley : 0);
    if (halves.length < 2 || depth > 24) {
      return Random.bool(emptyProb) ? [] : [p];
    }
    let buildings = [];
    for (const half of halves) {
      if (half.square < minSq * Math.pow(2, 4 * sizeChaos * (Random.float() - 0.5))) {
        if (!Random.bool(emptyProb)) buildings.push(half);
      } else {
        buildings = buildings.concat(
          createAlleys(half, minSq, gridChaos, sizeChaos, emptyProb, half.square > minSq / (Random.float() * Random.float()), alley, depth + 1)
        );
      }
    }
    return buildings;
  }
  function findLongestEdge(poly) {
    return amin(poly, (v) => -poly.vector(v).length);
  }
  function createOrthoBuilding(poly, minBlockSq, fill) {
    function slice(p, c12, c22, depth) {
      const v0 = findLongestEdge(p);
      const v1 = p.next(v0);
      const v = v1.subtract(v0);
      const ratio = 0.4 + Random.float() * 0.2;
      const p1 = GeomUtils.interpolate(v0, v1, ratio);
      const c = Math.abs(GeomUtils.scalar(v.x, v.y, c12.x, c12.y)) < Math.abs(GeomUtils.scalar(v.x, v.y, c22.x, c22.y)) ? c12 : c22;
      const halves = p.cut(p1, p1.add(c));
      if (halves.length < 2 || depth > 24) return Random.bool(fill) ? [p] : [];
      let buildings = [];
      for (const half of halves) {
        if (half.square < minBlockSq * Math.pow(2, Random.normal() * 2 - 1)) {
          if (Random.bool(fill)) buildings.push(half);
        } else {
          buildings = buildings.concat(slice(half, c12, c22, depth + 1));
        }
      }
      return buildings;
    }
    if (!poly || poly.length < 3) return [];
    if (poly.square < minBlockSq) return [poly];
    const c1 = poly.vector(findLongestEdge(poly));
    const c2 = c1.rotate90();
    for (let attempt = 0; attempt < 40; attempt++) {
      const blocks = slice(poly, c1, c2, 0);
      if (blocks.length > 0) return blocks;
    }
    return [poly];
  }
  function classifyGardenLots(lots) {
    if (!lots || lots.length < 6 || !Random.bool(0.55)) return lots;
    const touches = (a, b) => {
      for (let i = 0; i < a.length; i++) {
        const a0 = a[i];
        const a1 = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
          const b0 = b[j];
          const b1 = b[(j + 1) % b.length];
          if (Point.distance(a0, b1) < 1e-5 && Point.distance(a1, b0) < 1e-5 || Point.distance(a0, b0) < 1e-5 && Point.distance(a1, b1) < 1e-5) return true;
        }
      }
      return false;
    };
    const garden = /* @__PURE__ */ new Set();
    const target = Math.max(1, Math.min(4, Math.round(lots.length * (0.05 + Random.float() * 0.04))));
    const order = lots.map((_, i) => i).sort(() => Random.float() - 0.5);
    for (const i of order) {
      if (garden.size >= target) break;
      let adjacentGarden = false;
      for (const g2 of garden) {
        if (touches(lots[i], lots[g2])) {
          adjacentGarden = true;
          break;
        }
      }
      if (!adjacentGarden) garden.add(i);
    }
    for (const i of garden) lots[i].class = "garden";
    return lots;
  }
  function createCommonWardGeometry(model, patch, widths) {
    const block = patch.block;
    if (!block || block.length < 3) return [];
    const angleOf = (poly, i) => {
      const a = poly[(i + poly.length - 1) % poly.length];
      const b = poly[i];
      const c = poly[(i + 1) % poly.length];
      const u = a.subtract(b);
      const v = c.subtract(b);
      if (u.length < 1e-6 || v.length < 1e-6) return 0;
      return Math.acos(Math.max(-1, Math.min(1, u.dot(v) / (u.length * v.length))));
    };
    const minPolyAngle = (poly) => {
      let min = Infinity;
      for (let i = 0; i < poly.length; i++) min = Math.min(min, angleOf(poly, i));
      return min;
    };
    const roundedAcuteCorners = (poly, minAngle2, depth = 0) => {
      if (!poly || poly.length < 3 || depth > 12) return poly;
      let worst = -1;
      let worstAngle = minAngle2;
      for (let i = 0; i < poly.length; i++) {
        const a2 = angleOf(poly, i);
        if (a2 < worstAngle) {
          worstAngle = a2;
          worst = i;
        }
      }
      if (worst === -1) return poly;
      const prev = poly[(worst + poly.length - 1) % poly.length];
      const corner = poly[worst];
      const next = poly[(worst + 1) % poly.length];
      const prevLen = Point.distance(corner, prev);
      const nextLen = Point.distance(corner, next);
      if (prevLen < 1e-6 || nextLen < 1e-6) return poly;
      const reach = Math.min(prevLen, nextLen) * 0.22;
      if (!(reach > 1e-6)) return poly;
      const a = corner.add(prev.subtract(corner).norm(reach));
      const b = corner.add(next.subtract(corner).norm(reach));
      const out = new Polygon();
      for (let i = 0; i < poly.length; i++) {
        if (i === worst) {
          out.push(a);
          out.push(b);
        } else {
          out.push(poly[i]);
        }
      }
      if (out.length < 3 || Math.abs(out.square) < Math.abs(poly.square) * 0.5) return poly;
      recordRemovedTriangle(corner, a, b);
      return roundedAcuteCorners(out, minAngle2, depth + 1);
    };
    const axis = principalAxis(block);
    const radial = block.centroid.subtract(model.center || block.center);
    if (radial.length > 1e-6 && Math.abs(axis.dot(radial.norm(1))) > 0.92) {
      axis.set(new Point(-axis.y, axis.x));
    }
    if (Random.bool(0.35)) axis.set(new Point(-axis.y, axis.x));
    const area = Math.abs(block.square);
    const scale = Math.sqrt(area);
    const dense = patch.type === "gate" || Point.distance(block.centroid, model.center || block.center) < (model.cityRadius || scale) * 0.55;
    const params = {
      minSq: dense ? 70 : 95,
      blockSize: dense ? 10 : 14,
      gridChaos: 0.45 + Random.float() * 0.25,
      sizeChaos: 0.35,
      gap: widths.alley || 0.8,
      emptyProb: 0,
      primaryDir: axis,
      directionJitter: 0.28 + Random.float() * 0.18,
      elbowAngleMin: Math.PI / 9,
      elbowAngleMax: Math.PI / 2,
      schedule: ["elbow", "straight", "elbow"],
      maxFailedInRow: 3,
      attempts: 18,
      minLotArea: Math.max(45, widths.main * widths.main * 12),
      minLotAngle: Math.PI / 4
    };
    const preparedBlock = roundedAcuteCorners(block, params.minLotAngle);
    if (area < params.minSq * 2.5 || scale < widths.main * 5) return [preparedBlock];
    const { lots, alleys } = sliceWardEdgeElbows(preparedBlock, params);
    patch.alleys = alleys || [];
    let geometry = (lots && lots.length > 0 ? lots : [preparedBlock]).map((lot) => roundedAcuteCorners(lot, params.minLotAngle));
    geometry = geometry.filter((lot) => lot && lot.length >= 3);
    return classifyGardenLots(geometry);
  }
  function principalAxis(points) {
    let cx = 0;
    let cy = 0;
    for (const p of points) {
      cx += p.x;
      cy += p.y;
    }
    cx /= points.length;
    cy /= points.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const tr = (sxx + syy) / 2;
    const det = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
    const l1 = tr + det;
    let ax;
    let ay;
    if (Math.abs(sxy) > 1e-9) {
      ax = l1 - syy;
      ay = sxy;
    } else if (sxx >= syy) {
      ax = 1;
      ay = 0;
    } else {
      ax = 0;
      ay = 1;
    }
    const len = Math.hypot(ax, ay) || 1;
    return new Point(ax / len, ay / len);
  }
  function buildWardGeometry(model, patch, widths) {
    if (patch.isWater) return [];
    const block = patch.block;
    switch (patch.type) {
      case "plaza":
      case "market":
        return [];
      // open square
      case "cathedral":
        if (!block || block.length < 3) return [];
        return Random.bool(0.4) ? Cutter.ring(block, 2 + Random.float() * 4) : createOrthoBuilding(block, 50, 0.8);
      case "castle": {
        const b = patch.shape.shrinkEq(widths.main * 2);
        if (!b || b.length < 3) return [];
        return createOrthoBuilding(b, Math.sqrt(Math.abs(b.square)) * 4, 0.6);
      }
      case "park":
        if (!block || block.length < 3) return [];
        return block.compactness >= 0.7 ? Cutter.radial(block, null, widths.alley) : Cutter.semiRadial(block, null, widths.alley);
      case "farm":
        if (!block || block.length < 3) return [];
        return createAlleys(block, 60 + 40 * Random.float(), 0.3, 0.5, 0, true, widths.alley);
      default: {
        if (patch.type !== "generic" && patch.type !== "gate" && patch.type !== "farm") return [];
        return createCommonWardGeometry(model, patch, widths);
      }
    }
  }

  // src/core/Model.js
  var N = 2147483647;
  var DEFAULT_FEATURES = { walls: true, plaza: true, citadel: true, cathedral: true, extraSquares: 2 };
  var DEFAULT_WIDTHS = { main: 2, regular: 1, alley: 0.8 };
  var DEFAULT_WATER = {
    enabled: true,
    sea: { angle: null, distance: 1.1, waviness: 0.18, waveLength: 0.9 },
    river: { enabled: true, width: 0.16, amplitude: 0.5, frequency: 2.5, startDistance: 2.6, offset: 0.6 }
  };
  var DEFAULT_MESH = { enabled: false, iterations: 3, strength: 0.5, subdivide: 2 };
  function generateCity(params = {}) {
    let seed2 = params.seed;
    if (!(seed2 > 0)) seed2 = Math.trunc(Date.now() % N) || 1;
    const pw = params.water;
    const water = pw === false ? { enabled: false } : {
      enabled: pw && pw.enabled === false ? false : true,
      sea: pw && pw.sea === false ? false : { ...DEFAULT_WATER.sea, ...pw && pw.sea || {} },
      river: { ...DEFAULT_WATER.river, ...pw && pw.river || {} }
    };
    const meshSmoothing = params.meshSmoothing === false ? { enabled: false } : { ...DEFAULT_MESH, ...params.meshSmoothing || {} };
    const cfg = {
      seed: seed2,
      nPatches: params.nPatches != null ? params.nPatches : 15,
      features: { ...DEFAULT_FEATURES, ...params.features || {} },
      streetWidths: { ...DEFAULT_WIDTHS, ...params.streetWidths || {} },
      water,
      meshSmoothing
    };
    Random.reset(cfg.seed);
    const model = new Model(cfg);
    let attempts = 0;
    for (; ; ) {
      try {
        model.build();
        break;
      } catch (e) {
        if (++attempts > 100) throw new Error("City generation failed after 100 attempts: " + e.message);
      }
    }
    return model.toData();
  }
  var Model = class {
    constructor(cfg) {
      this.cfg = cfg;
      this.nPatches = cfg.nPatches;
      this.plazaNeeded = !!cfg.features.plaza;
      this.citadelNeeded = !!cfg.features.citadel;
      this.wallsNeeded = !!cfg.features.walls;
    }
    build() {
      this.patches = [];
      this.inner = [];
      this.districts = [];
      this.buildings = [];
      this.water = null;
      this.riverEdges = /* @__PURE__ */ new Map();
      this.riverWidth = 0;
      this.plaza = null;
      this.citadel = null;
      this.border = null;
      this.wall = null;
      this.citadelWall = null;
      this.center = null;
      this.gates = [];
      this.streets = [];
      this.roads = [];
      this.arteries = [];
      this.cityRadius = 0;
      this.buildPatches();
      this.optimizeJunctions();
      this.smoothMesh();
      this.buildRiver();
      this.buildWalls();
      this.buildStreets();
      this.assignWards();
      this.buildBlocks();
      this.buildGeometry();
    }
    // --- step 1+2: spiral seeds -> Voronoi -> relax -> patches ---
    buildPatches() {
      const n2 = this.nPatches;
      const sa = Random.float() * 2 * Math.PI;
      const points = [new Point(0, 0)];
      let b = 0;
      for (let k = 1; k < n2 * 8; k++) {
        const r = 10 + k * (2 + Random.float());
        const a = sa + 5 * Math.sqrt(k);
        points.push(new Point(Math.cos(a) * r, Math.sin(a) * r));
        if (r > b) b = r;
      }
      const radii = points.map((p) => p.length).sort((x, y) => x - y);
      this.Rc = radii[Math.min(n2, radii.length - 1)] || 1;
      const frame = [];
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * 2 * Math.PI;
        frame.push(new Point(Math.cos(a) * 2 * b, Math.sin(a) * 2 * b));
      }
      const voronoi = Voronoi.build(points.concat(frame));
      const regions = voronoi.partioning();
      for (const r of regions) {
        const patch = Patch.fromRegion(r);
        patch.seed = r.seed;
        this.patches.push(patch);
      }
      this.patches = this.patches.filter((p) => {
        for (const v of p.shape) if (v.length > b) return false;
        return true;
      });
      this.patches.sort((p1, p2) => {
        const a = p1.shape.centroid;
        const c = p2.shape.centroid;
        return a.x * a.x + a.y * a.y - (c.x * c.x + c.y * c.y);
      });
      const waterEnabled = this.cfg.water && this.cfg.water.enabled !== false;
      const ocean = waterEnabled ? markOcean(this, this.cfg.water, this.Rc) : { sea: null, oceanCells: [], coastDir: null };
      let cityCount = 0;
      for (const patch of this.patches) {
        if (patch.isWater) continue;
        if (cityCount === 0) {
          this.center = amin(patch.shape, (v) => v.length);
          if (this.plazaNeeded) this.plaza = patch;
        } else if (cityCount === n2 && this.citadelNeeded) {
          this.citadel = patch;
          this.citadel.withinCity = true;
        }
        if (cityCount < n2) {
          patch.withinCity = true;
          patch.withinWalls = this.wallsNeeded;
          this.inner.push(patch);
        }
        cityCount++;
      }
      if (this.center == null) throw new Error("No land patches generated");
      this.coastDir = ocean.coastDir;
      this.water = waterEnabled ? { sea: ocean.sea, oceanCells: ocean.oceanCells, river: null, riverPath: null } : null;
    }
    // River along (now-curved) cell edges, through the centre. Run after smoothMesh.
    buildRiver() {
      const waterEnabled = this.cfg.water && this.cfg.water.enabled !== false;
      const river = waterEnabled && this.cfg.water.river && this.cfg.water.river.enabled !== false ? buildRiverGeometry(this, this.cfg.water.river, this.Rc, this.coastDir) : { river: null, riverPath: null, riverEdges: /* @__PURE__ */ new Map(), riverWidth: 0 };
      this.riverEdges = river.riverEdges;
      this.riverWidth = river.riverWidth;
      if (this.water) {
        this.water.river = river.river;
        this.water.riverPath = river.riverPath;
      }
    }
    patchByVertex(v) {
      return this.patches.filter((p) => p.shape.contains(v));
    }
    getNeighbours(patch) {
      return this.patches.filter((p) => p !== patch && p.shape.borders(patch.shape));
    }
    getNeighbour(patch, v) {
      const next = patch.shape.next(v);
      return this.patches.find((p) => p !== patch && p.shape.findEdge(next, v) !== -1) || null;
    }
    isEnclosed(patch) {
      return patch.withinCity && (patch.withinWalls || this.getNeighbours(patch).every((p) => p.withinCity));
    }
    // Vertices shared between a water cell and a land cell = the coastline. Excluded from the
    // road graph so streets/roads never touch the shore.
    _computeShoreVertices() {
      const inWater = /* @__PURE__ */ new Set();
      const inLand = /* @__PURE__ */ new Set();
      for (const p of this.patches) for (const v of p.shape) (p.isWater ? inWater : inLand).add(v);
      const shore = /* @__PURE__ */ new Set();
      for (const v of inWater) if (inLand.has(v)) shore.add(v);
      return shore;
    }
    // Outer-boundary vertices on the LAND side (boundary edges with no land cell across them,
    // excluding coast vertices) — the countryside "exits" roads head toward.
    _landHorizonExits() {
      const dir = /* @__PURE__ */ new Map();
      for (const p of this.patches) {
        if (p.isWater) continue;
        const s = p.shape;
        for (let i = 0; i < s.length; i++) {
          const a = s[i];
          if (!dir.has(a)) dir.set(a, /* @__PURE__ */ new Set());
          dir.get(a).add(s[(i + 1) % s.length]);
        }
      }
      const exits = /* @__PURE__ */ new Set();
      for (const p of this.patches) {
        if (p.isWater) continue;
        const s = p.shape;
        for (let i = 0; i < s.length; i++) {
          const a = s[i];
          const b = s[(i + 1) % s.length];
          const twinLand = dir.get(b) && dir.get(b).has(a);
          if (!twinLand) {
            if (!this.shoreVertices.has(a)) exits.add(a);
            if (!this.shoreVertices.has(b)) exits.add(b);
          }
        }
      }
      return [...exits];
    }
    // Curve the ward edges: subdivide every shared cell edge, then Laplacian-smooth the shared
    // vertices. Because adjacent cells share the SAME inserted points (by identity), the mesh
    // stays watertight and wards/roads/river/walls/blocks (all built afterwards) bend together.
    // Coast (ocean) vertices are pinned so the shoreline stays cell-aligned and crisp.
    smoothMesh() {
      const cfg = this.cfg.meshSmoothing;
      if (!cfg || cfg.enabled === false) return;
      const subdivide = cfg.subdivide != null ? cfg.subdivide : 2;
      const iterations = cfg.iterations != null ? cfg.iterations : 3;
      const strength = cfg.strength != null ? cfg.strength : 0.5;
      if (subdivide > 1) this._subdivideEdges(subdivide);
      if (iterations > 0) this._laplacian(iterations, strength);
    }
    // Insert (k-1) shared points along every cell edge. Shared edges reuse the same point
    // instances (keyed by an unordered vertex-id pair), so the two cells stay stitched together.
    _subdivideEdges(k) {
      let counter = 0;
      const ids = /* @__PURE__ */ new Map();
      const idOf = (p) => {
        let i = ids.get(p);
        if (i == null) ids.set(p, i = counter++);
        return i;
      };
      const interiorByEdge = /* @__PURE__ */ new Map();
      const getInterior = (a, b) => {
        const ia = idOf(a);
        const ib = idOf(b);
        const key = ia < ib ? ia + "_" + ib : ib + "_" + ia;
        let arr = interiorByEdge.get(key);
        if (!arr) {
          const lo = ia < ib ? a : b;
          const hi = ia < ib ? b : a;
          arr = [];
          for (let j = 1; j < k; j++) {
            const t = j / k;
            arr.push(new Point(lo.x + (hi.x - lo.x) * t, lo.y + (hi.y - lo.y) * t));
          }
          interiorByEdge.set(key, arr);
        }
        return ia < ib ? arr : arr.slice().reverse();
      };
      for (const p of this.patches) {
        const s = p.shape;
        const out = [];
        for (let i = 0; i < s.length; i++) {
          const a = s[i];
          const b = s[(i + 1) % s.length];
          out.push(a);
          for (const m of getInterior(a, b)) out.push(m);
        }
        p.shape = new Polygon(out);
      }
    }
    _laplacian(iterations, strength) {
      const neighbours = /* @__PURE__ */ new Map();
      const pinned = /* @__PURE__ */ new Set();
      for (const p of this.patches) {
        const s = p.shape;
        for (let i = 0; i < s.length; i++) {
          const a = s[i];
          const b = s[(i + 1) % s.length];
          if (!neighbours.has(a)) neighbours.set(a, /* @__PURE__ */ new Set());
          if (!neighbours.has(b)) neighbours.set(b, /* @__PURE__ */ new Set());
          neighbours.get(a).add(b);
          neighbours.get(b).add(a);
          if (p.isWater) {
            pinned.add(a);
            pinned.add(b);
          }
        }
      }
      for (let it = 0; it < iterations; it++) {
        const nx = /* @__PURE__ */ new Map();
        const ny = /* @__PURE__ */ new Map();
        for (const [v, nb] of neighbours) {
          if (pinned.has(v) || nb.size === 0) continue;
          let sx = 0;
          let sy = 0;
          for (const u of nb) {
            sx += u.x;
            sy += u.y;
          }
          nx.set(v, v.x + (sx / nb.size - v.x) * strength);
          ny.set(v, v.y + (sy / nb.size - v.y) * strength);
        }
        for (const [v, x] of nx) {
          v.x = x;
          v.y = ny.get(v);
        }
      }
    }
    // --- step 3: merge junction vertices closer than 8, then dedup ---
    optimizeJunctions() {
      const patchesToOptimize = this.citadel == null ? this.inner : this.inner.concat([this.citadel]);
      const wards2clean = [];
      for (const w of patchesToOptimize) {
        let index = 0;
        while (index < w.shape.length) {
          const v0 = w.shape[index];
          const v1 = w.shape[(index + 1) % w.shape.length];
          if (v0 !== v1 && Point.distance(v0, v1) < 8) {
            for (const w1 of this.patchByVertex(v1))
              if (w1 !== w) {
                w1.shape[w1.shape.indexOf(v1)] = v0;
                wards2clean.push(w1);
              }
            v0.addEq(v1);
            v0.scaleEq(0.5);
            w.shape.remove(v1);
          }
          index++;
        }
      }
      for (const w of wards2clean) {
        const len = w.shape.length;
        for (let i = 0; i < len; i++) {
          const v = w.shape[i];
          let dupIdx;
          while ((dupIdx = w.shape.indexOf(v, i + 1)) !== -1) w.shape.splice(dupIdx, 1);
        }
      }
    }
    // --- walls + gates (border always; castle wall if citadel) ---
    buildWalls() {
      const reserved = this.citadel != null ? this.citadel.shape.slice() : [];
      this.border = new CurtainWall(this.wallsNeeded, this, this.inner, reserved);
      if (this.wallsNeeded) {
        this.wall = this.border;
        this.wall.buildTowers();
        this.wall.suppressWaterSegments(this);
        this.wall.buildTowers();
      }
      this.gates = this.border.gates;
      if (this.citadel != null) {
        const reservedCastle = this.citadel.shape.filter((v) => this.patchByVertex(v).some((p) => !p.withinCity));
        this.citadelWall = new CurtainWall(true, this, [this.citadel], reservedCastle);
        this.citadelWall.suppressWaterSegments(this);
        this.citadelWall.buildTowers();
        this.citadel.type = "castle";
        if (this.citadel.shape.compactness < 0.75) throw new Error("Bad citadel shape!");
        this.gates = this.gates.concat(this.citadelWall.gates);
      }
    }
    // --- step 4: A* streets (gate -> center/plaza) and roads (outside -> gate) ---
    buildStreets() {
      this.shoreVertices = this._computeShoreVertices();
      this.topology = new Topology(this);
      const exits = this._landHorizonExits();
      for (const gate of this.gates) {
        const end = this.plaza != null ? amin(this.plaza.shape, (v) => Point.distance(v, gate)) : this.center;
        const street = this.topology.buildPath(gate, end, this.topology.outer);
        if (street != null) {
          this.streets.push(street);
          if (this.border.gates.indexOf(gate) !== -1 && exits.length > 0) {
            const gx = gate.x;
            const gy = gate.y;
            const sorted = exits.slice().sort((a, c) => (c.x * gx + c.y * gy) / (c.length || 1) - (a.x * gx + a.y * gy) / (a.length || 1));
            let road = null;
            for (const ex of sorted) {
              road = this.topology.buildPath(ex, gate, this.topology.inner);
              if (road != null) break;
            }
            if (road != null) this.roads.push(road);
          }
        } else {
          throw new Error("Unable to build a street!");
        }
      }
      this.tidyUpRoads();
    }
    tidyUpRoads() {
      const segments = [];
      const cut2segments = (street) => {
        let v1 = street[0];
        for (let i = 1; i < street.length; i++) {
          const v0 = v1;
          v1 = street[i];
          if (this.plaza != null && this.plaza.shape.contains(v0) && this.plaza.shape.contains(v1)) continue;
          let exists = false;
          for (const seg of segments)
            if (seg.start === v0 && seg.end === v1) {
              exists = true;
              break;
            }
          if (!exists) segments.push({ start: v0, end: v1 });
        }
      };
      for (const street of this.streets) cut2segments(street);
      for (const road of this.roads) cut2segments(road);
      this.arteries = [];
      while (segments.length > 0) {
        const seg = segments.pop();
        let attached = false;
        for (const a of this.arteries) {
          if (a[0] === seg.end) {
            a.unshift(seg.start);
            attached = true;
            break;
          } else if (a[a.length - 1] === seg.start) {
            a.push(seg.end);
            attached = true;
            break;
          }
        }
        if (!attached) this.arteries.push(new Polygon([seg.start, seg.end]));
      }
    }
    // --- simplified ward labeling (no building interiors) ---
    assignWards() {
      if (this.plaza != null) this.plaza.type = "plaza";
      const unassigned = this.inner.filter((p) => p !== this.plaza);
      if (this.cfg.features.cathedral && unassigned.length > 0) {
        const pick = amin(unassigned, (p) => cathedralRate(this, p));
        pick.type = "cathedral";
        remove(unassigned, pick);
      }
      let squares = this.cfg.features.extraSquares | 0;
      while (squares-- > 0 && unassigned.length > 0) {
        const pick = amin(unassigned, (p) => marketRate(this, p));
        pick.type = "market";
        remove(unassigned, pick);
      }
      for (const gate of this.border.gates)
        for (const patch of this.patchByVertex(gate))
          if (patch.withinCity && patch.type == null) patch.type = "gate";
      for (const p of unassigned) if (p.type == null) p.type = "generic";
      this.cityRadius = 0;
      for (const patch of this.patches) {
        if (patch.withinCity) {
          for (const v of patch.shape) this.cityRadius = Math.max(this.cityRadius, v.length);
        } else if (patch.type == null) {
          patch.type = Random.bool(0.2) && patch.shape.compactness >= 0.7 ? "farm" : "generic";
        }
      }
      for (const patch of this.patches) if (patch.type == null) patch.type = "generic";
    }
    // --- step 5: shrink each patch into a block, leaving room for roads ---
    buildBlocks() {
      clearFeatures();
      for (const patch of this.patches) {
        if (OPEN_TYPES.has(patch.type)) {
          patch.block = null;
          continue;
        }
        try {
          patch.block = getCityBlock(this, patch, this.cfg.streetWidths);
        } catch (e) {
          patch.block = null;
        }
      }
    }
    // Fill wards with building lots. Generic/gate wards use the reference CommonWard alley
    // subdivision per patch; special wards keep their own geometry.
    buildGeometry() {
      const widths = this.cfg.streetWidths;
      this.buildings = [];
      for (const patch of this.patches) {
        if (patch.isWater) continue;
        try {
          for (const b of buildWardGeometry(this, patch, widths)) this.buildings.push(b);
        } catch (e) {
        }
      }
      this.features = takeFeatures();
    }
    toData() {
      const pt = (p) => ({ x: p.x, y: p.y });
      const poly = (pl) => Array.from(pl, pt);
      const building = (pl) => ({
        polygon: poly(pl),
        class: pl.class || "building"
      });
      const patches = this.patches.map((p, idx) => ({
        id: idx,
        polygon: poly(p.shape),
        block: p.block ? poly(p.block) : null,
        type: p.type || "generic",
        isWater: !!p.isWater,
        withinCity: p.withinCity,
        withinWalls: p.withinWalls
      }));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of this.patches) {
        if (p.isWater) continue;
        for (const v of p.shape) {
          if (v.x < minX) minX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.x > maxX) maxX = v.x;
          if (v.y > maxY) maxY = v.y;
        }
      }
      const serializeWall = (w, isCastle) => ({
        shape: poly(w.shape),
        gates: w.gates.map(pt),
        towers: w.towers.map(pt),
        isCastle,
        segments: w.segments ? w.segments.slice() : null
      });
      const walls = [];
      if (this.wall != null) walls.push(serializeWall(this.wall, false));
      if (this.citadelWall != null) walls.push(serializeWall(this.citadelWall, true));
      const water = this.water ? {
        sea: this.water.sea ? poly(this.water.sea) : null,
        oceanCells: this.water.oceanCells.map((p) => poly(p.shape)),
        river: this.water.river ? poly(this.water.river) : null,
        riverPath: this.water.riverPath ? poly(this.water.riverPath) : null,
        riverWidth: this.riverWidth
      } : null;
      return {
        seed: this.cfg.seed,
        nPatches: this.nPatches,
        center: pt(this.center),
        cityRadius: this.cityRadius,
        bounds: { minX, minY, maxX, maxY },
        patches,
        buildings: this.buildings.map(building),
        features: (this.features || []).map((f) => ({ x: f.x, y: f.y, kind: f.kind })),
        arteries: this.arteries.map(poly),
        streets: this.streets.map(poly),
        roads: this.roads.map(poly),
        walls,
        water,
        gates: this.gates.map(pt)
      };
    }
  };

  // src/render/viewport.js
  var MIN_SCALE = 0.05;
  var MAX_SCALE = 200;
  var WHEEL_ZOOM_FACTOR = 1.1;
  function attachViewport(svgEl2, groupEl2) {
    let tx = 0;
    let ty = 0;
    let scale = 1;
    const pointers = /* @__PURE__ */ new Map();
    let lastPanX = 0;
    let lastPanY = 0;
    let lastDist = 0;
    let lastMidX = 0;
    let lastMidY = 0;
    function apply() {
      groupEl2.setAttribute("transform", `translate(${tx},${ty}) scale(${scale})`);
    }
    function clampScale(s) {
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    }
    function clientToSvgPoint(clientX, clientY) {
      const rect = svgEl2.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }
    function zoomAt(svgX, svgY, factor) {
      const newScale = clampScale(scale * factor);
      const actualFactor = newScale / scale;
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
        svgEl2.setPointerCapture(ev.pointerId);
      } catch (e) {
      }
      resetGesture();
      svgEl2.style.cursor = "grabbing";
    }
    function onPointerMove(ev) {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const pts = [...pointers.values()];
      if (pts.length === 1) {
        tx += pts[0].x - lastPanX;
        ty += pts[0].y - lastPanY;
        lastPanX = pts[0].x;
        lastPanY = pts[0].y;
        apply();
      } else if (pts.length >= 2) {
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        tx += midX - lastMidX;
        ty += midY - lastMidY;
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
        svgEl2.releasePointerCapture(ev.pointerId);
      } catch (e) {
      }
      resetGesture();
      if (pointers.size === 0) svgEl2.style.cursor = "grab";
    }
    svgEl2.addEventListener("wheel", onWheel, { passive: false });
    svgEl2.addEventListener("pointerdown", onPointerDown);
    svgEl2.addEventListener("pointermove", onPointerMove);
    svgEl2.addEventListener("pointerup", onPointerUp);
    svgEl2.addEventListener("pointercancel", onPointerUp);
    svgEl2.style.cursor = "grab";
    function fit(bounds, padding = 0.08) {
      const w = svgEl2.clientWidth || 1;
      const h = svgEl2.clientHeight || 1;
      let bw = bounds.maxX - bounds.minX;
      let bh = bounds.maxY - bounds.minY;
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

  // src/render/svgRenderer.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var DEFAULT_PALETTE = {
    patchFill: {
      plaza: "#d8cfa8",
      market: "#d9b97a",
      cathedral: "#b79bbf",
      castle: "#c98a8a",
      gate: "#a9b3a0",
      generic: "#b9c2a8",
      farm: "#c4cf9a"
    },
    patchStroke: {
      plaza: "#a89c6c",
      market: "#a6843f",
      cathedral: "#8a6a93",
      castle: "#92484a",
      gate: "#74806c",
      generic: "#838f6e",
      farm: "#94a263"
    },
    blockFill: "#888888",
    building: "#6c6c6c",
    buildingStroke: "#000000",
    garden: "#a6b93c",
    gardenStroke: "#000000",
    // Alleys drawn as the block color on top of buildings -> reads as a gap, not a road.
    alley: "#c8c8c8",
    water: "#9ec6dd",
    waterStroke: "#5d829c",
    bridgeDock: "#c8a46a",
    bridgeDockOutline: "#000000",
    wall: "#888888",
    castleWall: "#888888",
    wallOutline: "#000000",
    tower: "#888888",
    gateDot: "#c0392b",
    center: "#2266cc",
    background: "#e9e4d4",
    // Orienteering landmarks dropped into chamfered corner gaps (green tree / blue fountain).
    featureTree: "#2f8f3e",
    featureFountain: "#2b7fc4",
    featureOutline: "#1c1c1c"
  };
  function ns(tag) {
    return document.createElementNS(SVG_NS, tag);
  }
  function pointsAttr(pts) {
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  }
  function makePolygon(pts, { fill, stroke, strokeWidth, nonScaling } = {}) {
    const el = ns("polygon");
    el.setAttribute("points", pointsAttr(pts));
    if (fill != null) el.setAttribute("fill", fill);
    if (stroke != null) el.setAttribute("stroke", stroke);
    if (strokeWidth != null) el.setAttribute("stroke-width", String(strokeWidth));
    if (nonScaling) el.setAttribute("vector-effect", "non-scaling-stroke");
    return el;
  }
  function norm2(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }
  function smoothPathD(pts) {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
    const extrap = (a2, b, c) => {
      const ax = b.x - a2.x;
      const ay = b.y - a2.y;
      const bx = c.x - b.x;
      const by = c.y - b.y;
      const d2 = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
      const sin = (ax * by - ay * bx) / d2;
      const cos = (ax * bx + ay * by) / d2;
      return { x: c.x + (bx * cos - by * sin), y: c.y + (by * cos + bx * sin) };
    };
    const a = [extrap(pts[2], pts[1], pts[0]), ...pts, extrap(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1])];
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let k = 1; k < a.length - 2; k++) {
      const g2 = a[k];
      const m = a[k + 1];
      const P = a[k + 2];
      const inD = norm2(g2.x - a[k - 1].x, g2.y - a[k - 1].y);
      const segD = norm2(m.x - g2.x, m.y - g2.y);
      const outD = norm2(P.x - m.x, P.y - m.y);
      const tN = norm2(inD.x + segD.x, inD.y + segD.y);
      const tP = norm2(segD.x + outD.x, segD.y + outD.y);
      const L = Math.hypot(g2.x - m.x, g2.y - m.y);
      let w = 1 / (1 + (tN.x * segD.x + tN.y * segD.y) + (tP.x * segD.x + tP.y * segD.y));
      if (!isFinite(w) || w < 0) w = 1 / 3;
      const q = L * Math.min(w, 1);
      d += ` C ${g2.x + tN.x * q},${g2.y + tN.y * q} ${m.x - tP.x * q},${m.y - tP.y * q} ${m.x},${m.y}`;
    }
    return d;
  }
  function makeSmoothPath(pts, { stroke, strokeWidth, opacity, linecap = "round" } = {}) {
    const el = ns("path");
    el.setAttribute("d", smoothPathD(pts));
    el.setAttribute("fill", "none");
    if (stroke != null) el.setAttribute("stroke", stroke);
    if (strokeWidth != null) el.setAttribute("stroke-width", String(strokeWidth));
    el.setAttribute("stroke-linecap", linecap);
    el.setAttribute("stroke-linejoin", "round");
    if (opacity != null) el.setAttribute("opacity", String(opacity));
    return el;
  }
  function adjustedTowerPos(wall, tower, riverWidth, riverNodes, towerR) {
    const n2 = wall.shape.length;
    const segs = wall.segments;
    if (!segs) return tower;
    const idx = wall.shape.findIndex((v) => Math.abs(v.x - tower.x) < 1e-6 && Math.abs(v.y - tower.y) < 1e-6);
    if (idx === -1) return tower;
    const prevActive = segs[(idx + n2 - 1) % n2] !== false;
    const nextActive = segs[idx] !== false;
    const isRiverNode = riverNodes && riverNodes.has(`${tower.x},${tower.y}`);
    if (prevActive && nextActive && !isRiverNode) return tower;
    let dx = 0;
    let dy = 0;
    if (nextActive && !prevActive) {
      const next = wall.shape[(idx + 1) % n2];
      dx = next.x - tower.x;
      dy = next.y - tower.y;
    } else if (prevActive && !nextActive) {
      const prev = wall.shape[(idx + n2 - 1) % n2];
      dx = prev.x - tower.x;
      dy = prev.y - tower.y;
    } else if (isRiverNode) {
      const prev = wall.shape[(idx + n2 - 1) % n2];
      const next = wall.shape[(idx + 1) % n2];
      const pLen = Math.hypot(prev.x - tower.x, prev.y - tower.y);
      const nLen = Math.hypot(next.x - tower.x, next.y - tower.y);
      if (nLen >= pLen) {
        dx = next.x - tower.x;
        dy = next.y - tower.y;
      } else {
        dx = prev.x - tower.x;
        dy = prev.y - tower.y;
      }
    } else {
      return tower;
    }
    const len = Math.hypot(dx, dy) || 1;
    const halfRiver = (riverWidth || 0) / 2;
    const offset = halfRiver + towerR;
    return { x: tower.x + dx / len * offset, y: tower.y + dy / len * offset };
  }
  function wallSegmentsPath(wall, riverWidth, riverNodes) {
    const shape = wall.shape;
    const segs = wall.segments;
    const n2 = shape.length;
    if (!segs || segs.length < n2) return null;
    const halfRiver = (riverWidth || 0) / 2;
    let d = "";
    for (let i = 0; i < n2; i++) {
      if (!segs[i]) continue;
      const a = shape[i];
      const b = shape[(i + 1) % n2];
      let ax = a.x;
      let ay = a.y;
      let bx = b.x;
      let by = b.y;
      if (halfRiver > 0) {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        if (!segs[(i + n2 - 1) % n2] || riverNodes && riverNodes.has(`${a.x},${a.y}`)) {
          ax += dx / len * halfRiver;
          ay += dy / len * halfRiver;
        }
        if (!segs[(i + 1) % n2] || riverNodes && riverNodes.has(`${b.x},${b.y}`)) {
          bx -= dx / len * halfRiver;
          by -= dy / len * halfRiver;
        }
      }
      d += `M${ax},${ay} L${bx},${by} `;
    }
    return d || null;
  }
  function makePath(d, { stroke, strokeWidth, linecap = "butt", linejoin = "round" } = {}) {
    const el = ns("path");
    el.setAttribute("d", d);
    el.setAttribute("fill", "none");
    if (stroke != null) el.setAttribute("stroke", stroke);
    if (strokeWidth != null) el.setAttribute("stroke-width", String(strokeWidth));
    el.setAttribute("stroke-linecap", linecap);
    el.setAttribute("stroke-linejoin", linejoin);
    return el;
  }
  function makeCircle(p, r, { fill, stroke, strokeWidth, nonScaling } = {}) {
    const el = ns("circle");
    el.setAttribute("cx", String(p.x));
    el.setAttribute("cy", String(p.y));
    el.setAttribute("r", String(r));
    if (fill != null) el.setAttribute("fill", fill);
    if (stroke != null) el.setAttribute("stroke", stroke);
    if (strokeWidth != null) el.setAttribute("stroke-width", String(strokeWidth));
    if (nonScaling) el.setAttribute("vector-effect", "non-scaling-stroke");
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
        { x: gate.x - tx * h + nx * h, y: gate.y - ty * h + ny * h }
      ],
      { fill, stroke, strokeWidth }
    );
  }
  function renderCity(groupEl2, cityData, options = {}) {
    const palette = options.palette || DEFAULT_PALETTE;
    const showMarkers = !!options.showMarkers;
    const widths = options.streetWidths || cityData && cityData.streetWidths || { main: 2, regular: 1, alley: 0.8 };
    while (groupEl2.firstChild) groupEl2.removeChild(groupEl2.firstChild);
    const layerOcean = ns("g");
    layerOcean.setAttribute("id", "layer-ocean");
    const layerPatches = ns("g");
    layerPatches.setAttribute("id", "layer-patches");
    const layerBlocks = ns("g");
    layerBlocks.setAttribute("id", "layer-blocks");
    const layerBuildings = ns("g");
    layerBuildings.setAttribute("id", "layer-buildings");
    const layerAlleys = ns("g");
    layerAlleys.setAttribute("id", "layer-alleys");
    const layerRiver = ns("g");
    layerRiver.setAttribute("id", "layer-river");
    const layerArteries = ns("g");
    layerArteries.setAttribute("id", "layer-arteries");
    const layerWalls = ns("g");
    layerWalls.setAttribute("id", "layer-walls");
    const layerMarkers = ns("g");
    layerMarkers.setAttribute("id", "layer-markers");
    groupEl2.appendChild(layerOcean);
    groupEl2.appendChild(layerPatches);
    groupEl2.appendChild(layerBlocks);
    groupEl2.appendChild(layerBuildings);
    groupEl2.appendChild(layerAlleys);
    groupEl2.appendChild(layerRiver);
    groupEl2.appendChild(layerArteries);
    groupEl2.appendChild(layerWalls);
    groupEl2.appendChild(layerMarkers);
    if (cityData.water) {
      const w = cityData.water;
      if (w.sea && w.sea.length >= 3) layerOcean.appendChild(makePolygon(w.sea, { fill: palette.water }));
      for (const cell of w.oceanCells || []) {
        if (cell && cell.length >= 3) layerOcean.appendChild(makePolygon(cell, { fill: palette.water }));
      }
    }
    for (const patch of cityData.patches || []) {
      if (patch.isWater) continue;
      if (!patch.polygon || patch.polygon.length < 3) continue;
      const fill = palette.patchFill[patch.type] || palette.patchFill.generic;
      const el = makePolygon(patch.polygon, { fill, stroke: "none" });
      el.setAttribute("fill-opacity", "0.4");
      layerPatches.appendChild(el);
    }
    const zones = [];
    for (const block of cityData.blocks || []) if (block && block.length >= 3) zones.push(block);
    for (const patch of cityData.patches || []) if (patch.block && patch.block.length >= 3) zones.push(patch.block);
    for (const zone of zones) layerBlocks.appendChild(makePolygon(zone, { fill: palette.blockFill, stroke: "none" }));
    for (const b of cityData.buildings || []) {
      const polygon = Array.isArray(b) ? b : b.polygon;
      if (!polygon || polygon.length < 3) continue;
      const isGarden = !Array.isArray(b) && b.class === "garden";
      layerBuildings.appendChild(makePolygon(polygon, {
        fill: isGarden ? palette.garden : palette.building,
        stroke: isGarden ? palette.gardenStroke : palette.buildingStroke,
        strokeWidth: 0.18
      }));
    }
    if (cityData.water && cityData.water.riverPath && cityData.water.riverPath.length >= 2) {
      const w = cityData.water.riverWidth || 1;
      layerRiver.appendChild(makeSmoothPath(cityData.water.riverPath, { stroke: palette.waterStroke, strokeWidth: w * 1.18, linecap: "butt" }));
      layerRiver.appendChild(makeSmoothPath(cityData.water.riverPath, { stroke: palette.water, strokeWidth: w, linecap: "butt" }));
    }
    if (cityData.river && cityData.river.bridges) {
      const riverWidth2 = Number.isFinite(cityData.river.width) ? cityData.river.width : 5;
      const halfSpan = riverWidth2 * 0.6;
      for (const bridge of cityData.river.bridges) {
        let d = "";
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
        layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDockOutline, strokeWidth: 1.5, linecap: "butt" }));
        layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDock, strokeWidth: 0.75, linecap: "butt" }));
      }
    }
    for (const dock of cityData.docks || []) {
      const scale = dock.large ? 2 : 1;
      for (const pier of dock.piers || []) {
        if (!pier.from || !pier.to) continue;
        const d = `M${pier.from.x},${pier.from.y} L${pier.to.x},${pier.to.y}`;
        layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDockOutline, strokeWidth: 3 * scale, linecap: "butt" }));
        layerArteries.appendChild(makePath(d, { stroke: palette.bridgeDock, strokeWidth: 1.5 * scale, linecap: "butt" }));
      }
    }
    const mainWidth = widths.main || 2;
    const riverWidth = cityData.water && cityData.water.riverWidth || 0;
    const riverNodes = /* @__PURE__ */ new Set();
    if (cityData.water && cityData.water.riverPath) {
      for (const v of cityData.water.riverPath) riverNodes.add(`${v.x},${v.y}`);
    }
    for (const wall of cityData.walls || []) {
      if (!wall.shape || wall.shape.length < 3) continue;
      const isCastle = !!wall.isCastle;
      const strokeColor = isCastle ? palette.castleWall : palette.wall;
      const strokeWidth = 0.18;
      const segPath = wallSegmentsPath(wall, riverWidth, riverNodes);
      if (segPath) {
        layerWalls.appendChild(makePath(segPath, { stroke: palette.wallOutline, strokeWidth: strokeWidth + 0.45, linecap: "round" }));
        layerWalls.appendChild(makePath(segPath, { stroke: strokeColor, strokeWidth, linecap: "round" }));
      } else {
        const outline = makePolygon(wall.shape, { fill: "none", stroke: palette.wallOutline, strokeWidth: strokeWidth + 0.45 });
        outline.setAttribute("stroke-linejoin", "round");
        layerWalls.appendChild(outline);
        const el = makePolygon(wall.shape, { fill: "none", stroke: strokeColor, strokeWidth });
        el.setAttribute("stroke-linejoin", "round");
        layerWalls.appendChild(el);
      }
      const towerR = Math.max(mainWidth * 1.5, 0.6);
      for (const t of wall.towers || []) {
        const pos = adjustedTowerPos(wall, t, riverWidth, riverNodes, towerR);
        layerWalls.appendChild(makeCircle(pos, towerR, { fill: palette.tower, stroke: palette.wallOutline, strokeWidth: 0.18 }));
      }
      for (const g2 of wall.gates || []) {
        if (riverNodes.has(`${g2.x},${g2.y}`)) continue;
        layerWalls.appendChild(makeGateSquare(g2, wall, strokeWidth, { fill: palette.gateDot, stroke: "#fff", strokeWidth: 0.2 }));
      }
    }
    for (const f of cityData.features || []) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
      layerMarkers.appendChild(makeCircle(f, 0.45, {
        fill: f.kind === "fountain" ? palette.featureFountain : palette.featureTree,
        stroke: palette.featureOutline,
        strokeWidth: 0.12
      }));
    }
    if (showMarkers) {
      if (cityData.center) {
        const c = makeCircle(cityData.center, 1.5, {
          fill: "none",
          stroke: palette.center,
          strokeWidth: 2,
          nonScaling: true
        });
        layerMarkers.appendChild(c);
        const cross = ns("path");
        const r = 6;
        cross.setAttribute(
          "d",
          `M ${cityData.center.x - r},${cityData.center.y} L ${cityData.center.x + r},${cityData.center.y} M ${cityData.center.x},${cityData.center.y - r} L ${cityData.center.x},${cityData.center.y + r}`
        );
        cross.setAttribute("stroke", palette.center);
        cross.setAttribute("stroke-width", "1");
        cross.setAttribute("vector-effect", "non-scaling-stroke");
        layerMarkers.appendChild(cross);
      }
      for (const g2 of cityData.gates || []) {
        layerMarkers.appendChild(
          makeCircle(g2, 1.2, { fill: palette.gateDot, stroke: "#fff", strokeWidth: 0.3, nonScaling: false })
        );
      }
    }
  }

  // src/main.js
  var svgEl = document.getElementById("city-svg");
  var groupEl = document.getElementById("viewport");
  var statusEl = document.getElementById("status");
  var els = {
    seed: document.getElementById("seed"),
    randomSeed: document.getElementById("random-seed"),
    nPatches: document.getElementById("nPatches"),
    nPatchesValue: document.getElementById("nPatches-value"),
    extraSquares: document.getElementById("extraSquares"),
    walls: document.getElementById("walls"),
    plaza: document.getElementById("plaza"),
    citadel: document.getElementById("citadel"),
    cathedral: document.getElementById("cathedral"),
    widthMain: document.getElementById("width-main"),
    widthRegular: document.getElementById("width-regular"),
    widthAlley: document.getElementById("width-alley"),
    waterEnabled: document.getElementById("water-enabled"),
    seaEnabled: document.getElementById("sea-enabled"),
    coastDistance: document.getElementById("coast-distance"),
    coastWaviness: document.getElementById("coast-waviness"),
    riverEnabled: document.getElementById("river-enabled"),
    riverWidth: document.getElementById("river-width"),
    riverAmplitude: document.getElementById("river-amplitude"),
    riverFrequency: document.getElementById("river-frequency"),
    curvedWards: document.getElementById("curved-wards"),
    showMarkers: document.getElementById("show-markers"),
    regenerate: document.getElementById("regenerate"),
    fitView: document.getElementById("fit-view")
  };
  var viewport = attachViewport(svgEl, groupEl);
  var lastCityData = null;
  function readParams() {
    return {
      seed: parseInt(els.seed.value, 10) || 1,
      nPatches: parseInt(els.nPatches.value, 10),
      features: {
        walls: els.walls.checked,
        plaza: els.plaza.checked,
        citadel: els.citadel.checked,
        cathedral: els.cathedral.checked,
        extraSquares: parseInt(els.extraSquares.value, 10) || 0
      },
      streetWidths: {
        main: parseFloat(els.widthMain.value) || 2,
        regular: parseFloat(els.widthRegular.value) || 1,
        alley: parseFloat(els.widthAlley.value) || 0.8
      },
      water: readWaterParams(),
      meshSmoothing: { enabled: els.curvedWards.checked }
    };
  }
  function num(el, fallback) {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : fallback;
  }
  function readWaterParams() {
    return {
      enabled: els.waterEnabled.checked,
      sea: els.seaEnabled.checked ? { distance: num(els.coastDistance, 1.1), waviness: num(els.coastWaviness, 0.18) } : false,
      river: {
        enabled: els.riverEnabled.checked,
        width: num(els.riverWidth, 0.16),
        amplitude: num(els.riverAmplitude, 0.5),
        frequency: num(els.riverFrequency, 2.5)
      }
    };
  }
  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
  }
  function randomSeed() {
    return Math.floor(Math.random() * 2147483646) + 1;
  }
  function regenerate(refit = true) {
    const params = readParams();
    try {
      const cityData = generateCity(params);
      lastCityData = cityData;
      renderCity(groupEl, cityData, {
        showMarkers: els.showMarkers.checked,
        streetWidths: params.streetWidths
      });
      if (refit) viewport.fit(cityData.bounds);
      setStatus(
        `OK \u2014 seed=${cityData.seed}  patches=${cityData.patches.length}  arteries=${cityData.arteries.length}  walls=${cityData.walls.length}  gates=${cityData.gates.length}`
      );
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e && e.message ? e.message : e}`, true);
    }
  }
  els.nPatches.addEventListener("input", () => {
    els.nPatchesValue.textContent = els.nPatches.value;
  });
  els.randomSeed.addEventListener("click", () => {
    els.seed.value = String(randomSeed());
    regenerate(true);
  });
  els.regenerate.addEventListener("click", () => regenerate(true));
  els.fitView.addEventListener("click", () => {
    if (lastCityData) viewport.fit(lastCityData.bounds);
  });
  els.showMarkers.addEventListener("change", () => {
    if (lastCityData) {
      const params = readParams();
      renderCity(groupEl, lastCityData, {
        showMarkers: els.showMarkers.checked,
        streetWidths: params.streetWidths
      });
    }
  });
  regenerate(true);
})();
