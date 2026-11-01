// Low-poly 4x4 model built from boxes (paint mesh + detail mesh + light mesh + 4 wheels).
import * as THREE from 'three';
import { part, merge, mat } from '../world/props.js';
import { CAR } from './physics.js';
import { VEHICLE_COLORS, hasAccessory } from '../../shared/constants.js';

const BLACK = 0x26282b;
const GLASS = 0x2a3b4a;
const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

let wheelGeo = null;
let blobTexture = null;
const lightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
const detailMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

function getWheelGeometry() {
  if (!wheelGeo) {
    wheelGeo = merge([
      part(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 12), 0x1f1f22, mat(0, 0, 0, 0, 0, Math.PI / 2)),
      part(new THREE.CylinderGeometry(0.22, 0.22, 0.36, 8), 0xb8bcc2, mat(0, 0, 0, 0, 0, Math.PI / 2)),
      part(new THREE.BoxGeometry(0.37, 0.08, 0.5), 0x2c2c30, mat(0, 0, 0)),
    ]);
  }
  return wheelGeo;
}

function getBlobTexture() {
  if (!blobTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    blobTexture = new THREE.CanvasTexture(c);
  }
  return blobTexture;
}

function paintGeometry() {
  return merge([
    part(new THREE.BoxGeometry(1.86, 0.62, 4.1), 0xffffff, mat(0, -0.02, 0)),
    part(new THREE.BoxGeometry(1.72, 0.74, 2.35), 0xffffff, mat(0, 0.66, 0.42)),
    part(new THREE.BoxGeometry(1.5, 0.08, 1.3), 0xffffff, mat(0, 0.32, -1.35)),
  ]);
}

function detailGeometry(acc) {
  const parts = [
    part(new THREE.BoxGeometry(1.75, 0.42, 2.37), GLASS, mat(0, 0.67, 0.42)),
    part(new THREE.BoxGeometry(1.98, 0.26, 0.32), BLACK, mat(0, -0.2, -2.08)),
    part(new THREE.BoxGeometry(1.98, 0.26, 0.32), BLACK, mat(0, -0.2, 2.08)),
    part(new THREE.BoxGeometry(1.2, 0.3, 0.06), 0x1a1c1e, mat(0, 0.08, -2.06)),
    part(new THREE.BoxGeometry(0.14, 0.08, 1.9), BLACK, mat(-0.99, -0.34, 0.1)),
    part(new THREE.BoxGeometry(0.14, 0.08, 1.9), BLACK, mat(0.99, -0.34, 0.1)),
  ];
  for (const w of CAR.wheels) {
    parts.push(part(new THREE.BoxGeometry(0.24, 0.14, 1.08), BLACK, mat(Math.sign(w.x) * 0.99, 0.12, w.z)));
  }
  if (hasAccessory(acc, 'rack')) {
    parts.push(part(new THREE.BoxGeometry(0.06, 0.08, 2.1), BLACK, mat(-0.72, 1.08, 0.42)));
    parts.push(part(new THREE.BoxGeometry(0.06, 0.08, 2.1), BLACK, mat(0.72, 1.08, 0.42)));
    for (const z of [-0.45, 0.42, 1.3]) parts.push(part(new THREE.BoxGeometry(1.5, 0.05, 0.06), BLACK, mat(0, 1.1, z)));
    parts.push(part(new THREE.BoxGeometry(0.9, 0.28, 0.75), 0xa98a5c, mat(-0.2, 1.27, 0.75)));
    parts.push(part(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 6), 0x4a6a3a, mat(0.45, 1.2, 0.0, 0, 0, Math.PI / 2)));
  }
  if (hasAccessory(acc, 'lightbar')) {
    parts.push(part(new THREE.BoxGeometry(1.4, 0.14, 0.14), BLACK, mat(0, 1.12, -0.7)));
  }
  if (hasAccessory(acc, 'snorkel')) {
    parts.push(part(new THREE.BoxGeometry(0.12, 0.95, 0.12), BLACK, mat(0.93, 0.6, -0.72)));
    parts.push(part(new THREE.BoxGeometry(0.16, 0.14, 0.3), BLACK, mat(0.93, 1.12, -0.82)));
  }
  if (hasAccessory(acc, 'bullbar')) {
    parts.push(part(new THREE.BoxGeometry(0.08, 0.7, 0.08), 0x3a3d42, mat(-0.55, 0.1, -2.32)));
    parts.push(part(new THREE.BoxGeometry(0.08, 0.7, 0.08), 0x3a3d42, mat(0.55, 0.1, -2.32)));
    parts.push(part(new THREE.BoxGeometry(1.3, 0.08, 0.08), 0x3a3d42, mat(0, 0.44, -2.32)));
    parts.push(part(new THREE.BoxGeometry(1.7, 0.08, 0.08), 0x3a3d42, mat(0, -0.05, -2.34)));
  }
  if (hasAccessory(acc, 'spare')) {
    parts.push(part(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 10), 0x1f1f22, mat(0, 0.4, 2.3, Math.PI / 2)));
    parts.push(part(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 8), 0xb8bcc2, mat(0, 0.4, 2.31, Math.PI / 2)));
  }
  return merge(parts);
}

function lightGeometry(acc) {
  const parts = [
    part(new THREE.BoxGeometry(0.34, 0.18, 0.05), 0xfff4c8, mat(-0.62, 0.1, -2.06)),
    part(new THREE.BoxGeometry(0.34, 0.18, 0.05), 0xfff4c8, mat(0.62, 0.1, -2.06)),
    part(new THREE.BoxGeometry(0.24, 0.16, 0.05), 0xd02a1e, mat(-0.74, 0.16, 2.06)),
    part(new THREE.BoxGeometry(0.24, 0.16, 0.05), 0xd02a1e, mat(0.74, 0.16, 2.06)),
  ];
  if (hasAccessory(acc, 'lightbar')) parts.push(part(new THREE.BoxGeometry(1.3, 0.08, 0.04), 0xfff8d8, mat(0, 1.12, -0.78)));
  return merge(parts);
}

export class VehicleModel {
  constructor(colorIndex = 0, acc = 0) {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.paintMaterial = new THREE.MeshLambertMaterial({ color: VEHICLE_COLORS[colorIndex] ?? VEHICLE_COLORS[0] });
    this.paint = new THREE.Mesh(paintGeometry(), this.paintMaterial);
    this.paint.castShadow = true;
    this.body.add(this.paint);
    this.detail = new THREE.Mesh(detailGeometry(acc), detailMaterial);
    this.detail.castShadow = true;
    this.body.add(this.detail);
    this.lights = new THREE.Mesh(lightGeometry(acc), lightMaterial);
    this.body.add(this.lights);
    this.acc = acc;
    this.colorIndex = colorIndex;
    this.wheels = CAR.wheels.map((w) => {
      const pivot = new THREE.Group();
      const mesh = new THREE.Mesh(getWheelGeometry(), detailMaterial);
      mesh.castShadow = true;
      if (w.x < 0) mesh.rotation.y = Math.PI;
      const spin = new THREE.Group();
      spin.add(mesh);
      pivot.add(spin);
      pivot.position.set(w.x, CAR.anchorY - 0.3, w.z);
      this.group.add(pivot);
      return { pivot, spin, def: w };
    });
    // Fake headlight beams (cheap; real light only for the local car).
    const beamGeo = new THREE.ConeGeometry(2.2, 14, 10, 1, true);
    beamGeo.translate(0, -7, 0);
    beamGeo.rotateX(Math.PI / 2);
    this.beamMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff1c0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMaterial);
    this.beam.position.set(0, 0.1, -2.1);
    this.beam.rotation.x = 0.12;
    this.beam.visible = false;
    this.body.add(this.beam);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 4.8),
      new THREE.MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.shadow.renderOrder = 1;
    this.shadow.matrixAutoUpdate = true;
  }

  setColor(i) {
    this.colorIndex = i;
    this.paintMaterial.color.setHex(VEHICLE_COLORS[i] ?? VEHICLE_COLORS[0]);
  }

  setAccessories(acc) {
    if (acc === this.acc) return;
    this.acc = acc;
    this.detail.geometry.dispose();
    this.detail.geometry = detailGeometry(acc);
    this.lights.geometry.dispose();
    this.lights.geometry = lightGeometry(acc);
  }

  setNight(k) {
    this.beam.visible = k > 0.05;
    this.beamMaterial.opacity = 0.11 * k;
  }

  /** Sync visuals: pose, wheel steer/spin/suspension travel. */
  sync(pos, quat, steerAngle, wheels, ground) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const s = wheels[i];
      w.pivot.position.y = CAR.anchorY - s.travel;
      w.pivot.rotation.y = w.def.front ? -steerAngle : 0;
      w.spin.rotation.x = -s.spin;
    }
    if (ground) {
      const h = ground.h;
      this.shadow.position.set(pos.x, h + 0.06, pos.z);
      const above = pos.y - h;
      this.shadow.material.opacity = Math.max(0, 1 - Math.max(0, above - 0.9) / 4);
      _n.set(ground.nx, ground.ny, ground.nz);
      _f.set(0, 0, -1).applyQuaternion(quat);
      _f.addScaledVector(_n, -_f.dot(_n));
      if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1);
      _f.normalize();
      _x.crossVectors(_f, _n);
      _m4.makeBasis(_x, _f, _n);
      this.shadow.quaternion.setFromRotationMatrix(_m4);
    }
  }

  dispose() {
    this.paint.geometry.dispose();
    this.detail.geometry.dispose();
    this.lights.geometry.dispose();
    this.paintMaterial.dispose();
    this.beamMaterial.dispose();
    this.beam.geometry.dispose();
    this.shadow.geometry.dispose();
    this.shadow.material.dispose();
  }
}
