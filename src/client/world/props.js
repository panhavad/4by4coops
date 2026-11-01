// Procedural low-poly geometry: everything is built from primitives at runtime (no asset downloads).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    _p.set(x, y, z),
    _q.setFromEuler(_e.set(rx, ry, rz)),
    _s.set(sx, sy, sz),
  );
}

/** Non-indexed, flat-shaded geometry with a constant vertex color. */
export function part(geo, hex, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g === geo) g = geo.clone();
  geo.dispose();
  if (matrix) g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.setHex(hex);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export const merge = (parts) => {
  const g = mergeGeometries(parts.filter(Boolean));
  for (const p of parts) p?.dispose();
  return g;
};

/** Randomly displaces vertices of a convex primitive for an organic rock look (keeps faces welded). */
function jitter(geo, rng, amount) {
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) map.set(key, (d = 1 + (rng.next() - 0.5) * amount));
    pos.setXYZ(i, pos.getX(i) * d, pos.getY(i) * d, pos.getZ(i) * d);
  }
  return geo;
}

const TRUNK = 0x6b4a32;

// ---------------------------------------------------------------- vegetation templates
export function buildVegetation(biome, seed) {
  const L = biome.colors.leaves;
  const rng = new Rng(seed ^ 0x9e3779b9);
  const T = {};
  T.pine = merge([
    part(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 5), TRUNK, mat(0, 0.8, 0)),
    part(new THREE.ConeGeometry(1.75, 2.6, 6), L[0], mat(0, 2.3, 0)),
    part(new THREE.ConeGeometry(1.35, 2.2, 6), L[1], mat(0, 3.5, 0, 0, 0.5)),
    part(new THREE.ConeGeometry(0.9, 1.8, 6), L[2] ?? L[1], mat(0, 4.6, 0, 0, 0.2)),
  ]);
  T.snowpine = merge([
    part(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 5), TRUNK, mat(0, 0.8, 0)),
    part(new THREE.ConeGeometry(1.75, 2.6, 6), L[0], mat(0, 2.3, 0)),
    part(new THREE.ConeGeometry(1.35, 2.2, 6), 0xdfe8ee, mat(0, 3.5, 0, 0, 0.5)),
    part(new THREE.ConeGeometry(0.9, 1.8, 6), 0xf4f7fa, mat(0, 4.6, 0, 0, 0.2)),
  ]);
  T.broad = merge([
    part(new THREE.CylinderGeometry(0.18, 0.3, 2.4, 5), TRUNK, mat(0, 1.2, 0)),
    part(jitter(new THREE.IcosahedronGeometry(1.8, 0), rng, 0.25), L[1], mat(0, 3.4, 0, 0, 0, 0, 1, 0.85, 1)),
    part(jitter(new THREE.IcosahedronGeometry(1.2, 0), rng, 0.25), L[2] ?? L[0], mat(0.8, 4.1, 0.3)),
  ]);
  T.birch = merge([
    part(new THREE.CylinderGeometry(0.11, 0.15, 3.4, 5), 0xe6e1d6, mat(0, 1.7, 0)),
    part(jitter(new THREE.IcosahedronGeometry(1.1, 0), rng, 0.3), 0xa6c25a, mat(0, 3.8, 0, 0, 0, 0, 0.9, 1.35, 0.9)),
  ]);
  T.cactus = merge([
    part(new THREE.CylinderGeometry(0.28, 0.33, 3.2, 6), 0x5c8c47, mat(0, 1.6, 0)),
    part(new THREE.CylinderGeometry(0.18, 0.18, 0.8, 6), 0x5c8c47, mat(0.45, 1.5, 0, 0, 0, Math.PI / 2)),
    part(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 6), 0x5c8c47, mat(0.8, 2.0, 0)),
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 6), 0x5c8c47, mat(-0.4, 2.2, 0, 0, 0, Math.PI / 2)),
    part(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6), 0x5c8c47, mat(-0.7, 2.6, 0)),
  ]);
  T.dead = merge([
    part(new THREE.CylinderGeometry(0.1, 0.22, 3.2, 5), 0x7a6a5a, mat(0, 1.6, 0)),
    part(new THREE.CylinderGeometry(0.05, 0.09, 1.4, 4), 0x7a6a5a, mat(0.45, 2.4, 0, 0, 0, -0.8)),
    part(new THREE.CylinderGeometry(0.05, 0.08, 1.1, 4), 0x7a6a5a, mat(-0.35, 2.8, 0.1, 0.2, 0, 0.7)),
  ]);
  T.bush = part(jitter(new THREE.IcosahedronGeometry(0.85, 0), rng, 0.3), biome.colors.bush, mat(0, 0.35, 0, 0, 0, 0, 1.25, 0.75, 1.25));
  T.boulder = [0, 1, 2].map((i) =>
    part(jitter(new THREE.DodecahedronGeometry(1, 0), new Rng(seed + i * 77), 0.45), biome.colors.rock, mat(0, 0.25, 0, i, i * 2, 0, 1, 0.75, 1)),
  );
  T.pebble = part(jitter(new THREE.DodecahedronGeometry(0.45, 0), rng, 0.4), biome.colors.rock, mat(0, 0.1, 0, 0, 0, 0, 1, 0.6, 1));
  return T;
}

// ---------------------------------------------------------------- points of interest
// Each builder returns { solid: BufferGeometry, glow?: BufferGeometry, colliders: [[dx, dz, r, height]] }.

export function buildCamp() {
  const solid = merge([
    part(new THREE.ConeGeometry(1.8, 2.2, 4), 0xd9773a, mat(4, 1.1, -2, 0, Math.PI / 4)),
    part(new THREE.ConeGeometry(1.6, 2.0, 4), 0x3f86b8, mat(-4, 1.0, -3, 0, Math.PI / 4)),
    part(new THREE.BoxGeometry(1.6, 0.18, 0.18), 0x4a3324, mat(0, 0.1, 0, 0, 0.6)),
    part(new THREE.BoxGeometry(1.6, 0.18, 0.18), 0x4a3324, mat(0, 0.12, 0, 0, -0.6)),
    ...Array.from({ length: 8 }, (_, i) =>
      part(new THREE.DodecahedronGeometry(0.22, 0), 0x8a8580, mat(Math.cos((i / 8) * 6.283) * 0.95, 0.1, Math.sin((i / 8) * 6.283) * 0.95)),
    ),
    part(new THREE.BoxGeometry(2.2, 0.35, 0.5), 0x7a5232, mat(0, 0.3, 2.4)),
    part(new THREE.BoxGeometry(0.15, 2.4, 0.15), 0x6b4a32, mat(6, 1.2, 3)),
    part(new THREE.BoxGeometry(1.6, 0.5, 0.08), 0xc9a066, mat(6, 2.1, 3)),
  ]);
  const glow = merge([
    part(new THREE.ConeGeometry(0.4, 0.9, 5), 0xffa236, mat(0, 0.5, 0)),
    part(new THREE.ConeGeometry(0.22, 0.6, 5), 0xffe27a, mat(0.05, 0.45, 0.05)),
  ]);
  return { solid, glow, colliders: [[4, -2, 1.6, 2], [-4, -3, 1.4, 2], [6, 3, 0.4, 3]] };
}

export function buildCabin() {
  const roof = new THREE.CylinderGeometry(3.4, 3.4, 7, 3);
  const solid = merge([
    part(new THREE.BoxGeometry(6, 3, 5), 0x8b5a3c, mat(0, 1.5, 0)),
    part(roof, 0x9c3b2e, mat(0, 3.85, 0, 0, 0, Math.PI / 2, 1, 1, 0.82)),
    part(new THREE.BoxGeometry(1.1, 2.1, 0.12), 0x4a2f20, mat(0, 1.05, 2.52)),
    part(new THREE.BoxGeometry(1.0, 0.8, 0.08), 0xf5d98a, mat(-1.9, 1.7, 2.52)),
    part(new THREE.BoxGeometry(1.0, 0.8, 0.08), 0xf5d98a, mat(1.9, 1.7, 2.52)),
    part(new THREE.BoxGeometry(0.08, 0.8, 1.0), 0xf5d98a, mat(3.02, 1.7, 0)),
    part(new THREE.BoxGeometry(0.7, 2.2, 0.7), 0x8a8580, mat(-1.8, 4.6, -1)),
    part(new THREE.BoxGeometry(6.6, 0.25, 1.8), 0x9c7350, mat(0, 0.12, 3.4)),
    part(new THREE.BoxGeometry(0.18, 2.2, 0.18), 0x6b4a32, mat(-3.1, 1.2, 4.2)),
    part(new THREE.BoxGeometry(0.18, 2.2, 0.18), 0x6b4a32, mat(3.1, 1.2, 4.2)),
    part(new THREE.BoxGeometry(0.15, 2.6, 0.15), 0x6b4a32, mat(4.8, 1.3, 5.5)),
    part(new THREE.BoxGeometry(1.6, 0.7, 0.1), 0xe0743a, mat(4.8, 2.4, 5.5)),
    part(new THREE.BoxGeometry(2.4, 0.9, 1.2), 0x6b4a32, mat(-4.6, 0.45, 1.5)),
  ]);
  return { solid, colliders: [[0, 0, 3.4, 5], [-4.6, 1.5, 1.2, 1]] };
}

export function buildViewpoint() {
  const parts = [];
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    parts.push(part(new THREE.BoxGeometry(0.25, 6.2, 0.25), 0x7a5232, mat(x, 3.1, z)));
    parts.push(part(new THREE.BoxGeometry(0.14, 1.7, 0.14), 0x7a5232, mat(x, 7.0, z)));
  }
  parts.push(part(new THREE.BoxGeometry(3.3, 0.25, 3.3), 0x9c7350, mat(0, 6.2, 0)));
  for (const [x, z, ry] of [[0, -1.6, 0], [0, 1.6, 0], [-1.6, 0, Math.PI / 2], [1.6, 0, Math.PI / 2]]) {
    parts.push(part(new THREE.BoxGeometry(3.2, 0.1, 0.1), 0x7a5232, mat(x, 7.0, z, 0, ry)));
  }
  parts.push(part(new THREE.ConeGeometry(2.7, 1.5, 4), 0x2f5d4a, mat(0, 8.6, 0, 0, Math.PI / 4)));
  parts.push(part(new THREE.BoxGeometry(0.7, 6.6, 0.12), 0x6b4a32, mat(0, 3.0, 2.3, -0.35)));
  parts.push(part(new THREE.BoxGeometry(1.8, 0.2, 0.5), 0x7a5232, mat(3.2, 0.5, 0)));
  return { solid: merge(parts), colliders: [[0, 0, 2.0, 7]] };
}

export function buildPortal() {
  const parts = [
    part(new THREE.TorusGeometry(6.2, 0.9, 6, 18), 0x6f6a72, mat(0, 6.6, 0)),
    part(new THREE.BoxGeometry(3, 1.6, 2.4), 0x5d5960, mat(-5.6, 0.4, 0)),
    part(new THREE.BoxGeometry(3, 1.6, 2.4), 0x5d5960, mat(5.6, 0.4, 0)),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    parts.push(part(new THREE.BoxGeometry(0.9, 2.6, 0.6), 0x77727a, mat(Math.cos(a) * 11, 1.0, Math.sin(a) * 11, 0, -a)));
  }
  const runes = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    runes.push(part(new THREE.BoxGeometry(0.5, 0.5, 0.3), 0x7fe0ff, mat(Math.cos(a) * 6.2, 6.6 + Math.sin(a) * 6.2, 0.75, 0, 0, a)));
  }
  return {
    solid: merge(parts),
    glow: merge(runes),
    colliders: [[-5.6, 0, 1.7, 7], [5.6, 0, 1.7, 7]],
  };
}

export function buildMeteor(seed) {
  const rng = new Rng(seed);
  const solid = merge([
    part(jitter(new THREE.DodecahedronGeometry(1.1, 0), rng, 0.5), 0x3b3438, mat(0, 0.6, 0, 0.4, 0.2, 0.1)),
    part(jitter(new THREE.DodecahedronGeometry(0.5, 0), rng, 0.5), 0x4a4247, mat(1.3, 0.2, 0.4)),
  ]);
  const glow = merge([
    part(new THREE.OctahedronGeometry(0.42, 0), 0xffb347, mat(0.3, 1.45, 0.1, 0.3, 0.5, 0, 0.7, 1.4, 0.7)),
    part(new THREE.OctahedronGeometry(0.3, 0), 0xff7a3d, mat(-0.55, 1.15, 0.35, 0.2, 0, 0.6, 0.7, 1.3, 0.7)),
    part(new THREE.OctahedronGeometry(0.26, 0), 0xffd27a, mat(0.2, 1.1, -0.65, -0.4, 0, 0.2, 0.7, 1.3, 0.7)),
  ]);
  return { solid, glow, colliders: [] };
}

export const CRATE_COLORS = {
  engine: 0xe0533a,
  tires: 0x3a3f45,
  suspension: 0x3a86d0,
  winch: 0xe0b23a,
  planks: 0x6fae3a,
};

export function buildCrate(kind) {
  const c = CRATE_COLORS[kind] ?? 0xffffff;
  const solid = merge([
    part(new THREE.BoxGeometry(1.3, 0.9, 0.95), 0xa77a4a, mat(0, 0.45, 0)),
    part(new THREE.BoxGeometry(1.34, 0.22, 0.99), c, mat(0, 0.5, 0)),
    part(new THREE.BoxGeometry(0.07, 3, 0.07), 0x6b4a32, mat(0.55, 1.5, -0.35)),
    part(new THREE.BoxGeometry(0.7, 0.42, 0.04), c, mat(0.92, 2.75, -0.35)),
  ]);
  return { solid, colliders: [[0, 0, 0.8, 1]] };
}

export function buildLandmark(type, biome, seed) {
  const rock = biome.colors.rock;
  const rng = new Rng(seed);
  switch (type) {
    case 'arch':
      return {
        solid: merge([
          part(new THREE.TorusGeometry(7, 1.7, 5, 12, Math.PI), rock, mat(0, 0, 0, 0, 0, 0, 1, 1.1, 1.3)),
          part(new THREE.BoxGeometry(3.6, 4, 3.4), rock, mat(-7, -1.2, 0, 0, 0.2)),
          part(new THREE.BoxGeometry(3.6, 4, 3.4), rock, mat(7, -1.2, 0, 0, -0.2)),
        ]),
        colliders: [[-7, 0, 2.4, 9], [7, 0, 2.4, 9]],
        name: 'Stone Arch',
      };
    case 'stones': {
      const parts = [];
      const col = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = Math.cos(a) * 7;
        const z = Math.sin(a) * 7;
        parts.push(part(new THREE.BoxGeometry(1.3, 3.4, 0.8), 0x8f8a84, mat(x, 1.4, z, 0, -a + Math.PI / 2, rng.range(-0.08, 0.08))));
        col.push([x, z, 0.95, 4]);
      }
      parts.push(part(new THREE.BoxGeometry(3.4, 0.7, 0.9), 0x8f8a84, mat(Math.cos(0.39) * 7, 3.4, Math.sin(0.39) * 7, 0, -0.39 + Math.PI / 2)));
      parts.push(part(new THREE.BoxGeometry(2.2, 0.9, 1.4), 0x7d7872, mat(0, 0.3, 0)));
      col.push([0, 0, 1.2, 1]);
      return { solid: merge(parts), colliders: col, name: 'Standing Stones' };
    }
    case 'bigtree': {
      const L = biome.colors.leaves;
      return {
        solid: merge([
          part(new THREE.CylinderGeometry(0.9, 1.6, 9, 7), 0x5a3d2a, mat(0, 4.5, 0)),
          part(new THREE.CylinderGeometry(0.3, 0.5, 4, 5), 0x5a3d2a, mat(1.6, 8.5, 0, 0, 0, -0.7)),
          part(jitter(new THREE.IcosahedronGeometry(6, 0), rng, 0.3), L[1], mat(0, 12.5, 0, 0, 0, 0, 1, 0.7, 1)),
          part(jitter(new THREE.IcosahedronGeometry(4, 0), rng, 0.3), L[0], mat(3.5, 14, 1.5)),
          part(jitter(new THREE.IcosahedronGeometry(3.6, 0), rng, 0.3), L[2] ?? L[0], mat(-3, 14.5, -2)),
        ]),
        colliders: [[0, 0, 1.8, 20]],
        name: 'Ancient Tree',
      };
    }
    case 'wreck':
      return {
        solid: merge([
          part(new THREE.BoxGeometry(2, 0.9, 4.2), 0x8a4b2a, mat(0, 0.75, 0, 0.05, 0.4, 0.12)),
          part(new THREE.BoxGeometry(1.8, 0.9, 1.6), 0x7a4226, mat(0.3, 1.6, -0.6, 0.05, 0.4, 0.12)),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8), 0x2a2a2a, mat(-1.3, 0.4, 1.3, 0, 0.4, Math.PI / 2)),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8), 0x2a2a2a, mat(0.2, 0.35, 2.0, 0, 0.4, Math.PI / 2)),
          part(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 8), 0x2a2a2a, mat(2.2, 0.25, 3.5, 0.4, 0, 1.2)),
          part(new THREE.IcosahedronGeometry(0.7, 0), biome.colors.bush, mat(-0.6, 1.3, 1.2, 0, 0, 0, 1, 0.6, 1)),
        ]),
        colliders: [[0, 0, 2.2, 2.5]],
        name: 'Old Wreck',
      };
    case 'hoodoo':
      return {
        solid: merge([
          part(new THREE.CylinderGeometry(1.5, 2.4, 8, 7), rock, mat(0, 4, 0)),
          part(new THREE.CylinderGeometry(0.9, 1.4, 4, 6), 0xc98a5e, mat(0, 10, 0)),
          part(new THREE.CylinderGeometry(2.3, 1.6, 1.3, 7), 0x7d5a44, mat(0, 12.6, 0, 0.1, 0, 0.05)),
          part(new THREE.CylinderGeometry(0.9, 1.5, 4.5, 6), rock, mat(5, 2.2, 2)),
          part(new THREE.CylinderGeometry(1.4, 1, 0.8, 6), 0x7d5a44, mat(5, 4.8, 2)),
        ]),
        colliders: [[0, 0, 2.4, 14], [5, 2, 1.6, 5]],
        name: 'Hoodoos',
      };
    case 'ruin': {
      const parts = [part(new THREE.CylinderGeometry(3, 3.4, 8, 9), 0x9a948a, mat(0, 4, 0))];
      for (let i = 0; i < 9; i++) {
        if (i % 3 === 2) continue;
        const a = (i / 9) * Math.PI * 2;
        parts.push(part(new THREE.BoxGeometry(1.4, 1.2 + (i % 2) * 0.8, 0.8), 0x8a847a, mat(Math.cos(a) * 2.7, 8.6, Math.sin(a) * 2.7, 0, -a)));
      }
      for (let i = 0; i < 6; i++) {
        parts.push(part(new THREE.DodecahedronGeometry(rng.range(0.4, 0.8), 0), 0x8a847a, mat(rng.range(-6, 6), 0.2, rng.range(3.5, 6) * (i % 2 ? 1 : -1))));
      }
      parts.push(part(new THREE.BoxGeometry(1.2, 2, 0.4), 0x3a3530, mat(0, 1, 3.25)));
      return { solid: merge(parts), colliders: [[0, 0, 3.6, 10]], name: 'Watchtower Ruin' };
    }
    case 'cairn': {
      const parts = [];
      let y = 0;
      for (const r of [1.5, 1.15, 0.9, 0.65, 0.45]) {
        parts.push(part(jitter(new THREE.DodecahedronGeometry(r, 0), rng, 0.25), 0x8f8a84, mat(rng.range(-0.15, 0.15), y + r * 0.7, 0, 0, rng.next() * 3, 0, 1, 0.75, 1)));
        y += r * 1.25;
      }
      const flags = [0xe0533a, 0xe0b23a, 0x3a86d0, 0x6fae3a, 0xf1f0ea];
      flags.forEach((c, i) => parts.push(part(new THREE.BoxGeometry(0.5, 0.35, 0.03), c, mat(1 + i * 0.9, y - 0.6 - i * 0.35, 0, 0, 0, -0.35))));
      return { solid: merge(parts), colliders: [[0, 0, 1.7, y]], name: 'Summit Cairn' };
    }
    case 'totem':
    default: {
      const cols = [0x9c3b2e, 0x2f5d4a, 0xe0b23a, 0x3a5a8a, 0x9c3b2e];
      const parts = cols.map((c, i) => part(new THREE.BoxGeometry(1.1, 1.4, 1.1), c, mat(0, 0.7 + i * 1.4, 0)));
      parts.push(part(new THREE.BoxGeometry(3.6, 0.45, 0.6), 0x2f5d4a, mat(0, 5.8, 0.1)));
      parts.push(part(new THREE.BoxGeometry(0.35, 0.35, 0.2), 0xf1f0ea, mat(-0.3, 3.6, 0.6)));
      parts.push(part(new THREE.BoxGeometry(0.35, 0.35, 0.2), 0xf1f0ea, mat(0.3, 3.6, 0.6)));
      return { solid: merge(parts), colliders: [[0, 0, 1.0, 7]], name: 'Carved Totem' };
    }
  }
}

export const LANDMARK_NAMES = {
  arch: 'Stone Arch',
  stones: 'Standing Stones',
  bigtree: 'Ancient Tree',
  wreck: 'Old Wreck',
  hoodoo: 'Hoodoos',
  ruin: 'Watchtower Ruin',
  cairn: 'Summit Cairn',
  totem: 'Carved Totem',
};

export function buildPlank(length) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    parts.push(part(new THREE.BoxGeometry(0.58, 0.12, length), i % 2 ? 0xb08455 : 0xa07548, mat(-0.9 + i * 0.6, -0.06, 0)));
  }
  parts.push(part(new THREE.BoxGeometry(2.5, 0.1, 0.25), 0x7a5232, mat(0, -0.13, -length / 2 + 0.5)));
  parts.push(part(new THREE.BoxGeometry(2.5, 0.1, 0.25), 0x7a5232, mat(0, -0.13, length / 2 - 0.5)));
  return merge(parts);
}
