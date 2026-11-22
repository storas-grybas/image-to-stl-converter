// freeimagetostl.com relief engine.
// Pure functions, no DOM and no network: image pixels in, closed binary STL out.
// Units are millimeters, Z is up. Runs entirely in the visitor's browser.

/** Luminance of an RGBA buffer in 0..1, transparent pixels composited over white. */
export function toLuminance(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let p = 0, q = 0; p < out.length; p++, q += 4) {
    const a = rgba[q + 3] / 255;
    const r = rgba[q] * a + 255 * (1 - a);
    const g = rgba[q + 1] * a + 255 * (1 - a);
    const b = rgba[q + 2] * a + 255 * (1 - a);
    out[p] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return out;
}

/** Area-average resample of a luminance image to `cols` samples across (rows follow the aspect ratio). */
export function resample(lum, w, h, cols) {
  const nx = Math.max(2, Math.round(cols));
  const ny = Math.max(2, Math.round(nx * h / w));
  const grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y0 = Math.floor(j * h / ny), y1 = Math.max(y0 + 1, Math.floor((j + 1) * h / ny));
    for (let i = 0; i < nx; i++) {
      const x0 = Math.floor(i * w / nx), x1 = Math.max(x0 + 1, Math.floor((i + 1) * w / nx));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) sum += lum[row + x];
      }
      grid[j * nx + i] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return { grid, nx, ny };
}

/** Separable 3x3 box blur, repeated `passes` times, edges clamped. */
export function smooth(grid, nx, ny, passes) {
  let a = grid, b = new Float32Array(grid.length);
  for (let n = 0; n < passes; n++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const l = i > 0 ? i - 1 : i, r = i < nx - 1 ? i + 1 : i;
        b[j * nx + i] = (a[j * nx + l] + a[j * nx + i] + a[j * nx + r]) / 3;
      }
    }
    for (let j = 0; j < ny; j++) {
      const u = j > 0 ? j - 1 : j, d = j < ny - 1 ? j + 1 : j;
      for (let i = 0; i < nx; i++) a[j * nx + i] = (b[u * nx + i] + b[j * nx + i] + b[d * nx + i]) / 3;
    }
  }
  return a;
}

/**
 * Turn brightness samples into a height field (mm).
 * opts.mode: "relief" (bright = high on a base) or "litho" (dark = thick, between min and max).
 * A lithophane frame pads the field with cells at full thickness.
 */
export function heightField(gray, nx, ny, opts) {
  const spacing = opts.widthMM / (nx - 1);
  const z = new Float32Array(nx * ny);
  if (opts.mode === "litho") {
    const lo = opts.minMM, span = Math.max(0, opts.maxMM - opts.minMM);
    for (let k = 0; k < z.length; k++) z[k] = lo + (opts.invert ? gray[k] : 1 - gray[k]) * span;
  } else {
    for (let k = 0; k < z.length; k++) z[k] = opts.baseMM + (opts.invert ? 1 - gray[k] : gray[k]) * opts.reliefMM;
  }
  const pad = opts.mode === "litho" && opts.frameMM > 0 ? Math.max(1, Math.round(opts.frameMM / spacing)) : 0;
  if (!pad) return { z, nx, ny, spacing };
  const fx = nx + 2 * pad, fy = ny + 2 * pad, framed = new Float32Array(fx * fy).fill(opts.maxMM);
  for (let j = 0; j < ny; j++) framed.set(z.subarray(j * nx, j * nx + nx), (j + pad) * fx + pad);
  return { z: framed, nx: fx, ny: fy, spacing };
}

/** Number of triangles buildSolid() will emit for an nx x ny field. */
export const triangleCount = (nx, ny) => 2 * (nx - 1) * (ny - 1) + 6 * (nx - 1) + 6 * (ny - 1);

/**
 * Closed solid from a height field: top grid, four side walls down to z = 0, flat bottom fan.
 * Every edge is shared by exactly two triangles with opposite winding (outward normals).
 */
export function buildSolid(field) {
  const { z, nx, ny, spacing: s } = field;
  const P = 2 * (nx - 1) + 2 * (ny - 1);
  const vCount = nx * ny + P + 1;
  const pos = new Float32Array(vCount * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = (j * nx + i) * 3;
    pos[v] = i * s; pos[v + 1] = (ny - 1 - j) * s; pos[v + 2] = z[j * nx + i];
  }
  // Perimeter, counter-clockwise seen from above (image row ny-1 is y = 0).
  const ring = new Uint32Array(P);
  let k = 0;
  for (let i = 0; i < nx - 1; i++) ring[k++] = (ny - 1) * nx + i;
  for (let j = ny - 1; j > 0; j--) ring[k++] = j * nx + (nx - 1);
  for (let i = nx - 1; i > 0; i--) ring[k++] = i;
  for (let j = 0; j < ny - 1; j++) ring[k++] = j * nx;
  const base = nx * ny;
  for (let r = 0; r < P; r++) {
    const t = ring[r] * 3, v = (base + r) * 3;
    pos[v] = pos[t]; pos[v + 1] = pos[t + 1]; pos[v + 2] = 0;
  }
  const c = base + P;
  pos[c * 3] = (nx - 1) * s / 2; pos[c * 3 + 1] = (ny - 1) * s / 2; pos[c * 3 + 2] = 0;

  const idx = new Uint32Array(triangleCount(nx, ny) * 3);
  let n = 0;
  const tri = (a, b, d) => { idx[n++] = a; idx[n++] = b; idx[n++] = d; };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const tl = j * nx + i, tr = tl + 1, bl = tl + nx, br = bl + 1;
    tri(bl, br, tr); tri(bl, tr, tl);
  }
  for (let r = 0; r < P; r++) {
    const r2 = (r + 1) % P;
    const at = ring[r], bt = ring[r2], ab = base + r, bb = base + r2;
    tri(ab, bb, bt); tri(ab, bt, at);
    tri(c, bb, ab);
  }
  return { positions: pos, indices: idx, triangles: idx.length / 3,
    size: [(nx - 1) * s, (ny - 1) * s, maxOf(z)] };
}

function maxOf(a) { let m = -Infinity; for (let k = 0; k < a.length; k++) if (a[k] > m) m = a[k]; return m; }

/** Binary STL: 80-byte header, uint32 triangle count, then per triangle normal + 3 vertices (float32 LE) + uint16 0. */
export function encodeSTL(mesh, label = "freeimagetostl.com relief") {
  const { positions: p, indices: f, triangles: T } = mesh;
  const buf = new ArrayBuffer(84 + 50 * T), dv = new DataView(buf);
  const head = (label + " | binary STL | units: mm").slice(0, 80);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
  dv.setUint32(80, T, true);
  let o = 84;
  for (let t = 0; t < T; t++) {
    const a = f[t * 3] * 3, b = f[t * 3 + 1] * 3, c = f[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / len, true); dv.setFloat32(o + 4, ny / len, true); dv.setFloat32(o + 8, nz / len, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, p[v], true); dv.setFloat32(o + 4, p[v + 1], true); dv.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}

/** Whole pipeline in one call, used by the page and by our tests. */
export function imageToSTL(rgba, w, h, opts) {
  const t0 = (globalThis.performance || Date).now();
  const lum = toLuminance(rgba, w, h);
  const { grid, nx, ny } = resample(lum, w, h, opts.samples);
  smooth(grid, nx, ny, opts.smoothing | 0);
  const field = heightField(grid, nx, ny, opts);
  const mesh = buildSolid(field);
  const stl = encodeSTL(mesh, opts.mode === "litho" ? "freeimagetostl.com lithophane" : "freeimagetostl.com heightmap");
  return { mesh, stl, gray: grid, gw: nx, gh: ny, field, ms: (globalThis.performance || Date).now() - t0 };
}
