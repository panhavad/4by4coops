// Three.js view of a generated World: streamed terrain chunks (terrain + vegetation merged = 1 draw call),
// water, points of interest, meteorites, crates, portal and planks.
import * as THREE from 'three';
import { HALF, CELL, N, WORLD_SIZE } from './terrain.js';
import { CHUNK, CHUNKS } from './world.js';
import {
  buildVegetation, buildCamp, buildCabin, buildViewpoint, buildPortal, buildMeteor, buildCrate,
  buildLandmark, buildPlank,
} from './props.js';

const CELLS = CHUNK / CELL;

function toArrays(geo) {
  return {
    pos: geo.attributes.position.array,
    nor: geo.attributes.normal.array,
    col: geo.attributes.color.array,
    count: geo.attributes.position.count,
  };
}

const PORTAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PORTAL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uActive;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float swirl = sin(a * 5.0 + r * 14.0 - uTime * 3.0) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.2, 0.8, 1.0), vec3(0.65, 0.35, 1.0), swirl) * (1.25 - r * 0.6);
  col = mix(vec3(0.22, 0.22, 0.26), col, uActive);
  float alpha = smoothstep(1.0, 0.86, r) * mix(0.35, 0.85, uActive);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export class WorldView {
  constructor(scene, world, { shadows = false, viewRadius = 260 } = {}) {
    this.scene = scene;
    this.world = world;
    this.shadows = shadows;
    this.viewRadius = viewRadius;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.chunks = new Map();
    this.time = 0;
    const veg = buildVegetation(world.biome, world.seed);
    this.templates = {};
    for (const [k, g] of Object.entries(veg)) {
      if (Array.isArray(g)) g.forEach((gg, i) => (this.templates[`${k}${i}`] = toArrays(gg)));
      else this.templates[k] = toArrays(g);
    }
    this.buildWater();
    this.buildPOIs();
    this.planks = new Map();
  }

  // ---------------------------------------------------------------- terrain chunks
  update(dt, x, z, budgetMs = 6) {
    this.time += dt;
    const R = this.viewRadius;
    const want = [];
    const ci0 = Math.max(0, Math.floor((x - R + HALF) / CHUNK));
    const ci1 = Math.min(CHUNKS - 1, Math.floor((x + R + HALF) / CHUNK));
    const cj0 = Math.max(0, Math.floor((z - R + HALF) / CHUNK));
    const cj1 = Math.min(CHUNKS - 1, Math.floor((z + R + HALF) / CHUNK));
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        const key = cj * CHUNKS + ci;
        if (this.chunks.has(key)) continue;
        const d = this.chunkDist(ci, cj, x, z);
        if (d < R) want.push([d, ci, cj]);
      }
    }
    if (want.length) {
      want.sort((a, b) => a[0] - b[0]);
      const t0 = performance.now();
      for (const [, ci, cj] of want) {
        this.addChunk(ci, cj);
        if (performance.now() - t0 > budgetMs) break;
      }
    }
    for (const [key, mesh] of this.chunks) {
      const ci = key % CHUNKS;
      const cj = (key - ci) / CHUNKS;
      if (this.chunkDist(ci, cj, x, z) > R + CHUNK) {
        this.root.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
    this.animate(dt);
    return want.length;
  }

  /** Synchronously builds all chunks around a point (used while the loading screen is up). */
  prime(x, z) {
    while (this.update(0, x, z, 1e9) > 0);
  }

  chunkDist(ci, cj, x, z) {
    const x0 = -HALF + ci * CHUNK;
    const z0 = -HALF + cj * CHUNK;
    const dx = Math.max(x0 - x, 0, x - (x0 + CHUNK));
    const dz = Math.max(z0 - z, 0, z - (z0 + CHUNK));
    return Math.sqrt(dx * dx + dz * dz);
  }

  addChunk(ci, cj) {
    const geo = this.buildChunkGeometry(ci, cj);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    this.root.add(mesh);
    this.chunks.set(cj * CHUNKS + ci, mesh);
  }

  buildChunkGeometry(ci, cj) {
    const T = this.world.terrain;
    const items = this.world.items[cj * CHUNKS + ci];
    let count = CELLS * CELLS * 6;
    for (const it of items) count += this.templates[it.kind].count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Uint8Array(count * 3);
    const H = T.h;
    const c = [0, 0, 0];
    let o = 0;
    const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      T.colorAt((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3, ny, c);
      const r = Math.min(255, c[0] * 255 + 0.5);
      const g = Math.min(255, c[1] * 255 + 0.5);
      const b = Math.min(255, c[2] * 255 + 0.5);
      for (let v = 0; v < 3; v++) {
        const p = o * 3;
        pos[p] = v === 0 ? ax : v === 1 ? bx : cx;
        pos[p + 1] = v === 0 ? ay : v === 1 ? by : cy;
        pos[p + 2] = v === 0 ? az : v === 1 ? bz : cz;
        nor[p] = nx;
        nor[p + 1] = ny;
        nor[p + 2] = nz;
        col[p] = r;
        col[p + 1] = g;
        col[p + 2] = b;
        o++;
      }
    };
    const i0 = ci * CELLS;
    const j0 = cj * CELLS;
    for (let j = j0; j < j0 + CELLS; j++) {
      for (let i = i0; i < i0 + CELLS; i++) {
        const x0 = -HALF + i * CELL;
        const z0 = -HALF + j * CELL;
        const x1 = x0 + CELL;
        const z1 = z0 + CELL;
        const k = j * N + i;
        const h00 = H[k];
        const h10 = H[k + 1];
        const h01 = H[k + N];
        const h11 = H[k + N + 1];
        tri(x0, h00, z0, x1, h11, z1, x1, h10, z0);
        tri(x0, h00, z0, x0, h01, z1, x1, h11, z1);
      }
    }
    for (const it of items) {
      const t = this.templates[it.kind];
      const cs = Math.cos(it.rot);
      const sn = Math.sin(it.rot);
      const s = it.s;
      const tint = it.tint * 255;
      for (let v = 0; v < t.count; v++) {
        const q = v * 3;
        const p = o * 3;
        const lx = t.pos[q] * s;
        const lz = t.pos[q + 2] * s;
        pos[p] = it.x + cs * lx + sn * lz;
        pos[p + 1] = it.y + t.pos[q + 1] * s;
        pos[p + 2] = it.z - sn * lx + cs * lz;
        const nx = t.nor[q];
        const nz = t.nor[q + 2];
        nor[p] = cs * nx + sn * nz;
        nor[p + 1] = t.nor[q + 1];
        nor[p + 2] = -sn * nx + cs * nz;
        col[p] = Math.min(255, t.col[q] * tint);
        col[p + 1] = Math.min(255, t.col[q + 1] * tint);
        col[p + 2] = Math.min(255, t.col[q + 2] * tint);
        o++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.computeBoundingSphere();
    return geo;
  }

  // ---------------------------------------------------------------- water
  buildWater() {
    const w = this.world;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE + 600, WORLD_SIZE + 600);
    geo.rotateX(-Math.PI / 2);
    this.waterMaterial = new THREE.MeshPhongMaterial({
      color: w.biome.colors.water,
      transparent: true,
      opacity: 0.78,
      shininess: 90,
      specular: 0x555555,
    });
    this.water = new THREE.Mesh(geo, this.waterMaterial);
    this.water.position.y = w.water;
    this.water.receiveShadow = this.shadows;
    this.root.add(this.water);
  }

  // ---------------------------------------------------------------- points of interest
  addModel(model, x, y, z, yaw, colliderRef) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const solid = new THREE.Mesh(model.solid, this.material);
    solid.castShadow = this.shadows;
    solid.receiveShadow = this.shadows;
    g.add(solid);
    if (model.glow) {
      const glow = new THREE.Mesh(model.glow, this.glowMaterial);
      g.add(glow);
      g.userData.glow = glow;
    }
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const [dx, dz, r, h] of model.colliders) {
      this.world.addCollider(x + cs * dx + sn * dz, z - sn * dx + cs * dz, r, y + h, 3, colliderRef);
    }
    this.root.add(g);
    return g;
  }

  buildPOIs() {
    const w = this.world;
    this.poiObjects = new Map();
    const cabin = buildCabin();
    const tower = buildViewpoint();
    for (const p of w.pois) {
      let model;
      if (p.kind === 'camp') model = buildCamp();
      else if (p.kind === 'cabin') model = { ...cabin, solid: cabin.solid.clone() };
      else if (p.kind === 'viewpoint') model = { ...tower, solid: tower.solid.clone() };
      else if (p.kind === 'portal') model = buildPortal();
      else model = buildLandmark(p.type, w.biome, w.seed + p.x);
      const g = this.addModel(model, p.x, p.y, p.z, p.yaw, p);
      this.poiObjects.set(p.id, g);
      if (p.kind === 'camp') this.campfire = g.userData.glow;
      if (p.kind === 'portal') {
        this.portalMaterial = new THREE.ShaderMaterial({
          vertexShader: PORTAL_VERT,
          fragmentShader: PORTAL_FRAG,
          uniforms: { uTime: { value: 0 }, uActive: { value: 0 } },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const disk = new THREE.Mesh(new THREE.CircleGeometry(5.4, 32), this.portalMaterial);
        disk.position.y = 6.6;
        g.add(disk);
        this.portalRunes = g.userData.glow;
        this.portalRunes.visible = false;
        this.portal = p;
      }
    }
    cabin.solid.dispose();
    tower.solid.dispose();

    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xffb85a,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.CylinderGeometry(0.8, 1.8, 160, 10, 1, true);
    beamGeo.translate(0, 80, 0);
    this.meteorObjects = new Map();
    for (const m of w.meteors) {
      const g = this.addModel(buildMeteor(w.seed + m.x * 10), m.x, m.y, m.z, 0, m);
      const beam = new THREE.Mesh(beamGeo, this.beamMaterial);
      beam.frustumCulled = false;
      g.add(beam);
      this.meteorObjects.set(m.id, g);
    }
    this.crateObjects = new Map();
    for (const c of w.crates) {
      this.crateObjects.set(c.id, this.addModel(buildCrate(c.upgrade), c.x, c.y, c.z, c.yaw, c));
    }
  }

  removeMeteor(id) {
    const g = this.meteorObjects.get(id);
    if (!g) return;
    this.root.remove(g);
    this.meteorObjects.delete(id);
  }

  removeCrate(id) {
    const g = this.crateObjects.get(id);
    if (!g) return;
    this.root.remove(g);
    this.crateObjects.delete(id);
    this.world.removeColliders(g.position.x, g.position.z, (c) => c.ref?.id === id);
  }

  setPortalActive(active) {
    if (!this.portalMaterial) return;
    this.portalMaterial.uniforms.uActive.value = active ? 1 : 0;
    this.portalRunes.visible = active;
  }

  // ---------------------------------------------------------------- planks
  addPlank(p) {
    if (this.planks.has(p.id)) return;
    const a = new THREE.Vector3(...p.a);
    const b = new THREE.Vector3(...p.b);
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(buildPlank(len), this.material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    this.root.add(mesh);
    this.planks.set(p.id, mesh);
  }

  removePlank(id) {
    const m = this.planks.get(id);
    if (!m) return;
    this.root.remove(m);
    m.geometry.dispose();
    this.planks.delete(id);
  }

  animate(dt) {
    const t = this.time;
    if (this.portalMaterial) this.portalMaterial.uniforms.uTime.value = t;
    if (this.campfire) {
      const s = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
      this.campfire.scale.set(s, 1 + Math.sin(t * 9.1) * 0.15, s);
    }
    for (const g of this.meteorObjects.values()) {
      if (g.userData.glow) g.userData.glow.rotation.y += dt * 0.6;
    }
    this.beamMaterial.opacity = 0.22 + Math.sin(t * 2) * 0.06;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.material.dispose();
    this.glowMaterial.dispose();
    this.waterMaterial.dispose();
    this.beamMaterial.dispose();
    this.portalMaterial?.dispose();
    this.chunks.clear();
  }
}
