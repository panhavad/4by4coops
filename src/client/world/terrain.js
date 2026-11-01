// Heightfield terrain: deterministic generation, exact (triangle-matched) height/normal queries, colors.
import { createNoise2D, fbm, ridged } from '../core/noise.js';
import { hash32, hash2, smoothstep, lerp, yieldTask } from '../core/rng.js';

export const WORLD_SIZE = 1024;
export const HALF = WORLD_SIZE / 2;
export const CELL = 2;
export const GRID = WORLD_SIZE / CELL;
export const N = GRID + 1;
export const PLAY_HALF = HALF - 70;

export const SURF = { GRASS: 0, DIRT: 1, ROCK: 2, SAND: 3, SNOW: 4, WOOD: 5 };
export const SURF_GRIP = [0.95, 1.05, 0.9, 0.78, 0.62, 1.0];


const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex) {
  return [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
}
function mixInto(out, c, t) {
  if (t <= 0) return;
  if (t > 1) t = 1;
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
}

export class Terrain {
  constructor(biome, seed) {
    this.biome = biome;
    this.seed = seed;
    this.water = biome.water;
    this.n1 = createNoise2D(hash32(seed, 1));
    this.n2 = createNoise2D(hash32(seed, 2));
    this.n3 = createNoise2D(hash32(seed, 3));
    this.n4 = createNoise2D(hash32(seed, 4));
    this.h = new Float32Array(N * N);
    this.trail = new Uint8Array(GRID * GRID);
    const c = biome.colors;
    this.pal = {
      grass: hexToLinear(c.grass),
      grass2: hexToLinear(c.grass2),
      forest: hexToLinear(c.forest),
      dirt: hexToLinear(c.dirt),
      rock: hexToLinear(c.rock),
      sand: hexToLinear(c.sand),
      snow: hexToLinear(c.snow),
    };
  }

  // Noise fields are smooth at these scales, so they're sampled on coarse grids and interpolated;
  // only the cheap non-linear shaping (terraces, river channels, edge walls) runs at full 2 m resolution.
  async build(onProgress) {
    const b = this.biome;
    const CN = GRID / 2 + 1;
    const base = new Float32Array(CN * CN);
    const river = new Float32Array(CN * CN);
    const depth = new Float32Array(CN * CN);
    for (let j = 0; j < CN; j++) {
      const z = -HALF + j * 2 * CELL;
      for (let i = 0; i < CN; i++) {
        const x = -HALF + i * 2 * CELL;
        const k = j * CN + i;
        let h = b.base + fbm(this.n1, x * 0.0021, z * 0.0021, 5) * b.hill;
        const mask = smoothstep(0.0, 0.55, this.n2(x * 0.0011 + 31.7, z * 0.0011 - 12.3));
        if (mask > 0) h += mask * ridged(this.n3, x * 0.0042, z * 0.0042, 4) * b.mountain;
        base[k] = h + this.n4(x * 0.06, z * 0.06) * 0.3;
        river[k] = b.river ? this.n2(x * 0.0019 + 70.1, z * 0.0019 - 40.7) : 1;
        depth[k] = this.n4(x * 0.012 + 9.1, z * 0.012 - 3.3);
      }
      if ((j & 31) === 31) {
        onProgress?.((j / CN) * 0.8);
        await yieldTask();
      }
    }
    const H = this.h;
    for (let j = 0; j < N; j++) {
      const cj = Math.min(j >> 1, CN - 2);
      const v = (j - cj * 2) / 2;
      const z = -HALF + j * CELL;
      for (let i = 0; i < N; i++) {
        const ci = Math.min(i >> 1, CN - 2);
        const u = (i - ci * 2) / 2;
        const k = cj * CN + ci;
        const w00 = (1 - u) * (1 - v);
        const w10 = u * (1 - v);
        const w01 = (1 - u) * v;
        const w11 = u * v;
        const h = base[k] * w00 + base[k + 1] * w10 + base[k + CN] * w01 + base[k + CN + 1] * w11;
        const rv = river[k] * w00 + river[k + 1] * w10 + river[k + CN] * w01 + river[k + CN + 1] * w11;
        const dn = depth[k] * w00 + depth[k + 1] * w10 + depth[k + CN] * w01 + depth[k + CN + 1] * w11;
        H[j * N + i] = this.shape(h, rv, dn, -HALF + i * CELL, z);
      }
    }
    // Coarse 8 m fields for vegetation density and color patches.
    const FN = (HALF * 2) / 8 + 1;
    this.fieldN = FN;
    this.forestGrid = new Float32Array(FN * FN);
    this.patchGrid = new Float32Array(FN * FN);
    for (let j = 0; j < FN; j++) {
      for (let i = 0; i < FN; i++) {
        const x = -HALF + i * 8;
        const z = -HALF + j * 8;
        this.forestGrid[j * FN + i] = smoothstep(-0.05, 0.45, fbm(this.n3, x * 0.006 + 11.3, z * 0.006 - 7.9, 3));
        this.patchGrid[j * FN + i] = this.n4(x * 0.013, z * 0.013);
      }
    }
    onProgress?.(1);
  }

  shape(h, rvSigned, dn, x, z) {
    const b = this.biome;
    if (b.terrace) {
      const s = b.terrace;
      const k = h / s;
      const fl = Math.floor(k);
      h = lerp(h, (fl + smoothstep(0.72, 1, k - fl)) * s, 0.85);
    }
    if (b.river) {
      // |noise| near zero traces meandering lines: a narrow channel (plankable) in a wide, gentle valley.
      const rv = Math.abs(rvSigned);
      const V = 0.12;
      const C = 0.012;
      if (rv < V) {
        const lowland = 1 - smoothstep(8, 22, h - b.water);
        if (lowland > 0) {
          let carved;
          if (rv < C) {
            const u = rv / C;
            const depth = 0.8 + 1.8 * (0.5 + 0.5 * dn);
            carved = b.water + 0.6 - (depth + 0.6) * (1 - u * u);
          } else {
            carved = b.water + 0.6 + (h - b.water - 0.6) * smoothstep(C, V, rv);
          }
          if (carved < h) h += (carved - h) * lowland;
        }
      }
    }
    const e = Math.max(Math.abs(x), Math.abs(z)) - (HALF - 64);
    if (e > 0) h += e * e * 0.02 + e * 0.35;
    return h;
  }

  field(grid, x, z) {
    const FN = this.fieldN;
    let fx = (x + HALF) / 8;
    let fz = (z + HALF) / 8;
    fx = fx < 0 ? 0 : fx > FN - 1.001 ? FN - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > FN - 1.001 ? FN - 1.001 : fz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * FN + i;
    return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + FN] * (1 - u) + grid[k + FN + 1] * u) * v;
  }

  /** Height exactly matching the rendered triangles. */
  heightAt(x, z) {
    let fx = (x + HALF) / CELL;
    let fz = (z + HALF) / CELL;
    if (fx < 0) fx = 0;
    else if (fx > GRID - 1e-4) fx = GRID - 1e-4;
    if (fz < 0) fz = 0;
    else if (fz > GRID - 1e-4) fz = GRID - 1e-4;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = this.h;
    const k = j * N + i;
    const h00 = h[k];
    const h10 = h[k + 1];
    const h01 = h[k + N];
    const h11 = h[k + N + 1];
    if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  /** Fills out = {h, nx, ny, nz, surface}. */
  sample(x, z, out) {
    let fx = (x + HALF) / CELL;
    let fz = (z + HALF) / CELL;
    if (fx < 0) fx = 0;
    else if (fx > GRID - 1e-4) fx = GRID - 1e-4;
    if (fz < 0) fz = 0;
    else if (fz > GRID - 1e-4) fz = GRID - 1e-4;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h = this.h;
    const k = j * N + i;
    const h00 = h[k];
    let a;
    let b;
    if (u >= v) {
      a = h[k + 1] - h00;
      b = h[k + N + 1] - h[k + 1];
    } else {
      a = h[k + N + 1] - h[k + N];
      b = h[k + N] - h00;
    }
    out.h = h00 + a * u + b * v;
    const nx = -a / CELL;
    const nz = -b / CELL;
    const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    out.nx = nx * inv;
    out.ny = inv;
    out.nz = nz * inv;
    out.surface = this.surfaceAt(i, j, out.h, out.ny);
    return out;
  }

  surfaceAt(i, j, h, ny) {
    if (this.trail[Math.min(j, GRID - 1) * GRID + Math.min(i, GRID - 1)] > 110) return SURF.DIRT;
    if (h < this.water + 0.6) return SURF.SAND;
    if (ny < 0.76) return SURF.ROCK;
    if (h > this.biome.snow) return SURF.SNOW;
    return SURF.GRASS;
  }

  trailAt(x, z) {
    const i = Math.floor((x + HALF) / CELL);
    const j = Math.floor((z + HALF) / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 0;
    return this.trail[j * GRID + i];
  }

  forestAt(x, z) {
    return this.field(this.forestGrid, x, z);
  }

  /** Linear RGB color for a terrain face. */
  colorAt(x, z, h, ny, out) {
    const P = this.pal;
    const b = this.biome;
    const n = this.field(this.patchGrid, x, z);
    out[0] = P.grass[0];
    out[1] = P.grass[1];
    out[2] = P.grass[2];
    mixInto(out, P.grass2, 0.5 + 0.5 * n);
    mixInto(out, P.forest, this.forestAt(x, z) * 0.65);
    const trail = this.trailAt(x, z);
    if (trail) mixInto(out, P.dirt, (trail / 255) * 0.9);
    mixInto(out, P.rock, smoothstep(0.86, 0.72, ny));
    if (h > b.snow - 10) {
      mixInto(out, P.snow, smoothstep(b.snow - 4 + n * 6, b.snow + 2 + n * 6, h) * smoothstep(0.6, 0.78, ny));
    }
    mixInto(out, P.sand, smoothstep(this.water + 1.4, this.water + 0.4, h));
    const jitter = 1 + ((hash2(Math.floor(x * 4), Math.floor(z * 4)) & 1023) / 1023 - 0.5) * 0.09;
    out[0] *= jitter;
    out[1] *= jitter;
    out[2] *= jitter;
    return out;
  }

  /** Flatten a circular pad toward `target` height (in-place on the grid). */
  flatten(cx, cz, radius, falloff, target) {
    const r2 = radius + falloff;
    const i0 = Math.max(0, Math.floor((cx - r2 + HALF) / CELL));
    const i1 = Math.min(GRID, Math.ceil((cx + r2 + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - r2 + HALF) / CELL));
    const j1 = Math.min(GRID, Math.ceil((cz + r2 + HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL;
        const z = -HALF + j * CELL;
        const d = Math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
        if (d >= r2) continue;
        const k = j * N + i;
        const t = d <= radius ? 0 : smoothstep(0, 1, (d - radius) / falloff);
        this.h[k] = lerp(target, this.h[k], t);
      }
    }
  }

  /** Bowl-shaped depression (meteor impact). */
  crater(cx, cz, radius, depth) {
    const i0 = Math.max(0, Math.floor((cx - radius - 2 + HALF) / CELL));
    const i1 = Math.min(GRID, Math.ceil((cx + radius + 2 + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - radius - 2 + HALF) / CELL));
    const j1 = Math.min(GRID, Math.ceil((cz + radius + 2 + HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = -HALF + i * CELL - cx;
        const dz = -HALF + j * CELL - cz;
        const d = Math.sqrt(dx * dx + dz * dz) / radius;
        if (d >= 1.25) continue;
        const k = j * N + i;
        if (d < 1) this.h[k] -= depth * (1 - d * d);
        else this.h[k] += depth * 0.35 * (1 - (d - 1) / 0.25);
      }
    }
  }

  /** Average height of a disc (used to level building pads). */
  averageHeight(cx, cz, r) {
    let s = this.heightAt(cx, cz) * 2;
    for (const [dx, dz] of RING8) s += this.heightAt(cx + dx * r, cz + dz * r);
    return s / 10;
  }

  /** Max height difference across a disc - lower is flatter. */
  roughness(cx, cz, r) {
    const c = this.heightAt(cx, cz);
    let m = 0;
    for (const [dx, dz] of RING8) m = Math.max(m, Math.abs(this.heightAt(cx + dx * r, cz + dz * r) - c));
    return m;
  }
}

// Exact constants (no trig) so world generation is bit-identical across JS engines.
const S = Math.SQRT1_2;
const RING8 = [[1, 0], [S, S], [0, 1], [-S, S], [-1, 0], [-S, -S], [0, -1], [S, -S]];
