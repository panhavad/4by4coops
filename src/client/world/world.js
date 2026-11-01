// Region generation: terrain, points of interest, trails, vegetation, colliders, wildlife spawns, minimap.
// Fully deterministic from (seed, region) so every co-op client builds the identical world.
import { Terrain, HALF, CELL, GRID, PLAY_HALF } from './terrain.js';
import { biomeFor } from './biomes.js';
import { Rng, hash32, hash2, smoothstep, yieldTask } from '../core/rng.js';
import { METEORS_PER_REGION, UPGRADE_KINDS } from '../../shared/constants.js';
import { LANDMARK_NAMES } from './props.js';

export const CHUNK = 64;
export const CHUNKS = (HALF * 2) / CHUNK;
const COLL = 16;
const COLL_N = (HALF * 2) / COLL;

export const POI_RADIUS = { camp: 0, cabin: 16, viewpoint: 10, landmark: 20, portal: 26 };
export const POI_LABEL = { camp: 'Base Camp', cabin: 'Cabin', viewpoint: 'Viewpoint', portal: 'Portal' };

const GROUP = {
  deer: [2, 4], rabbit: [1, 3], fox: [1, 1], boar: [2, 3], moose: [1, 1], bear: [1, 1], beaver: [1, 2],
  wolf: [2, 3], coyote: [1, 2], bighorn: [2, 4], tortoise: [1, 1], goat: [2, 3], marmot: [1, 3], arcticfox: [1, 1],
};

const d2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

export class World {
  constructor(region, roomSeed) {
    this.region = region;
    this.seed = hash32(roomSeed, region, 0x51ed);
    this.biome = biomeFor(region);
    this.terrain = new Terrain(this.biome, this.seed);
    this.water = this.biome.water;
    this.pois = [];
    this.meteors = [];
    this.crates = [];
    this.items = Array.from({ length: CHUNKS * CHUNKS }, () => []);
    this.colliders = Array.from({ length: COLL_N * COLL_N }, () => []);
    this.animals = [];
    this.trails = [];
    this.spawn = { x: 0, z: 300, yaw: 0 };
  }

  async generate(onProgress) {
    await this.terrain.build((p) => onProgress?.(p * 0.6));
    this.placePOIs(new Rng(hash32(this.seed, 99)));
    onProgress?.(0.7);
    await yieldTask();
    this.buildTrails();
    for (const p of [...this.pois, ...this.meteors, ...this.crates]) p.y = this.terrain.heightAt(p.x, p.z);
    onProgress?.(0.85);
    await yieldTask();
    this.scatter(new Rng(hash32(this.seed, 7)));
    this.placeAnimals(new Rng(hash32(this.seed, 13)));
    onProgress?.(1);
  }

  isDry(x, z, margin = 1.5) {
    return this.terrain.heightAt(x, z) > this.water + margin;
  }

  // ---------------------------------------------------------------- points of interest
  placePOIs(rng) {
    const T = this.terrain;
    const all = () => [...this.pois, ...this.meteors, ...this.crates];
    const clear = (x, z, list, d) => list.every((p) => d2(p.x, p.z, x, z) >= d * d);
    const pick = (tries, gen, score) => {
      let best = null;
      let bestScore = Infinity;
      for (let i = 0; i < tries; i++) {
        const x = gen[0] + rng.next() * (gen[1] - gen[0]);
        const z = gen[2] + rng.next() * (gen[3] - gen[2]);
        if (!this.isDry(x, z, 2)) continue;
        const s = score(x, z);
        if (s < bestScore) {
          bestScore = s;
          best = { x, z };
        }
      }
      return best ?? { x: (gen[0] + gen[1]) / 2, z: (gen[2] + gen[3]) / 2 };
    };
    const pad = (p, r, fall) => T.flatten(p.x, p.z, r, fall, Math.max(T.averageHeight(p.x, p.z, r), this.water + 1.2));

    const camp = pick(90, [-160, 160, 250, 350], (x, z) => T.roughness(x, z, 14) + Math.abs(x) * 0.004);
    pad(camp, 16, 16);
    this.pois.push({ id: 'b0', kind: 'camp', ...camp, yaw: 0, name: 'Base Camp' });
    this.spawn = { x: camp.x, z: camp.z - 9, yaw: 0 };

    const portal = pick(90, [-220, 220, -400, -310], (x, z) => T.roughness(x, z, 12));
    pad(portal, 14, 14);
    this.pois.push({ id: 'p0', kind: 'portal', ...portal, yaw: 0, name: 'Ancient Portal' });

    const cabinBands = [[-400, -140, -220, 160], [140, 400, -220, 160], [-170, 170, -200, 60]];
    cabinBands.forEach((band, i) => {
      const c = pick(70, band, (x, z) => T.roughness(x, z, 9) + (clear(x, z, this.pois, 170) ? 0 : 1000));
      pad(c, 10, 10);
      this.pois.push({ id: `h${i}`, kind: 'cabin', ...c, yaw: Math.floor(rng.next() * 4) * (Math.PI / 2), name: 'Cabin' });
    });

    const tops = [];
    for (let i = 0; i < 500; i++) {
      const x = rng.range(-400, 400);
      const z = rng.range(-400, 400);
      tops.push({ x, z, h: T.heightAt(x, z) });
    }
    tops.sort((a, b) => b.h - a.h || a.x - b.x);
    let vi = 0;
    for (const t of tops) {
      if (vi >= 3) break;
      if (!this.isDry(t.x, t.z, 3) || T.roughness(t.x, t.z, 5) > 4) continue;
      if (!clear(t.x, t.z, this.pois, vi ? 120 : 100) || !clear(t.x, t.z, this.pois.filter((p) => p.kind === 'viewpoint'), 230)) continue;
      pad(t, 5, 7);
      this.pois.push({ id: `v${vi}`, kind: 'viewpoint', x: t.x, z: t.z, yaw: rng.range(0, 6.28), name: 'Viewpoint' });
      vi++;
    }

    const types = [...this.biome.landmarks];
    for (let i = types.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [types[i], types[j]] = [types[j], types[i]];
    }
    for (let i = 0; i < 3; i++) {
      const c = pick(60, [-410, 410, -380, 330], (x, z) => T.roughness(x, z, 9) + (clear(x, z, this.pois, 150) ? 0 : 1000));
      pad(c, 9, 9);
      const type = types[i];
      this.pois.push({ id: `l${i}`, kind: 'landmark', type, ...c, yaw: rng.range(0, 6.28), name: LANDMARK_NAMES[type] });
    }

    for (let i = 0; i < METEORS_PER_REGION; i++) {
      const c = pick(60, [-410, 410, -410, 380], (x, z) =>
        (clear(x, z, this.meteors, 130) ? 0 : 1000) + (clear(x, z, this.pois, 50) ? 0 : 500) + (this.isDry(x, z, 3) ? 0 : 300) + rng.next());
      T.crater(c.x, c.z, 5, 1.1);
      this.meteors.push({ id: `m${i}`, kind: 'meteor', ...c });
    }

    UPGRADE_KINDS.forEach((kind, i) => {
      const c = pick(50, [-420, 420, -410, 380], (x, z) =>
        (clear(x, z, this.crates, 110) ? 0 : 1000) + (clear(x, z, all(), 35) ? 0 : 500) + rng.next());
      this.crates.push({ id: `u${i}`, kind: 'crate', upgrade: kind, ...c, yaw: rng.range(0, 6.28) });
    });
  }

  // ---------------------------------------------------------------- trails (A* over a coarse grid)
  buildTrails() {
    const T = this.terrain;
    const S = 8;
    const CN = (HALF * 2) / S;
    const ch = new Float32Array(CN * CN);
    for (let j = 0; j < CN; j++) {
      for (let i = 0; i < CN; i++) ch[j * CN + i] = T.heightAt(-HALF + (i + 0.5) * S, -HALF + (j + 0.5) * S);
    }
    const toCell = (x) => Math.max(0, Math.min(CN - 1, Math.floor((x + HALF) / S)));
    const nodes = this.pois.filter((p) => p.kind !== 'crate');
    // Prim's minimum spanning tree over straight-line distances.
    const inTree = [0];
    const edges = [];
    const rest = nodes.map((_, i) => i).slice(1);
    while (rest.length) {
      let best = null;
      for (const a of inTree) {
        for (const b of rest) {
          const d = d2(nodes[a].x, nodes[a].z, nodes[b].x, nodes[b].z);
          if (!best || d < best[2]) best = [a, b, d];
        }
      }
      edges.push(best);
      inTree.push(best[1]);
      rest.splice(rest.indexOf(best[1]), 1);
    }
    const water = this.water;
    const g = new Float64Array(CN * CN);
    const from = new Int32Array(CN * CN);
    const closed = new Uint8Array(CN * CN);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const DD = [8, 8, 8, 8, 11.3137, 11.3137, 11.3137, 11.3137];
    const limit = (PLAY_HALF - 12 + HALF) / S;
    const lo = CN - limit;
    for (const [a, b] of edges) {
      const si = toCell(nodes[a].x);
      const sj = toCell(nodes[a].z);
      const gi = toCell(nodes[b].x);
      const gj = toCell(nodes[b].z);
      g.fill(Infinity);
      from.fill(-1);
      closed.fill(0);
      const heap = new MinHeap();
      const start = sj * CN + si;
      const goal = gj * CN + gi;
      g[start] = 0;
      heap.push(start, 0);
      while (heap.size) {
        const cur = heap.pop();
        if (cur === goal) break;
        if (closed[cur]) continue;
        closed[cur] = 1;
        const ci = cur % CN;
        const cj = (cur - ci) / CN;
        const hc = ch[cur];
        const gc = g[cur];
        for (let d = 0; d < 8; d++) {
          const ni = ci + DI[d];
          const nj = cj + DJ[d];
          if (ni < lo || nj < lo || ni >= limit || nj >= limit) continue;
          const nk = nj * CN + ni;
          if (closed[nk]) continue;
          const dist = DD[d];
          const hn = ch[nk];
          const slope = (hn > hc ? hn - hc : hc - hn) / dist;
          let cost = dist * (1 + slope * slope * 30 + (slope > 0.55 ? 25 : 0));
          if (hn < water + 0.4) cost += 70;
          const ng = gc + cost;
          if (ng < g[nk]) {
            g[nk] = ng;
            from[nk] = cur;
            const hx = (ni - gi) * S;
            const hz = (nj - gj) * S;
            // Weighted heuristic: slightly sub-optimal paths, far fewer expansions.
            heap.push(nk, ng + 1.8 * Math.sqrt(hx * hx + hz * hz));
          }
        }
      }
      if (from[goal] < 0 && goal !== start) continue;
      const pts = [];
      for (let k = goal; k >= 0; k = from[k]) {
        const i = k % CN;
        pts.push([-HALF + (i + 0.5) * S, -HALF + ((k - i) / CN + 0.5) * S]);
        if (k === start) break;
      }
      pts.reverse();
      pts[0] = [nodes[a].x, nodes[a].z];
      pts[pts.length - 1] = [nodes[b].x, nodes[b].z];
      const smooth = chaikin(chaikin(pts));
      this.trails.push(smooth);
      for (let i = 1; i < smooth.length; i++) this.stampTrail(smooth[i - 1], smooth[i]);
    }
    // Smooth the ground along trails so they drive nicer.
    const H = T.h;
    const copy = H.slice();
    const NN = GRID + 1;
    for (let j = 1; j < GRID; j++) {
      for (let i = 1; i < GRID; i++) {
        const t = T.trail[j * GRID + i];
        if (t < 60) continue;
        const k = j * NN + i;
        const avg = (copy[k - 1] + copy[k + 1] + copy[k - NN] + copy[k + NN] + copy[k - NN - 1] + copy[k + NN + 1] + copy[k - NN + 1] + copy[k + NN - 1]) / 8;
        H[k] += (avg - H[k]) * 0.7 * (t / 255);
      }
    }
  }

  stampTrail([ax, az], [bx, bz]) {
    const T = this.terrain;
    const R = 3.6;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + HALF) / CELL));
    const i1 = Math.min(GRID - 1, Math.floor((Math.max(ax, bx) + R + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + HALF) / CELL));
    const j1 = Math.min(GRID - 1, Math.floor((Math.max(az, bz) + R + HALF) / CELL));
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = -HALF + (i + 0.5) * CELL;
        const pz = -HALF + (j + 0.5) * CELL;
        let t = ((px - ax) * dx + (pz - az) * dz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - px;
        const ez = az + dz * t - pz;
        const v = Math.round(255 * smoothstep(R, 1.6, Math.sqrt(ex * ex + ez * ez)));
        const k = j * GRID + i;
        if (v > T.trail[k]) T.trail[k] = v;
      }
    }
  }

  // ---------------------------------------------------------------- vegetation + rocks
  /** Rasterizes POI clearings into a 4 m mask so vegetation checks are O(1). */
  buildClearings() {
    const S = 4;
    const MN = (HALF * 2) / S;
    const mask = new Uint8Array(MN * MN);
    const stamp = (x, z, r) => {
      const i0 = Math.max(0, Math.floor((x - r + HALF) / S));
      const i1 = Math.min(MN - 1, Math.floor((x + r + HALF) / S));
      const j0 = Math.max(0, Math.floor((z - r + HALF) / S));
      const j1 = Math.min(MN - 1, Math.floor((z + r + HALF) / S));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (d2(-HALF + (i + 0.5) * S, -HALF + (j + 0.5) * S, x, z) < r * r) mask[j * MN + i] = 1;
        }
      }
    };
    for (const p of this.pois) stamp(p.x, p.z, p.kind === 'camp' ? 26 : p.kind === 'portal' ? 22 : p.kind === 'viewpoint' ? 10 : 15);
    for (const p of this.meteors) stamp(p.x, p.z, 8);
    for (const p of this.crates) stamp(p.x, p.z, 4);
    this.clearMask = mask;
    this.clearN = MN;
  }

  nearPOI(x, z) {
    const i = Math.floor((x + HALF) / 4);
    const j = Math.floor((z + HALF) / 4);
    if (i < 0 || j < 0 || i >= this.clearN || j >= this.clearN) return false;
    return this.clearMask[j * this.clearN + i] === 1;
  }

  scatter(rng) {
    this.buildClearings();
    const T = this.terrain;
    const b = this.biome;
    const step = 5;
    const g = { h: 0, nx: 0, ny: 1, nz: 0 };
    for (let gz = -PLAY_HALF; gz < PLAY_HALF; gz += step) {
      for (let gx = -PLAY_HALF; gx < PLAY_HALF; gx += step) {
        const x = gx + rng.next() * step;
        const z = gz + rng.next() * step;
        const r = rng.next();
        const r2 = rng.next();
        T.sample(x, z, g);
        if (g.h < this.water + 0.8 || T.trailAt(x, z) > 25 || this.nearPOI(x, z)) continue;
        const forest = T.forestAt(x, z);
        if (g.ny > 0.82 && g.h < b.snow + 14) {
          if (r < b.treeDensity * (0.03 + 0.97 * forest)) {
            let kind = rng.weighted(b.trees);
            if (kind === 'pine' && g.h > b.snow - 4) kind = 'snowpine';
            const s = 0.75 + r2 * 0.65;
            this.addItem(kind, x, g.h - 0.1, z, s, rng.next() * 6.283);
            this.addCollider(x, z, (kind === 'cactus' ? 0.4 : 0.32) * s + 0.12, g.h + 6 * s, 1);
            continue;
          }
        }
        if (r > 1 - b.bushes * 0.07) {
          this.addItem('bush', x, g.h - 0.15, z, 0.7 + r2 * 0.7, r2 * 6.283);
        } else if (r2 < b.boulders * (g.ny < 0.9 ? 0.16 : 0.035)) {
          const s = 0.8 + rng.next() * 1.6;
          this.addItem(`boulder${rng.int(3)}`, x, g.h - 0.3 * s, z, s, rng.next() * 6.283);
          this.addCollider(x, z, s * 0.92, g.h + s * 1.1, 2);
        } else if (r2 > 0.985) {
          this.addItem('pebble', x, g.h, z, 0.8 + r * 0.8, r * 6.283);
        }
      }
    }
  }

  addItem(kind, x, y, z, s, rot) {
    const ci = Math.floor((x + HALF) / CHUNK);
    const cj = Math.floor((z + HALF) / CHUNK);
    if (ci < 0 || cj < 0 || ci >= CHUNKS || cj >= CHUNKS) return;
    this.items[cj * CHUNKS + ci].push({ kind, x, y, z, s, rot, tint: 0.9 + (hash2(x * 100, z * 100) & 255) / 1275 });
  }

  addCollider(x, z, r, top, type = 0, ref = null) {
    const i = Math.floor((x + HALF) / COLL);
    const j = Math.floor((z + HALF) / COLL);
    if (i < 0 || j < 0 || i >= COLL_N || j >= COLL_N) return;
    this.colliders[j * COLL_N + i].push({ x, z, r, top, type, ref });
  }

  /** Calls fn(collider) for colliders near (x, z). */
  forColliders(x, z, fn) {
    const ci = Math.floor((x + HALF) / COLL);
    const cj = Math.floor((z + HALF) / COLL);
    for (let j = cj - 1; j <= cj + 1; j++) {
      if (j < 0 || j >= COLL_N) continue;
      for (let i = ci - 1; i <= ci + 1; i++) {
        if (i < 0 || i >= COLL_N) continue;
        for (const c of this.colliders[j * COLL_N + i]) fn(c);
      }
    }
  }

  /** Calls fn(collider) for every collider within r meters of (x, z). */
  collidersInRadius(x, z, r, fn) {
    const i0 = Math.max(0, Math.floor((x - r + HALF) / COLL));
    const i1 = Math.min(COLL_N - 1, Math.floor((x + r + HALF) / COLL));
    const j0 = Math.max(0, Math.floor((z - r + HALF) / COLL));
    const j1 = Math.min(COLL_N - 1, Math.floor((z + r + HALF) / COLL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const c of this.colliders[j * COLL_N + i]) if (d2(c.x, c.z, x, z) <= r * r) fn(c);
      }
    }
  }

  removeColliders(x, z, match) {
    const ci = Math.floor((x + HALF) / COLL);
    const cj = Math.floor((z + HALF) / COLL);
    for (let j = Math.max(0, cj - 1); j <= Math.min(COLL_N - 1, cj + 1); j++) {
      for (let i = Math.max(0, ci - 1); i <= Math.min(COLL_N - 1, ci + 1); i++) {
        const k = j * COLL_N + i;
        this.colliders[k] = this.colliders[k].filter((c) => !match(c));
      }
    }
  }

  // ---------------------------------------------------------------- wildlife
  placeAnimals(rng) {
    const b = this.biome;
    for (let g = 0; g < 22; g++) {
      const species = rng.weighted(b.animals);
      let x = 0;
      let z = 0;
      let ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        x = rng.range(-400, 400);
        z = rng.range(-400, 400);
        const h = this.terrain.heightAt(x, z);
        ok = species === 'beaver' ? h > this.water + 0.4 && h < this.water + 2.5 : h > this.water + 1.5;
        if (ok && d2(x, z, this.spawn.x, this.spawn.z) < 40 * 40) ok = false;
      }
      if (!ok) continue;
      const [lo, hi] = GROUP[species];
      const n = lo + rng.int(hi - lo + 1);
      for (let k = 0; k < n; k++) {
        this.animals.push({
          species,
          hx: x + rng.range(-6, 6),
          hz: z + rng.range(-6, 6),
          R: rng.range(6, species === 'tortoise' || species === 'beaver' ? 6 : 24),
          f1: rng.range(0.006, 0.02),
          f2: rng.range(0.006, 0.02),
          p1: rng.range(0, 6.28),
          p2: rng.range(0, 6.28),
        });
      }
    }
  }

  // ---------------------------------------------------------------- minimap
  /** RGBA pixels (size x size) of a shaded overview map. */
  mapPixels(size = 256) {
    const T = this.terrain;
    const px = new Uint8ClampedArray(size * size * 4);
    const cs = (HALF * 2) / size;
    const col = [0, 0, 0];
    const g = { h: 0, nx: 0, ny: 1, nz: 0 };
    const wc = hexToRgb(this.biome.colors.water);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = -HALF + (i + 0.5) * cs;
        const z = -HALF + (j + 0.5) * cs;
        T.sample(x, z, g);
        T.colorAt(x, z, g.h, g.ny, col);
        const shade = 0.75 + 0.5 * Math.max(0, -g.nx * 0.6 + g.ny * 0.5 - g.nz * 0.6);
        let r = toSrgb(col[0] * shade);
        let gg = toSrgb(col[1] * shade);
        let bb = toSrgb(col[2] * shade);
        // Use the lowest point in the pixel so narrow streams stay visible on the map.
        const q = cs * 0.4;
        const hmin = Math.min(g.h, T.heightAt(x - q, z - q), T.heightAt(x + q, z - q), T.heightAt(x - q, z + q), T.heightAt(x + q, z + q));
        if (hmin < this.water) {
          const depth = Math.min(1, (this.water - hmin) / 3);
          const t = 0.55 + depth * 0.35;
          r += (wc[0] - r) * t;
          gg += (wc[1] - gg) * t;
          bb += (wc[2] - bb) * t;
        }
        const o = (j * size + i) * 4;
        px[o] = r;
        px[o + 1] = gg;
        px[o + 2] = bb;
        px[o + 3] = 255;
      }
    }
    return px;
  }
}

const toSrgb = (c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hexToRgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

function chaikin(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = k[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && v[r] < v[l] ? r : l;
        if (v[c] >= lv) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}
