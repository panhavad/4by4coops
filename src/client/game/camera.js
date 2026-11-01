// Chase camera with drag-to-orbit, pinch/wheel zoom, terrain clearance and a few view modes.
import * as THREE from 'three';
import { damp, lerpAngle, clamp } from '../core/rng.js';

export const CAMERA_MODES = [
  { name: 'Chase', dist: 8.5, height: 3.0, fov: 62, look: 1.2 },
  { name: 'Far', dist: 15, height: 6.5, fov: 55, look: 1.0 },
  { name: 'High', dist: 22, height: 19, fov: 42, look: 0.5 },
];

const _f = new THREE.Vector3();
const _d = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.heading = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.zoom = 1;
    this.idle = 10;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.initialized = false;
    this.photo = false;
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    return CAMERA_MODES[this.mode].name;
  }

  snap() {
    this.initialized = false;
  }

  update(dt, car, orbit, terrain, world) {
    const m = CAMERA_MODES[this.mode];
    _f.set(0, 0, -1).applyQuaternion(car.quat);
    const flat = Math.hypot(_f.x, _f.z);
    const carHeading = flat > 0.25 ? Math.atan2(-_f.x, -_f.z) : this.heading;
    if (!this.initialized) this.heading = carHeading;
    if (!this.photo) this.heading = lerpAngle(this.heading, carHeading, 1 - Math.exp(-dt * 3.2));

    if (orbit.dx || orbit.dy) {
      this.orbitYaw -= orbit.dx * 0.006;
      this.orbitPitch = clamp(this.orbitPitch + orbit.dy * 0.004, -0.3, 1.25);
      this.idle = 0;
    } else this.idle += dt;
    this.zoom = clamp(this.zoom + orbit.zoom * 0.08, this.photo ? 0.35 : 0.55, this.photo ? 3 : 2.2);
    if (!this.photo && this.idle > 2.5 && !orbit.active) {
      this.orbitYaw = lerpAngle(this.orbitYaw, 0, 1 - Math.exp(-dt * 2));
      this.orbitPitch = damp(this.orbitPitch, 0, 2, dt);
    }

    const yaw = this.heading + this.orbitYaw;
    const dist = m.dist * this.zoom;
    const tx = car.pos.x;
    const ty = car.pos.y + m.look;
    const tz = car.pos.z;
    _d.set(tx + Math.sin(yaw) * dist, ty + m.height * this.zoom + this.orbitPitch * dist * 0.8, tz + Math.cos(yaw) * dist);
    // Rise over tree canopies that would hide the truck (cheap collider probe along the view line).
    let blocked = 0;
    if (world && this.mode < 2 && !this.photo) {
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const px = tx + (_d.x - tx) * t;
        const pz = tz + (_d.z - tz) * t;
        world.forColliders(px, pz, (c) => {
          if (c.type === 1 && (c.x - px) * (c.x - px) + (c.z - pz) * (c.z - pz) < 7) blocked = 1;
        });
      }
    }
    this.lift = damp(this.lift ?? 0, blocked, blocked ? 3 : 1, dt);
    _d.y += this.lift * 5.5;
    const gh = terrain.heightAt(_d.x, _d.z);
    if (_d.y < gh + 1.3) _d.y = gh + 1.3;

    if (!this.initialized) {
      this.pos.copy(_d);
      this.target.set(tx, ty, tz);
      this.initialized = true;
    }
    const rate = this.photo ? 10 : 7;
    this.pos.x = damp(this.pos.x, _d.x, rate, dt);
    this.pos.y = damp(this.pos.y, _d.y, rate, dt);
    this.pos.z = damp(this.pos.z, _d.z, rate, dt);
    const gh2 = terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gh2 + 1.0) this.pos.y = gh2 + 1.0;
    this.target.x = damp(this.target.x, tx, 14, dt);
    this.target.y = damp(this.target.y, ty, 10, dt);
    this.target.z = damp(this.target.z, tz, 14, dt);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
    const fov = m.fov + (this.photo ? 0 : clamp(car.speed * 0.35, 0, 10));
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = damp(this.camera.fov, fov, 3, dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
