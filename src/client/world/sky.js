// Sky dome, sun/moon lighting, fog, stars, clouds and weather particles. Day/night + weather are
// computed from the shared server clock, so every player in a room sees the same sky.
import * as THREE from 'three';
import { WEATHER } from './biomes.js';
import { Rng, hash32, smoothstep, clamp } from '../core/rng.js';

const KEYS = [
  // phase, sky top, horizon, sun color, sun intensity, hemi sky, hemi ground, hemi intensity
  [0.0, 0x0b1430, 0x1d2747, 0x9fb2e8, 0.7, 0x5a6c9c, 0x20242e, 1.35],
  [0.21, 0x16214a, 0x3b3a5e, 0x9fb2e8, 0.6, 0x5a6c9c, 0x20242e, 1.35],
  [0.255, 0x4b6fae, 0xf0a46c, 0xffb27a, 1.3, 0x8a9ac0, 0x4a4036, 1.5],
  [0.31, 0x4a8fd6, 0xbcdcf0, 0xfff0d8, 2.6, 0xb8d4f0, 0x5a5444, 1.9],
  [0.5, 0x3a86de, 0xcbe5f6, 0xffffff, 3.0, 0xc4dcf4, 0x5e5848, 2.0],
  [0.69, 0x4686d4, 0xd2e2ee, 0xfff0d8, 2.6, 0xb8d4f0, 0x5a5444, 1.9],
  [0.745, 0x5566a6, 0xf6985a, 0xff9858, 1.4, 0x8a8ab8, 0x4a3c34, 1.5],
  [0.79, 0x1c2350, 0x5a4468, 0x9fb2e8, 0.6, 0x5a6c9c, 0x20242e, 1.35],
  [1.0, 0x0b1430, 0x1d2747, 0x9fb2e8, 0.7, 0x5a6c9c, 0x20242e, 1.35],
].map(([p, ...r]) => [p, ...r.map((v, i) => ([3, 6].includes(i) ? v : new THREE.Color(v)))]);

const WEATHER_PERIOD = 300;

export function weatherAt(seed, region, biome, tSec) {
  const k = Math.floor(tSec / WEATHER_PERIOD);
  const kindFor = (n) => (n <= 0 ? 'clear' : new Rng(hash32(seed, region, n)).weighted(biome.weather));
  const cur = kindFor(k);
  const prev = kindFor(k - 1);
  const f = smoothstep(0, 45, tSec - k * WEATHER_PERIOD);
  const a = WEATHER[prev];
  const b = WEATHER[cur];
  const mix = {};
  for (const key of ['cloud', 'fog', 'rain', 'snow', 'grip', 'dust']) mix[key] = a[key] + (b[key] - a[key]) * f;
  mix.kind = cur;
  return mix;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform vec3 uMoonDir;
uniform float uMoonVis;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(min(h * 1.5, 1.0), 0.6)) : uHorizon * (1.0 + h * 1.5);
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 14.0) * 0.28) * uSunVis;
  float m = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, m) * uMoonVis;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RAIN_VERT = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform vec3 uCam;
varying float vA;
void main() {
  vec3 p = position;
  p.y = mod(p.y - uTime * 22.0, 36.0) + uCam.y - 14.0 + aEnd * 0.9;
  p.x = mod(p.x - uCam.x + 35.0, 70.0) - 35.0 + uCam.x + aEnd * 0.12;
  p.z = mod(p.z - uCam.z + 35.0, 70.0) - 35.0 + uCam.z;
  vA = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vA;
void main() {
  gl_FragColor = vec4(0.75, 0.82, 0.9, uOpacity * (0.25 + vA * 0.75));
  #include <colorspace_fragment>
}`;
const SNOW_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCam;
uniform float uScale;
void main() {
  vec3 p = position;
  p.y = mod(p.y - uTime * 2.4, 36.0) + uCam.y - 14.0;
  p.x += sin(uTime * 0.9 + position.y * 0.7) * 0.8;
  p.x = mod(p.x - uCam.x + 35.0, 70.0) - 35.0 + uCam.x;
  p.z = mod(p.z - uCam.z + 35.0, 70.0) - 35.0 + uCam.z;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uScale / -mv.z, 1.0, 8.0);
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FRAG = /* glsl */ `
uniform float uOpacity;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, uOpacity);
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, { shadows = false, viewDistance = 280 } = {}) {
    this.scene = scene;
    this.viewDistance = viewDistance;
    this.horizon = new THREE.Color();
    this.top = new THREE.Color();
    scene.fog = new THREE.Fog(0xcbe5f6, 60, viewDistance);
    scene.background = this.horizon;

    this.uniforms = {
      uTop: { value: this.top },
      uHorizon: { value: this.horizon },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunVis: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonVis: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = shadows;
    if (shadows) {
      const s = this.sun.shadow;
      s.mapSize.set(2048, 2048);
      s.camera.left = -60;
      s.camera.right = 60;
      s.camera.top = 60;
      s.camera.bottom = -60;
      s.camera.near = 1;
      s.camera.far = 400;
      s.bias = -0.0008;
      s.normalBias = 0.6;
    }
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xc4dcf4, 0x5e5848, 2);
    scene.add(this.hemi);

    const rng = new Rng(1234);
    const starPos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const u = rng.next() * 2 - 1;
      const a = rng.next() * Math.PI * 2;
      const y = Math.abs(u) * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      starPos.set([Math.cos(a) * r * 850, y * 850, Math.sin(a) * r * 850], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    this.buildClouds(rng);
    this.buildPrecipitation(rng);
    this.night = 0;
    this.phase = 0.3;
    this.weather = { ...WEATHER.clear, kind: 'clear' };
    this.sunDir = new THREE.Vector3();
  }

  buildClouds(rng) {
    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92 });
    this.clouds = [];
    const blob = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 3 + rng.int(4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(blob, this.cloudMaterial);
        const s = rng.range(14, 30);
        m.scale.set(s * 1.4, s * 0.6, s);
        m.position.set(k * 18 - n * 9 + rng.range(-5, 5), rng.range(-4, 4), rng.range(-8, 8));
        g.add(m);
      }
      g.userData.base = new THREE.Vector3(rng.range(-800, 800), rng.range(150, 230), rng.range(-800, 800));
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  buildPrecipitation(rng) {
    const n = 1600;
    const pos = new Float32Array(n * 2 * 3);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = rng.range(-35, 35);
      const y = rng.range(0, 36);
      const z = rng.range(-35, 35);
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.precipUniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uOpacity: { value: 0 }, uScale: { value: 300 } };
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({ vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, uniforms: this.precipUniforms, transparent: true, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) sp.set([rng.range(-35, 35), rng.range(0, 36), rng.range(-35, 35)], i * 3);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.snowUniforms = { ...this.precipUniforms, uOpacity: { value: 0 } };
    this.snow = new THREE.Points(
      sgeo,
      new THREE.ShaderMaterial({ vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, uniforms: this.snowUniforms, transparent: true, depthWrite: false }),
    );
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.scene.add(this.snow);
  }

  /** phase: 0..1 day phase; weather: blended params; focus: player position; camera: active camera. */
  update(dt, phase, weather, focus, camera, time) {
    this.phase = phase;
    this.weather = weather;
    let i = 0;
    while (i < KEYS.length - 2 && phase > KEYS[i + 1][0]) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = clamp((phase - a[0]) / (b[0] - a[0]), 0, 1);
    this.top.copy(a[1]).lerp(b[1], t);
    this.horizon.copy(a[2]).lerp(b[2], t);
    const sunColor = this.uniforms.uSunColor.value.copy(a[3]).lerp(b[3], t);
    let sunI = a[4] + (b[4] - a[4]) * t;
    this.hemi.color.copy(a[5]).lerp(b[5], t);
    this.hemi.groundColor.copy(a[6]).lerp(b[6], t);
    let hemiI = a[7] + (b[7] - a[7]) * t;

    const night = 1 - smoothstep(0.2, 0.27, phase) + smoothstep(0.74, 0.81, phase);
    this.night = clamp(night, 0, 1);

    // Weather: overcast greys the sky, dust tints it orange.
    const cloud = weather.cloud;
    const lum = 0.3 + 0.7 * (1 - this.night);
    _grey.setRGB(0.42 * lum, 0.46 * lum, 0.5 * lum);
    this.top.lerp(_grey, cloud * 0.75);
    this.horizon.lerp(_grey2.setRGB(0.55 * lum, 0.58 * lum, 0.6 * lum), cloud * 0.6);
    if (weather.dust > 0) {
      _grey.setRGB(0.75 * lum, 0.5 * lum, 0.3 * lum);
      this.top.lerp(_grey, weather.dust * 0.5);
      this.horizon.lerp(_grey, weather.dust * 0.7);
    }
    sunI *= 1 - cloud * 0.55;
    hemiI *= 1 - cloud * 0.15 * (1 - this.night);

    // Sun path: rises in the east (+x) at phase 0.25, sets in the west at 0.75.
    const ang = (phase - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.38).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uSunVis.value = smoothstep(-0.1, 0.05, this.sunDir.y) * (1 - cloud * 0.8);
    this.uniforms.uMoonDir.value.copy(this.sunDir).negate();
    this.uniforms.uMoonVis.value = smoothstep(-0.05, 0.1, -this.sunDir.y) * (1 - cloud);
    const lightDir = this.sunDir.y > -0.02 ? this.sunDir : this.uniforms.uMoonDir.value;
    this.sun.color.copy(sunColor);
    this.sun.intensity = sunI;
    this.hemi.intensity = hemiI;
    this.sun.position.copy(focus).addScaledVector(lightDir, 200);
    this.sun.position.y = Math.max(this.sun.position.y, focus.y + 15);
    this.sun.target.position.copy(focus);

    const fogK = weather.fog;
    this.scene.fog.color.copy(this.horizon);
    this.scene.fog.far = this.viewDistance * (0.25 + 0.75 * fogK);
    this.scene.fog.near = Math.min(this.scene.fog.far * 0.4, 50 * fogK + 10);

    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.starMaterial.opacity = this.night * (1 - cloud);

    const cloudsShown = Math.round(4 + cloud * 12);
    const wind = time * 4;
    this.cloudMaterial.color.setScalar(1 - cloud * 0.45);
    this.clouds.forEach((g, k) => {
      g.visible = k < cloudsShown;
      if (!g.visible) return;
      const base = g.userData.base;
      g.position.set(
        wrap(base.x + wind - camera.position.x, 1600) + camera.position.x,
        base.y,
        wrap(base.z + wind * 0.4 - camera.position.z, 1600) + camera.position.z,
      );
    });

    this.precipUniforms.uTime.value = time;
    this.precipUniforms.uCam.value.copy(camera.position);
    this.precipUniforms.uOpacity.value = weather.rain * 0.55;
    this.rain.visible = weather.rain > 0.02;
    this.snowUniforms.uOpacity.value = weather.snow * 0.9;
    this.snow.visible = weather.snow > 0.02;
  }
}

const _grey = new THREE.Color();
const _grey2 = new THREE.Color();
const wrap = (v, size) => ((((v + size / 2) % size) + size) % size) - size / 2;
