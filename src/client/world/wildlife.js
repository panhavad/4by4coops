// Wildlife: parametric low-poly animals. Wander paths are a function of the shared clock (so co-op
// players see the same herds); fleeing from the local car is a local offset.
import * as THREE from 'three';
import { part, merge, mat } from './props.js';
import { lerpAngle } from '../core/rng.js';

export const SPECS = {
  deer: { body: [0.5, 0.55, 1.25], color: 0xa0653a, belly: 0xe6d2b5, leg: 0.8, head: [0.26, 0.3, 0.45], neck: 0.55, ears: 'deer', antlers: 'deer', tail: 'short', speed: 7, flee: 28 },
  rabbit: { body: [0.26, 0.26, 0.42], color: 0x9a8670, belly: 0xe8e0d0, leg: 0.1, head: [0.2, 0.2, 0.24], ears: 'long', tail: 'puff', speed: 6, flee: 16, hop: true },
  fox: { body: [0.28, 0.3, 0.8], color: 0xd5651f, belly: 0xf3ece2, leg: 0.32, head: [0.24, 0.24, 0.32], ears: 'pointy', tail: 'bushy', tip: 0xf3ece2, speed: 7, flee: 22 },
  boar: { body: [0.55, 0.55, 1.1], color: 0x4b3a2d, leg: 0.3, head: [0.36, 0.36, 0.5], ears: 'pointy', tusks: true, tail: 'short', speed: 5, flee: 16 },
  moose: { body: [0.8, 0.9, 2.0], color: 0x3f2c1f, leg: 1.15, head: [0.36, 0.42, 0.75], neck: 0.4, antlers: 'moose', ears: 'deer', tail: 'short', speed: 5, flee: 22 },
  bear: { body: [0.95, 0.95, 1.7], color: 0x3e2b1e, leg: 0.5, head: [0.5, 0.48, 0.55], ears: 'round', tail: 'short', speed: 3, flee: 0 },
  beaver: { body: [0.38, 0.32, 0.65], color: 0x6b4a2b, leg: 0.08, head: [0.26, 0.22, 0.28], ears: 'round', tail: 'flat', speed: 2, flee: 12 },
  wolf: { body: [0.4, 0.45, 1.15], color: 0x8a8a8a, belly: 0xd6d6d6, leg: 0.6, head: [0.3, 0.3, 0.45], ears: 'pointy', tail: 'bushy', speed: 8, flee: 26 },
  coyote: { body: [0.34, 0.38, 0.95], color: 0xb59a6a, belly: 0xe9dcc5, leg: 0.5, head: [0.26, 0.26, 0.4], ears: 'pointy', tail: 'bushy', speed: 8, flee: 24 },
  bighorn: { body: [0.6, 0.6, 1.1], color: 0x9c7b55, belly: 0xece0ca, leg: 0.6, head: [0.3, 0.32, 0.42], horns: 'curl', tail: 'short', speed: 6, flee: 24 },
  tortoise: { shell: true, color: 0x6e6a3c, speed: 0.6, flee: 0 },
  goat: { body: [0.5, 0.55, 1.0], color: 0xf1efe8, leg: 0.6, head: [0.26, 0.3, 0.4], horns: 'straight', beard: true, tail: 'short', speed: 6, flee: 24 },
  marmot: { body: [0.32, 0.3, 0.5], color: 0x8b6b44, belly: 0xc9a77a, leg: 0.08, head: [0.24, 0.22, 0.24], ears: 'round', tail: 'short', speed: 4, flee: 16 },
  arcticfox: { body: [0.28, 0.3, 0.75], color: 0xeef2f5, leg: 0.3, head: [0.24, 0.24, 0.3], ears: 'pointy', tail: 'bushy', speed: 7, flee: 22 },
};

const darker = (hex, k = 0.75) =>
  (Math.round(((hex >> 16) & 255) * k) << 16) | (Math.round(((hex >> 8) & 255) * k) << 8) | Math.round((hex & 255) * k);

function buildAnimal(s) {
  const P = [];
  if (s.shell) {
    P.push(part(new THREE.SphereGeometry(0.5, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), s.color, mat(0, 0.1, 0, 0, 0, 0, 1, 0.8, 1.25)));
    P.push(part(new THREE.BoxGeometry(0.2, 0.17, 0.28), 0x8a8a5a, mat(0, 0.2, -0.72)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.15, 0.16, 0.15), 0x8a8a5a, mat(sx * 0.34, 0.08, sz * 0.42)));
    return merge(P);
  }
  const c = s.color;
  const belly = s.belly ?? c;
  const [bw, bh, bl] = s.body;
  const L = s.leg;
  const by = L + bh / 2;
  P.push(part(new THREE.BoxGeometry(bw, bh, bl), c, mat(0, by, 0)));
  if (s.belly) P.push(part(new THREE.BoxGeometry(bw * 0.92, bh * 0.3, bl * 0.86), belly, mat(0, by - bh * 0.38, 0)));
  const lw = Math.max(0.07, bw * 0.22);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      P.push(part(new THREE.BoxGeometry(lw, L + 0.06, lw), darker(c), mat(sx * (bw / 2 - lw / 2), L / 2, sz * (bl / 2 - lw * 0.8))));
    }
  }
  const [hw, hh, hl] = s.head;
  let hy = by + bh * 0.3;
  let hz = -bl / 2 - hl * 0.35;
  if (s.neck) {
    P.push(part(new THREE.BoxGeometry(bw * 0.42, s.neck + 0.2, bw * 0.42), c, mat(0, by + bh / 2 + s.neck / 2 - 0.12, -bl / 2 + 0.12, -0.35)));
    hy = by + bh / 2 + s.neck - 0.02;
    hz = -bl / 2 - hl * 0.25;
  }
  P.push(part(new THREE.BoxGeometry(hw, hh, hl), c, mat(0, hy, hz)));
  P.push(part(new THREE.BoxGeometry(hw * 0.62, hh * 0.5, hl * 0.4), belly, mat(0, hy - hh * 0.15, hz - hl * 0.6)));
  P.push(part(new THREE.BoxGeometry(hw * 1.02, hh * 0.12, hh * 0.12), 0x1a1a1a, mat(0, hy + hh * 0.15, hz - hl * 0.2)));
  for (const sx of [-1, 1]) {
    if (s.ears === 'long') P.push(part(new THREE.BoxGeometry(0.06, 0.34, 0.1), c, mat(sx * hw * 0.28, hy + hh / 2 + 0.16, hz + 0.03, 0, 0, sx * 0.12)));
    if (s.ears === 'pointy') P.push(part(new THREE.ConeGeometry(0.07, 0.17, 4), darker(c, 0.85), mat(sx * hw * 0.32, hy + hh / 2 + 0.07, hz + 0.04)));
    if (s.ears === 'round') P.push(part(new THREE.BoxGeometry(0.11, 0.11, 0.05), darker(c, 0.85), mat(sx * hw * 0.36, hy + hh / 2 + 0.04, hz + 0.05)));
    if (s.ears === 'deer') P.push(part(new THREE.BoxGeometry(0.08, 0.18, 0.05), c, mat(sx * hw * 0.55, hy + hh * 0.4, hz + 0.08, 0, 0, sx * -0.7)));
    if (s.antlers === 'deer') {
      P.push(part(new THREE.CylinderGeometry(0.025, 0.035, 0.62, 4), 0xcbb89a, mat(sx * 0.1, hy + hh / 2 + 0.3, hz + 0.05, 0, 0, sx * -0.35)));
      P.push(part(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 4), 0xcbb89a, mat(sx * 0.22, hy + hh / 2 + 0.45, hz - 0.05, 0.6, 0, sx * -0.2)));
    }
    if (s.antlers === 'moose') P.push(part(new THREE.BoxGeometry(0.62, 0.06, 0.38), 0xcbb89a, mat(sx * 0.42, hy + hh / 2 + 0.14, hz + 0.12, 0, 0, sx * 0.35)));
    if (s.horns === 'curl') P.push(part(new THREE.TorusGeometry(0.13, 0.05, 4, 8), 0xc9b28a, mat(sx * 0.18, hy + 0.06, hz + 0.1, 0, Math.PI / 2, 0)));
    if (s.horns === 'straight') P.push(part(new THREE.ConeGeometry(0.04, 0.3, 4), 0x3a3530, mat(sx * 0.08, hy + hh / 2 + 0.12, hz + 0.1, 0.5)));
    if (s.tusks) P.push(part(new THREE.BoxGeometry(0.04, 0.1, 0.04), 0xf0ead8, mat(sx * hw * 0.25, hy - hh * 0.3, hz - hl * 0.75)));
  }
  if (s.beard) P.push(part(new THREE.BoxGeometry(0.07, 0.18, 0.07), 0xffffff, mat(0, hy - hh * 0.6, hz - hl * 0.3)));
  if (s.tail === 'bushy') {
    P.push(part(new THREE.BoxGeometry(0.15, 0.15, 0.5), c, mat(0, by - 0.02, bl / 2 + 0.22, -0.55)));
    if (s.tip) P.push(part(new THREE.BoxGeometry(0.16, 0.16, 0.14), s.tip, mat(0, by - 0.2, bl / 2 + 0.45, -0.55)));
  } else if (s.tail === 'flat') {
    P.push(part(new THREE.BoxGeometry(0.24, 0.05, 0.38), 0x3a2a1a, mat(0, 0.1, bl / 2 + 0.17)));
  } else if (s.tail === 'puff') {
    P.push(part(new THREE.BoxGeometry(0.11, 0.11, 0.1), 0xffffff, mat(0, by + 0.04, bl / 2 + 0.04)));
  } else if (s.tail === 'short') {
    P.push(part(new THREE.BoxGeometry(0.08, 0.14, 0.08), darker(c, 0.9), mat(0, by + bh * 0.3, bl / 2 + 0.03, 0.4)));
  }
  return merge(P);
}

const VIEW_DIST = 170;
const _v = new THREE.Vector3();

export class Wildlife {
  constructor(scene, world, material, shadows) {
    this.scene = scene;
    this.world = world;
    this.material = material;
    this.shadows = shadows;
    this.geos = {};
    this.animals = world.animals.map((a) => ({ ...a, spec: SPECS[a.species], x: a.hx, z: a.hz, y: 0, yaw: 0, fx: 0, fz: 0, moving: 0, mesh: null, ready: false }));
  }

  geometry(species) {
    return (this.geos[species] ??= buildAnimal(SPECS[species]));
  }

  update(dt, tSec, carPos, carSpeed, camPos) {
    const T = this.world.terrain;
    const water = this.world.water;
    for (const a of this.animals) {
      const s = a.spec;
      const px = a.hx + Math.sin(tSec * a.f1 + a.p1) * a.R;
      const pz = a.hz + Math.sin(tSec * a.f2 + a.p2) * a.R;
      if (s.flee) {
        const dx = a.x - carPos.x;
        const dz = a.z - carPos.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        if (d < s.flee && carSpeed > 0.5) {
          const k = 0.6 + (s.flee - d) / s.flee;
          a.fx += (dx / d) * s.speed * k * dt;
          a.fz += (dz / d) * s.speed * k * dt;
        } else {
          a.fx *= 1 - Math.min(1, 0.05 * dt);
          a.fz *= 1 - Math.min(1, 0.05 * dt);
        }
      }
      let nx = px + a.fx;
      let nz = pz + a.fz;
      const h = T.heightAt(nx, nz);
      if (a.species !== 'beaver' && h < water + 0.3) {
        a.fx *= 0.9;
        a.fz *= 0.9;
        nx = a.x;
        nz = a.z;
      }
      const mx = nx - a.x;
      const mz = nz - a.z;
      const moved = Math.sqrt(mx * mx + mz * mz);
      if (!a.ready) {
        a.ready = true;
        a.yaw = Math.atan2(-mx, -mz);
      } else if (moved > 1e-4 && dt > 0) {
        a.yaw = lerpAngle(a.yaw, Math.atan2(-mx, -mz), 1 - Math.exp(-dt * 6));
      }
      a.moving = dt > 0 ? Math.min(1, moved / dt / 2) : 0;
      a.x = nx;
      a.z = nz;
      a.y = T.heightAt(nx, nz);
      const cdx = a.x - camPos.x;
      const cdz = a.z - camPos.z;
      const near = cdx * cdx + cdz * cdz < VIEW_DIST * VIEW_DIST;
      if (near && !a.mesh) {
        a.mesh = new THREE.Mesh(this.geometry(a.species), this.material);
        a.mesh.castShadow = this.shadows;
        this.scene.add(a.mesh);
      } else if (!near && a.mesh) {
        this.scene.remove(a.mesh);
        a.mesh = null;
      }
      if (a.mesh) {
        const bob = s.hop ? Math.abs(Math.sin(tSec * 9 + a.p1)) * 0.3 * a.moving : Math.abs(Math.sin(tSec * 10 + a.p1)) * 0.05 * a.moving;
        a.mesh.position.set(a.x, a.y + bob - 0.02, a.z);
        a.mesh.rotation.y = a.yaw;
      }
    }
  }

  /** Animals clearly visible from the camera (for the photo compendium). */
  inView(camera) {
    const T = this.world.terrain;
    const res = [];
    for (const a of this.animals) {
      if (!a.mesh) continue;
      const height = a.spec.shell ? 0.3 : a.spec.leg + a.spec.body[1] * 0.6;
      _v.set(a.x, a.y + height, a.z);
      const dist = _v.distanceTo(camera.position);
      if (dist > 75) continue;
      const target = _v.clone();
      _v.project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 0.85 || Math.abs(_v.y) > 0.85) continue;
      let blocked = false;
      for (let i = 1; i < 10 && !blocked; i++) {
        const t = i / 10;
        const x = camera.position.x + (target.x - camera.position.x) * t;
        const y = camera.position.y + (target.y - camera.position.y) * t;
        const z = camera.position.z + (target.z - camera.position.z) * t;
        if (T.heightAt(x, z) > y + 0.3) blocked = true;
      }
      if (!blocked) res.push({ species: a.species, dist, center: Math.hypot(_v.x, _v.y) });
    }
    return res.sort((p, q) => p.center - q.center);
  }

  dispose() {
    for (const a of this.animals) if (a.mesh) this.scene.remove(a.mesh);
    for (const g of Object.values(this.geos)) g.dispose();
  }
}
