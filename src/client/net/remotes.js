// Remote teammates: snapshot interpolation (with short extrapolation) + visual-only wheel suspension.
import * as THREE from 'three';
import { VehicleModel } from '../vehicle/model.js';
import { CAR } from '../vehicle/physics.js';

export const FLAG = { LIGHTS: 1, BRAKE: 2, FLOODED: 4, WINCH: 8 };
const DELAY = 0.13;

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _f = new THREE.Vector3();

export class RemoteCar {
  constructor(scene, info, cableMaterial) {
    this.scene = scene;
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
    this.acc = info.acc;
    this.model = new VehicleModel(info.color, info.acc);
    scene.add(this.model.group, this.model.shadow);
    this.buf = [];
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.steer = 0;
    this.flags = 0;
    this.winch = null;
    this.wheels = CAR.wheels.map(() => ({ travel: 0.3, spin: 0 }));
    this.has = false;
    this.emote = null;
    this.proxy = { x: 0, y: 0, z: 0, fx: 0, fz: -1, vx: 0, vz: 0 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cable = new THREE.Line(g, cableMaterial);
    this.cable.frustumCulled = false;
    this.cable.visible = false;
    scene.add(this.cable);
    this.model.group.visible = false;
    this.model.shadow.visible = false;
    if (info.d) this.push(info.d, performance.now() / 1000 - DELAY);
  }

  push(d, t) {
    if (!Array.isArray(d)) return;
    this.buf.push({ t, d });
    if (this.buf.length > 30) this.buf.shift();
  }

  setLook(info) {
    this.name = info.name ?? this.name;
    if (info.color !== undefined && info.color !== this.color) {
      this.color = info.color;
      this.model.setColor(info.color);
    }
    if (info.acc !== undefined) {
      this.acc = info.acc;
      this.model.setAccessories(info.acc);
    }
  }

  update(dt, now, env, night) {
    const b = this.buf;
    if (!b.length) return;
    const rt = now - DELAY;
    let k = -1;
    for (let j = b.length - 1; j >= 0; j--) {
      if (b[j].t <= rt) {
        k = j;
        break;
      }
    }
    if (k > 1) {
      b.splice(0, k - 1);
      k = 1;
    }
    let d;
    if (k === -1) {
      d = b[0].d;
      this.decode(d, 0, null, 0);
    } else if (k === b.length - 1) {
      d = b[k].d;
      this.decode(d, Math.min(rt - b[k].t, 0.3), null, 0);
    } else {
      const a = b[k];
      const c = b[k + 1];
      d = c.d;
      this.decode(a.d, 0, c.d, (rt - a.t) / Math.max(1e-3, c.t - a.t));
    }
    this.has = true;
    this.model.group.visible = true;
    this.model.shadow.visible = true;

    // Visual wheel travel from terrain under each wheel.
    _f.set(0, 0, -1).applyQuaternion(this.quat);
    const fwdSpeed = this.vel.dot(_f);
    let gnd = null;
    for (let i = 0; i < 4; i++) {
      const w = CAR.wheels[i];
      _a.set(w.x, CAR.anchorY, w.z).applyQuaternion(this.quat).add(this.pos);
      const h = env.heightAt(_a.x, _a.z);
      this.wheels[i].travel = Math.max(0, Math.min(0.5, _a.y - h - CAR.wheelRadius));
      this.wheels[i].spin += (fwdSpeed / CAR.wheelRadius) * dt;
    }
    gnd = env.ground(this.pos.x, this.pos.z, this._g ?? (this._g = {}));
    this.model.sync(this.pos, this.quat, this.steer, this.wheels, gnd);
    this.model.setNight((this.flags & FLAG.LIGHTS) ? night : 0);

    const flat = Math.hypot(_f.x, _f.z) || 1;
    Object.assign(this.proxy, { x: this.pos.x, y: this.pos.y, z: this.pos.z, fx: _f.x / flat, fz: _f.z / flat, vx: this.vel.x, vz: this.vel.z });

    if (this.winch) {
      const arr = this.cable.geometry.attributes.position.array;
      _a.copy(CAR.winchPoint).applyQuaternion(this.quat).add(this.pos);
      arr.set([_a.x, _a.y, _a.z, this.winch.x, this.winch.y, this.winch.z]);
      this.cable.geometry.attributes.position.needsUpdate = true;
      this.cable.visible = true;
    } else this.cable.visible = false;
  }

  decode(a, extra, c, t) {
    this.pos.set(a[0], a[1], a[2]);
    _q0.set(a[3], a[4], a[5], a[6]).normalize();
    this.vel.set(a[7], a[8], a[9]);
    this.steer = a[10];
    if (c) {
      this.pos.lerp(_a.set(c[0], c[1], c[2]), t);
      _q1.set(c[3], c[4], c[5], c[6]).normalize();
      _q0.slerp(_q1, t);
      this.vel.lerp(_a.set(c[7], c[8], c[9]), t);
      this.steer += (c[10] - this.steer) * t;
    }
    if (extra > 0) this.pos.addScaledVector(this.vel, extra);
    this.quat.copy(_q0);
    const src = c ?? a;
    this.flags = src[11] | 0;
    this.winch = this.flags & FLAG.WINCH && src.length >= 15 ? { x: src[12], y: src[13], z: src[14] } : null;
  }

  dispose() {
    this.scene.remove(this.model.group, this.model.shadow, this.cable);
    this.model.dispose();
    this.cable.geometry.dispose();
  }
}
