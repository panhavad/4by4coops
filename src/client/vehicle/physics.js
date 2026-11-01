// Lightweight custom 4x4 physics: rigid body + 4 raycast wheels on the heightfield/planks.
// Runs at a fixed 120 Hz substep; no physics engine download needed.
import * as THREE from 'three';
import { SURF, SURF_GRIP, PLAY_HALF } from '../world/terrain.js';
import { clamp } from '../core/rng.js';

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const v3 = () => new THREE.Vector3();
const _up = v3();
const _fwd = v3();
const _right = v3();
const _anchor = v3();
const _dir = v3();
const _r = v3();
const _pv = v3();
const _f = v3();
const _wf = v3();
const _ws = v3();
const _p = v3();
const _t = v3();
const _n = v3();
const _tq = v3();
const _qInv = new THREE.Quaternion();
const _g = { h: 0, nx: 0, ny: 1, nz: 0, surface: 0 };

export const CAR = {
  mass: 1450,
  wheelRadius: 0.42,
  anchorY: -0.18,
  wheels: [
    { x: -0.84, z: -1.32, front: true },
    { x: 0.84, z: -1.32, front: true },
    { x: -0.84, z: 1.28, front: false },
    { x: 0.84, z: 1.28, front: false },
  ],
  winchPoint: new THREE.Vector3(0, -0.05, -2.25),
  circles: [-1.4, 0, 1.4],
  circleR: 1.0,
  hull: [
    [-0.92, -0.34, -2.1], [0.92, -0.34, -2.1], [-0.92, -0.34, 2.1], [0.92, -0.34, 2.1],
    [-0.86, 1.02, -0.75], [0.86, 1.02, -0.75], [-0.86, 1.02, 1.6], [0.86, 1.02, 1.6],
    [0, 1.06, 0.4], [0, -0.1, -2.28], [0, -0.1, 2.28],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
};

export function integrateQuat(q, w, dt) {
  const hx = w.x * dt * 0.5;
  const hy = w.y * dt * 0.5;
  const hz = w.z * dt * 0.5;
  const { x, y, z, w: qw } = q;
  q.set(
    x + hx * qw + hy * z - hz * y,
    y + hy * qw + hz * x - hx * z,
    z + hz * qw + hx * y - hy * x,
    qw - hx * x - hy * y - hz * z,
  ).normalize();
}

/** Physics description of a plank from its top-surface centerline endpoints. */
export function plankPhysics(p) {
  const a = new THREE.Vector3(...p.a);
  const b = new THREE.Vector3(...p.b);
  const u = b.clone().sub(a);
  const len = u.length();
  u.divideScalar(len);
  const w = new THREE.Vector3().crossVectors(u, UP).normalize();
  const n = new THREE.Vector3().crossVectors(w, u).normalize();
  return { id: p.id, owner: p.owner, a, b, u, w, n, len, halfW: 1.25 };
}

export function yawOf(quat) {
  _fwd.set(0, 0, -1).applyQuaternion(quat);
  return Math.atan2(-_fwd.x, -_fwd.z);
}

export class VehiclePhysics {
  /**
   * env: { ground(x,z,out), heightAt(x,z), water, planks: [], cars: [], forColliders(x,z,fn) }
   */
  constructor(env) {
    this.env = env;
    this.pos = v3();
    this.quat = new THREE.Quaternion();
    this.vel = v3();
    this.angVel = v3();
    this.force = v3();
    this.torque = v3();
    const m = CAR.mass;
    const w = 1.9;
    const h = 1.5;
    const l = 4.3;
    this.invMass = 1 / m;
    this.invI = new THREE.Vector3(12 / (m * (h * h + l * l)), 12 / (m * (w * w + l * l)), 12 / (m * (w * w + h * h)));
    this.wheels = CAR.wheels.map((wh) => ({
      ...wh,
      anchor: new THREE.Vector3(wh.x, CAR.anchorY, wh.z),
      contact: v3(),
      normal: new THREE.Vector3(0, 1, 0),
      grounded: false,
      travel: 0.4,
      spin: 0,
      spinVel: 0,
      surface: 0,
      slip: 0,
      load: 0,
      inWater: false,
    }));
    this.input = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    this.steerAngle = 0;
    this.upgrades = { engine: 0, tires: 0, suspension: 0, winch: 0, planks: 0 };
    this.snorkel = false;
    this.gripScale = 1;
    this.winch = null;
    this.winchTension = 0;
    this.flooded = false;
    this.submerged = 0;
    this.groundedCount = 0;
    this.impact = 0;
    this.hullScrape = 0;
    this.applyUpgrades(this.upgrades);
  }

  applyUpgrades(u) {
    Object.assign(this.upgrades, u);
    const U = this.upgrades;
    this.engineForce = 9500 + 1700 * U.engine;
    this.maxSpeed = 21 + 2.5 * U.engine;
    this.mu = 1.05 + 0.1 * U.tires;
    this.restLength = 0.42 + 0.06 * U.suspension;
    this.stiffness = 26000;
    this.damping = 3300;
    this.winchRange = 22 + 8 * U.winch;
    this.winchForce = 21000 + 6000 * U.winch;
  }

  reset(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.quat.setFromAxisAngle(UP, yaw);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.winch = null;
    this.steerAngle = 0;
  }

  get speed() {
    return this.vel.length();
  }

  forwardSpeed() {
    return this.vel.dot(_fwd.set(0, 0, -1).applyQuaternion(this.quat));
  }

  upright() {
    return _up.set(0, 1, 0).applyQuaternion(this.quat).y;
  }

  /** Call once per frame before substeps. */
  updateSteering(dt) {
    const speed = Math.abs(this.forwardSpeed());
    const maxA = 0.62 - 0.4 * clamp(speed / 26, 0, 1);
    const target = this.input.steer * maxA;
    const rate = 4.5;
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);
    for (const w of this.wheels) w.spin += w.spinVel * dt;
  }

  addForceAt(f, p) {
    this.force.add(f);
    _tq.subVectors(p, this.pos).cross(f);
    this.torque.add(_tq);
  }

  /** v <- I_world^-1 v */
  applyInvInertia(v) {
    _qInv.copy(this.quat).invert();
    v.applyQuaternion(_qInv).multiply(this.invI).applyQuaternion(this.quat);
    return v;
  }

  applyImpulse(J, p) {
    this.vel.addScaledVector(J, this.invMass);
    _tq.subVectors(p, this.pos).cross(J);
    this.angVel.add(this.applyInvInertia(_tq));
  }

  step(dt) {
    const { pos, quat, vel, angVel, force, torque } = this;
    const m = CAR.mass;
    force.set(0, -G * m, 0);
    torque.set(0, 0, 0);
    _up.set(0, 1, 0).applyQuaternion(quat);
    _fwd.set(0, 0, -1).applyQuaternion(quat);
    _right.set(1, 0, 0).applyQuaternion(quat);
    const fwdSpeed = vel.dot(_fwd);
    const speed = vel.length();
    const inp = this.input;

    let drive = 0;
    let brake = 0;
    if (inp.throttle > 0.02) {
      if (fwdSpeed < -1) brake = inp.throttle;
      else drive = inp.throttle;
    }
    if (inp.brake > 0.02) {
      if (fwdSpeed > 1) brake = Math.max(brake, inp.brake);
      else drive -= inp.brake;
    }
    if (this.flooded) drive = 0;
    const idle = Math.abs(drive) < 0.02 && brake < 0.02;
    const hold = idle && speed < 1.2 && this.groundedCount >= 3 && !this.winch;
    const top = drive >= 0 ? this.maxSpeed : 9;
    const ratio = Math.min(Math.abs(fwdSpeed) / top, 1);
    const wheelDrive = (drive * this.engineForce * (1 - ratio * ratio)) / 4;

    const maxT = this.restLength + CAR.wheelRadius;
    let grounded = 0;
    for (const w of this.wheels) {
      _anchor.copy(w.anchor).applyQuaternion(quat).add(pos);
      _dir.copy(_up).negate();
      const t = this.cast(_anchor, _dir, w);
      if (!(t <= maxT)) {
        w.grounded = false;
        w.travel = this.restLength;
        w.load = 0;
        w.slip = 0;
        w.spinVel = w.spinVel * 0.995 + drive * 0.4;
        continue;
      }
      w.grounded = true;
      grounded++;
      const compression = maxT - t;
      w.travel = clamp(t - CAR.wheelRadius, 0, this.restLength);
      _r.subVectors(_anchor, pos);
      _pv.crossVectors(angVel, _r).add(vel);
      const compVel = -_pv.dot(_up);
      let fs = this.stiffness * compression + this.damping * compVel;
      if (compression > this.restLength) {
        fs += (compression - this.restLength) * this.stiffness * 10 + Math.max(0, compVel) * 6000;
      }
      fs = clamp(fs, 0, m * G * 3);
      _f.copy(_up).multiplyScalar(fs);
      this.addForceAt(_f, _anchor);
      w.load = fs;

      const n = w.normal;
      if (w.front) {
        const a = this.steerAngle;
        _wf.copy(_fwd).multiplyScalar(Math.cos(a)).addScaledVector(_right, Math.sin(a));
      } else _wf.copy(_fwd);
      _wf.addScaledVector(n, -_wf.dot(n));
      const lw = _wf.length();
      if (lw < 1e-4) continue;
      _wf.divideScalar(lw);
      _ws.crossVectors(_wf, n);
      _r.subVectors(w.contact, pos);
      _pv.crossVectors(angVel, _r).add(vel);
      const vLong = _pv.dot(_wf);
      const vLat = _pv.dot(_ws);
      const grip = this.mu * SURF_GRIP[w.surface] * this.gripScale * (w.inWater ? 0.85 : 1);
      let limit = grip * fs;
      let lat = -vLat * fs * 3.2;
      let lon = wheelDrive;
      const brakeMax = brake * 4200 + (!w.front ? inp.handbrake * 3800 : 0) + (hold ? 5200 : 0);
      if (brakeMax > 0) lon += clamp(-vLong * fs * 4, -brakeMax, brakeMax);
      lon -= vLong * 25;
      if (!w.front && inp.handbrake > 0.1) {
        lat *= 0.4;
        limit *= 0.7;
      }
      const tot = Math.sqrt(lon * lon + lat * lat);
      w.slip = 0;
      if (tot > limit) {
        const s = limit / tot;
        lon *= s;
        lat *= s;
        w.slip = 1 - s;
      }
      _f.copy(_wf).multiplyScalar(lon).addScaledVector(_ws, lat);
      // Apply tire forces part-way up toward the center of mass: far fewer rollovers.
      _p.copy(w.contact).addScaledVector(_up, -_r.dot(_up) * 0.55);
      this.addForceAt(_f, _p);
      w.spinVel = vLong / CAR.wheelRadius + (w.slip > 0.3 ? Math.sign(drive) * 10 * w.slip : 0);
    }
    this.groundedCount = grounded;

    force.addScaledVector(vel, -0.5 * speed);
    this.hullContacts();
    if (this.winch) this.applyWinch(dt);
    else this.winchTension = 0;
    this.applyWater(dt);

    vel.addScaledVector(force, dt / m);
    angVel.addScaledVector(this.applyInvInertia(_t.copy(torque)), dt);
    angVel.multiplyScalar(1 / (1 + dt * (grounded ? 0.6 : 0.25)));
    pos.addScaledVector(vel, dt);
    integrateQuat(quat, angVel, dt);
    this.collide();
    this.keepInBounds();
  }

  cast(o, d, w) {
    let t = this.castTerrain(o, d, w);
    for (const pl of this.env.planks) {
      const denom = pl.n.dot(d);
      if (denom > -0.2) continue;
      const tp = pl.n.dot(_t.subVectors(pl.a, o)) / denom;
      if (tp < -0.3 || tp >= t) continue;
      _p.copy(o).addScaledVector(d, tp).sub(pl.a);
      const along = _p.dot(pl.u);
      if (along < 0 || along > pl.len || Math.abs(_p.dot(pl.w)) > pl.halfW) continue;
      t = tp;
      w.normal.copy(pl.n);
      w.surface = SURF.WOOD;
      w.contact.copy(o).addScaledVector(d, tp);
    }
    w.inWater = w.contact.y < this.env.water;
    return t;
  }

  castTerrain(o, d, w) {
    let t = 0;
    const g = _g;
    for (let i = 0; i < 3; i++) {
      const px = o.x + d.x * t;
      const pz = o.z + d.z * t;
      this.env.ground(px, pz, g);
      const denom = g.nx * d.x + g.ny * d.y + g.nz * d.z;
      if (denom > -0.08) return Infinity;
      t = (g.nx * (px - o.x) + g.ny * (g.h - o.y) + g.nz * (pz - o.z)) / denom;
    }
    w.normal.set(g.nx, g.ny, g.nz);
    w.surface = g.surface;
    w.contact.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    return t;
  }

  hullContacts() {
    const m = CAR.mass;
    this.hullScrape = 0;
    for (const local of CAR.hull) {
      _p.copy(local).applyQuaternion(this.quat).add(this.pos);
      this.env.ground(_p.x, _p.z, _g);
      const depth = _g.h - _p.y;
      if (depth <= 0) continue;
      _n.set(_g.nx, _g.ny, _g.nz);
      const pen = depth * _g.ny;
      _r.subVectors(_p, this.pos);
      _pv.crossVectors(this.angVel, _r).add(this.vel);
      const vn = _pv.dot(_n);
      let fn = 90000 * pen - 7000 * vn;
      if (fn <= 0) continue;
      fn = Math.min(fn, m * G * 5);
      _f.copy(_n).multiplyScalar(fn);
      _pv.addScaledVector(_n, -vn);
      const vt = _pv.length();
      if (vt > 0.01) _f.addScaledVector(_pv, -Math.min(0.6 * fn, vt * 4000) / vt);
      this.addForceAt(_f, _p);
      this.hullScrape = Math.max(this.hullScrape, vt);
    }
  }

  applyWater(dt) {
    const wl = this.env.water;
    const depth = wl - (this.pos.y - 0.5);
    this.submerged = Math.max(0, depth);
    if (depth > 0) {
      const k = Math.min(depth / 1.6, 1);
      this.force.y += CAR.mass * G * 0.3 * k;
      this.force.addScaledVector(this.vel, -1100 * k);
      this.angVel.multiplyScalar(1 - Math.min(0.9, 1.5 * k * dt));
    }
    this.flooded = wl - this.pos.y > (this.snorkel ? 1.05 : 0.3);
  }

  winchPoint(out) {
    return out.copy(CAR.winchPoint).applyQuaternion(this.quat).add(this.pos);
  }

  attachWinch(anchor, info) {
    const d = this.winchPoint(_p).distanceTo(anchor);
    this.winch = { anchor, length: d, reel: true, info };
  }

  applyWinch(dt) {
    const w = this.winch;
    this.winchPoint(_p);
    _n.subVectors(w.anchor, _p);
    const dist = _n.length();
    if (dist < 3 || dist > this.winchRange + 8) {
      const reason = dist < 3 ? 'arrived' : 'snapped';
      this.winch = null;
      this.winchTension = 0;
      this.onWinchRelease?.(reason);
      return;
    }
    w.length = Math.min(w.length, dist);
    if (w.reel) w.length -= 1.9 * dt;
    w.length = Math.max(w.length, dist - 0.6);
    const stretch = dist - w.length;
    this.winchTension = 0;
    if (stretch <= 0) return;
    _n.divideScalar(dist);
    _r.subVectors(_p, this.pos);
    _pv.crossVectors(this.angVel, _r).add(this.vel);
    const away = -_pv.dot(_n);
    const F = Math.min(stretch * 40000 + Math.max(0, away) * 5000, this.winchForce);
    _f.copy(_n).multiplyScalar(F);
    this.addForceAt(_f, _p);
    this.winchTension = F / this.winchForce;
  }

  collide() {
    const pos = this.pos;
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    let fx = _fwd.x;
    let fz = _fwd.z;
    const fl = Math.sqrt(fx * fx + fz * fz);
    if (fl < 0.2) return;
    fx /= fl;
    fz /= fl;
    const bottom = pos.y - 0.7;
    this.env.forColliders(pos.x, pos.z, (c) => {
      if (c.top < bottom) return;
      for (const off of CAR.circles) {
        this.resolveCircle(pos.x + fx * off, pos.z + fz * off, CAR.circleR, c.x, c.z, c.r, 0, 0, 0.15);
      }
    });
    for (const o of this.env.cars) {
      if (Math.abs(o.y - pos.y) > 2.5) continue;
      for (const off of CAR.circles) {
        for (const oo of CAR.circles) {
          this.resolveCircle(pos.x + fx * off, pos.z + fz * off, CAR.circleR, o.x + o.fx * oo, o.z + o.fz * oo, CAR.circleR, o.vx, o.vz, 0.3);
        }
      }
    }
  }

  resolveCircle(cx, cz, cr, ox, oz, or, ovx, ovz, e) {
    const dx = cx - ox;
    const dz = cz - oz;
    const dd = dx * dx + dz * dz;
    const R = cr + or;
    if (dd >= R * R || dd < 1e-8) return;
    const d = Math.sqrt(dd);
    const nx = dx / d;
    const nz = dz / d;
    const pen = R - d;
    this.pos.x += nx * pen;
    this.pos.z += nz * pen;
    _p.set(ox + nx * or, this.pos.y, oz + nz * or);
    _r.subVectors(_p, this.pos);
    _pv.crossVectors(this.angVel, _r).add(this.vel);
    const vn = (_pv.x - ovx) * nx + (_pv.z - ovz) * nz;
    if (vn >= 0) return;
    _n.set(nx, 0, nz);
    _t.crossVectors(_r, _n);
    this.applyInvInertia(_t).cross(_r);
    const k = this.invMass + _n.dot(_t);
    const j = (-(1 + e) * vn) / k;
    this.applyImpulse(_n.multiplyScalar(j), _p);
    this.impact = Math.max(this.impact, -vn);
  }

  keepInBounds() {
    const L = PLAY_HALF + 40;
    const p = this.pos;
    if (Math.abs(p.x) > L) {
      p.x = Math.sign(p.x) * L;
      this.vel.x *= -0.3;
    }
    if (Math.abs(p.z) > L) {
      p.z = Math.sign(p.z) * L;
      this.vel.z *= -0.3;
    }
    const gh = this.env.heightAt(p.x, p.z);
    if (p.y < gh - 2.5 || !Number.isFinite(p.y)) {
      p.y = gh + 1.5;
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
      if (!Number.isFinite(this.quat.x)) this.quat.identity();
    }
  }
}
