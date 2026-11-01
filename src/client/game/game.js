// Game orchestrator: renderer, world lifecycle, local car, teammates, interactions, HUD.
import * as THREE from 'three';
import {
  METEORS_TO_OPEN_PORTAL, METEORS_PER_REGION, UPGRADE_NAMES, SPECIES, EMOTES, plankCapacity, dayPhase,
  hasAccessory, VEHICLE_COLORS,
} from '../../shared/constants.js';
import { World, POI_RADIUS } from '../world/world.js';
import { WorldView } from '../world/scene.js';
import { Sky, weatherAt } from '../world/sky.js';
import { Wildlife } from '../world/wildlife.js';
import { biomeFor, WEATHER } from '../world/biomes.js';
import { VehiclePhysics, plankPhysics, yawOf } from '../vehicle/physics.js';
import { VehicleModel } from '../vehicle/model.js';
import { CameraRig } from './camera.js';
import { yieldTask } from '../core/rng.js';
import { Input } from '../input/input.js';
import { Net, LocalNet } from '../net/net.js';
import { RemoteCar, FLAG } from '../net/remotes.js';
import { POI_ICON } from '../ui/ui.js';

const STEP = 1 / 120;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export function resolveQuality(q) {
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const level = q === 'auto' || !q ? (mobile ? 'low' : 'high') : q;
  return level === 'high'
    ? { level, shadows: true, maxDpr: 2, viewDistance: 320, viewRadius: 330, antialias: true }
    : { level, shadows: false, maxDpr: 1.5, viewDistance: 230, viewRadius: 250, antialias: false };
}

export class Game {
  constructor({ canvas, ui, sound, prefs, savePrefs }) {
    this.ui = ui;
    this.sound = sound;
    this.prefs = prefs;
    this.savePrefs = savePrefs;
    this.q = resolveQuality(prefs.quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.antialias, powerPreference: 'high-performance' });
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.q.maxDpr);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2500);
    this.sky = new Sky(this.scene, { shadows: this.q.shadows, viewDistance: this.q.viewDistance });
    this.rig = new CameraRig(this.camera);
    this.input = new Input({
      canvas,
      steerEl: document.getElementById('steer'),
      gasEl: document.getElementById('gas'),
      brakeEl: document.getElementById('brake'),
      actionRoot: document.body,
    });
    this.env = { ground: () => {}, heightAt: () => 0, water: -1e9, planks: [], cars: [], forColliders: () => {} };
    this.car = new VehiclePhysics(this.env);
    this.car.onWinchRelease = (why) => this.ui.toast(why === 'arrived' ? '🪝 Winch reeled in' : '🪝 Cable slipped - too far');
    this.model = new VehicleModel(prefs.color, prefs.acc);
    this.scene.add(this.model.group, this.model.shadow);
    this.headlight = new THREE.SpotLight(0xfff1d0, 0, 80, 0.62, 0.55, 1.1);
    this.headlight.position.set(0, 0.2, -2.1);
    this.headlight.target.position.set(0, -2.5, -22);
    this.model.body.add(this.headlight, this.headlight.target);
    this.cableMaterial = new THREE.LineBasicMaterial({ color: 0x1d1d1d });
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cable = new THREE.Line(cg, this.cableMaterial);
    this.cable.frustumCulled = false;
    this.cable.visible = false;
    this.scene.add(this.cable);

    this.remotes = new Map();
    this.photos = [];
    this.pending = new Set();
    this.accum = 0;
    this.time = 0;
    this.netTimer = 0;
    this.hudTimer = 0;
    this.mapTimer = 0;
    this.fps = { t: 0, n: 0 };
    this.night = 0;
    this.weather = { ...WEATHER.clear, kind: 'clear' };
    this.lastRecover = -10;
    this.lastPortalSend = 0;
    this.emotes = new Map();
    this._g = { h: 0, nx: 0, ny: 1, nz: 0, surface: 0 };

    ui.handlers.renderJournal = () => this.renderJournal();
    ui.handlers.savePhoto = (i) => this.savePhoto(i);

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- session
  start(mode, room, resume) {
    this.mode = mode;
    this.resume = resume ?? null;
    const handlers = { onMessage: (m) => this.onMessage(m), onStatus: (s) => this.onNetStatus(s) };
    this.net = mode === 'offline' ? new LocalNet(handlers) : new Net(handlers);
    this.ui.showScreen('loading');
    this.ui.setLoading(mode === 'offline' ? 'Preparing expedition…' : 'Connecting…', 0.02, this.ui.randomTip());
    this.net.connect({ t: 'join', room: room || undefined, name: this.prefs.name, color: this.prefs.color, acc: this.prefs.acc, cid: this.prefs.cid });
    clearTimeout(this.joinTimer);
    if (mode !== 'offline') {
      this.joinTimer = setTimeout(() => {
        if (!this.state) this.fail('Could not reach the game server. You can still play offline.');
      }, 9000);
    }
  }

  fail(msg) {
    this.leave();
    this.ui.showScreen('start');
    document.getElementById('start-error').textContent = msg;
  }

  leave() {
    clearTimeout(this.joinTimer);
    this.net?.close();
    this.net = null;
    this.state = null;
    this.loadToken = (this.loadToken ?? 0) + 1;
    this.loading = false;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.disposeWorld();
    this.ui.showHud(false);
    this.ui.closePanel();
    this.ui.updateLabels([], this.camera);
    this.setPhotoMode(false);
    history.replaceState(null, '', location.pathname);
  }

  onNetStatus(s) {
    this.netStatus = s;
    if (s === 'replaced') this.fail('You joined this expedition from another tab or device.');
  }

  // ---------------------------------------------------------------- messages
  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        return this.onWelcome(m);
      case 'error':
        if (!this.state) this.fail(m.msg);
        else this.ui.toast(m.msg);
        return;
      case 'join':
        this.addRemote(m.p);
        this.ui.toast(`🚙 ${m.p.name} joined the expedition`);
        return;
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (r) {
          this.ui.toast(`👋 ${r.name} left`);
          r.dispose();
          this.remotes.delete(m.id);
        }
        return;
      }
      case 's':
        this.remotes.get(m.id)?.push(m.d, performance.now() / 1000);
        return;
      case 'look':
        this.remotes.get(m.id)?.setLook(m);
        return;
      case 'horn': {
        const r = this.remotes.get(m.id);
        if (r) this.sound.horn(Math.max(0, 1 - r.pos.distanceTo(this.car.pos) / 250));
        return;
      }
      case 'emote':
        this.emotes.set(m.id, { e: EMOTES[m.e], until: this.time + 4 });
        if (m.id !== this.myId) this.ui.toast(`${this.nameOf(m.id)}: ${EMOTES[m.e]}`, 2500);
        return;
      case 'toast':
        this.ui.toast(m.msg);
        return;
    }
    if (!this.state) return;
    const S = this.state;
    switch (m.t) {
      case 'collect': {
        S.collected.add(m.id);
        this.pending.delete(m.id);
        this.view?.removeMeteor(m.id);
        this.sound.chime();
        const n = S.collected.size;
        this.ui.toast(`☄️ ${this.nameOf(m.by)} found a meteorite (${Math.min(n, METEORS_TO_OPEN_PORTAL)}/${METEORS_TO_OPEN_PORTAL})`);
        if (n === METEORS_TO_OPEN_PORTAL) {
          this.ui.toast('🌀 The portal is powered! Drive into it to travel to a new region.', 6000);
          this.view?.setPortalActive(true);
        }
        break;
      }
      case 'discover': {
        S.discovered.add(m.key);
        this.pending.delete(m.id);
        const p = this.world?.pois.find((q) => q.id === m.id);
        if (p) {
          this.sound.discover();
          const extra = p.kind === 'viewpoint' ? ' - nearby places revealed on your map' : p.kind === 'cabin' ? ' - open the garage to customise' : '';
          this.ui.toast(`${POI_ICON[p.kind]} Discovered: ${p.name}${extra}`, 5000);
        }
        break;
      }
      case 'crate': {
        S.crates.add(m.key);
        this.pending.delete(m.id);
        S.upgrades[m.kind] = m.level;
        this.car.applyUpgrades(S.upgrades);
        this.view?.removeCrate(m.id);
        this.sound.upgrade();
        this.ui.toast(`📦 ${this.nameOf(m.by)} opened a crate: ${UPGRADE_NAMES[m.kind]} level ${m.level}`, 5000);
        break;
      }
      case 'photo':
        S.species.add(m.sp);
        this.ui.toast(`📸 New compendium entry: ${SPECIES[m.sp].name}${m.by === this.myId ? '' : ` (by ${this.nameOf(m.by)})`}`, 5000);
        this.sound.discover();
        break;
      case 'plank+':
        S.planks.set(m.p.id, m.p);
        this.view?.addPlank(m.p);
        this.env.planks.push(plankPhysics(m.p));
        this.sound.thud(3);
        break;
      case 'plank-':
        S.planks.delete(m.id);
        this.view?.removePlank(m.id);
        this.env.planks = this.env.planks.filter((p) => p.id !== m.id);
        break;
      case 'portal':
        S.travelAt = m.at;
        this.ui.toast(`🌀 ${this.nameOf(m.by)} entered the portal - the whole team travels soon!`, 5000);
        break;
      case 'region':
        this.state = toLocalState(m.state);
        this.pending.clear();
        this.loadRegion(null);
        break;
      case 'time':
        S.timeShift = m.shift;
        this.ui.toast(`🌅 ${this.nameOf(m.by)} rested at a cabin - a new day begins`);
        break;
    }
  }

  onWelcome(m) {
    clearTimeout(this.joinTimer);
    if (this.version && m.version !== this.version && this.mode !== 'offline') {
      this.reloadForUpdate();
      return;
    }
    this.version = m.version;
    this.myId = m.id;
    this.roomCode = m.room;
    if (this.mode !== 'offline') history.replaceState(null, '', `?room=${m.room}`);
    const prev = this.state;
    this.state = toLocalState(m.state);
    const keep = new Set(m.players.map((p) => p.id));
    for (const [id, r] of this.remotes) {
      if (!keep.has(id)) {
        r.dispose();
        this.remotes.delete(id);
      }
    }
    for (const p of m.players) {
      if (this.remotes.has(p.id)) this.remotes.get(p.id).setLook(p);
      else this.addRemote(p);
    }
    if (!this.world || !prev || prev.region !== this.state.region || prev.seed !== this.state.seed) {
      this.loadRegion(this.resume);
      this.resume = null;
    } else this.applyState();
  }

  addRemote(p) {
    if (p.id === this.myId || this.remotes.has(p.id)) return;
    this.remotes.set(p.id, new RemoteCar(this.scene, p, this.cableMaterial));
  }

  nameOf(id) {
    if (id === this.myId) return 'You';
    return this.remotes.get(id)?.name ?? 'A teammate';
  }

  reloadForUpdate() {
    if (this.reloading) return;
    this.reloading = true;
    const c = this.car;
    sessionStorage.setItem(
      'ridgeline:resume',
      JSON.stringify({ room: this.roomCode, mode: this.mode, region: this.state?.region, x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: yawOf(c.quat), t: Date.now() }),
    );
    this.ui.toast('✨ A new version was deployed - updating…');
    setTimeout(() => location.reload(), 900);
  }

  // ---------------------------------------------------------------- world lifecycle
  disposeWorld() {
    this.view?.dispose();
    this.wildlife?.dispose();
    this.view = null;
    this.wildlife = null;
    this.world = null;
  }

  async loadRegion(pose) {
    const token = (this.loadToken = (this.loadToken ?? 0) + 1);
    this.loading = true;
    this.setPhotoMode(false);
    this.ui.closePanel();
    const S = this.state;
    const biome = biomeFor(S.region);
    this.ui.showHud(false);
    this.ui.showScreen('loading');
    this.ui.setLoading(`Region ${S.region + 1}: ${biome.name}`, 0.03, this.ui.randomTip());
    await yieldTask();
    this.disposeWorld();
    const world = new World(S.region, S.seed);
    await world.generate((p) => this.ui.setLoading(undefined, 0.05 + p * 0.75));
    if (token !== this.loadToken) return;
    this.world = world;
    this.view = new WorldView(this.scene, world, { shadows: this.q.shadows, viewRadius: this.q.viewRadius });
    this.wildlife = new Wildlife(this.scene, world, this.view.material, this.q.shadows);
    Object.assign(this.env, {
      ground: (x, z, o) => world.terrain.sample(x, z, o),
      heightAt: (x, z) => world.terrain.heightAt(x, z),
      water: world.water,
      planks: [],
      forColliders: (x, z, fn) => world.forColliders(x, z, fn),
    });
    this.ui.setMapImage(world.mapPixels(256));
    this.applyState();
    if (pose && pose.region === S.region && Number.isFinite(pose.x)) {
      this.car.reset(pose.x, world.terrain.heightAt(pose.x, pose.z) + 1.2, pose.z, pose.yaw || 0);
    } else this.spawnAtCamp();
    this.rig.snap();
    let left = 1;
    const total = this.view.update(0, this.car.pos.x, this.car.pos.z, 0) + 1;
    while (left > 0 && token === this.loadToken) {
      left = this.view.update(0, this.car.pos.x, this.car.pos.z, 25);
      this.ui.setLoading(undefined, 0.8 + 0.2 * (1 - left / total));
      await yieldTask();
    }
    if (token !== this.loadToken) return;
    this.loading = false;
    this.ui.showScreen(null);
    this.ui.showHud(true);
    this.ui.toast(`📍 ${biome.name} - find ${METEORS_TO_OPEN_PORTAL} meteorites to power the portal`, 6000);
  }

  applyState() {
    const S = this.state;
    if (!this.world || !this.view) return;
    for (const m of this.world.meteors) if (S.collected.has(m.id)) this.view.removeMeteor(m.id);
    for (const c of this.world.crates) if (S.crates.has(`${S.region}:${c.id}`)) this.view.removeCrate(c.id);
    for (const id of [...this.view.planks.keys()]) if (!S.planks.has(id)) this.view.removePlank(id);
    for (const p of S.planks.values()) this.view.addPlank(p);
    this.env.planks = [...S.planks.values()].map(plankPhysics);
    this.view.setPortalActive(S.collected.size >= METEORS_TO_OPEN_PORTAL);
    this.car.applyUpgrades(S.upgrades);
  }

  spawnAtCamp() {
    const s = this.world.spawn;
    const slot = ((parseInt(String(this.myId).slice(1), 10) || 1) - 1) % 4;
    const x = s.x + [-6, -2, 2, 6][slot];
    this.car.reset(x, this.world.terrain.heightAt(x, s.z) + 1.0, s.z, 0);
  }

  // ---------------------------------------------------------------- main loop
  frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - (this.lastT ?? now));
    this.lastT = now;
    this.time += dt;
    if (!this.world || this.loading || !this.state) {
      if (this.world) this.renderer.render(this.scene, this.camera);
      return;
    }
    this.adaptResolution(dt);
    for (const a of this.input.consumeActions()) this.action(a);
    const inp = this.input.update(dt);
    const c = this.car;
    if (this.photoMode || this.ui.modalOpen) Object.assign(c.input, { steer: 0, throttle: 0, brake: 0, handbrake: 1 });
    else Object.assign(c.input, inp);
    c.gripScale = this.weather.grip;
    c.snorkel = hasAccessory(this.prefs.acc, 'snorkel');
    c.updateSteering(dt);
    this.env.cars = [];
    for (const r of this.remotes.values()) if (r.has) this.env.cars.push(r.proxy);
    if (c.winch?.info?.remote) {
      const r = this.remotes.get(c.winch.info.remote);
      if (r?.has) c.winch.anchor.set(r.pos.x, r.pos.y + 0.2, r.pos.z);
      else c.winch = null;
    }
    this.accum += dt;
    let n = 0;
    while (this.accum >= STEP && n < 12) {
      c.step(STEP);
      this.accum -= STEP;
      n++;
    }
    if (n >= 12) this.accum = 0;
    if (c.impact > 2.5) {
      this.sound.thud(c.impact);
      if (c.impact > 5) navigator.vibrate?.(Math.min(80, c.impact * 8));
    }
    c.impact = 0;
    if (c.submerged > 0.2 && !this.wasWet && c.speed > 2) this.sound.splash();
    this.wasWet = c.submerged > 0.2;

    const S = this.state;
    const serverNow = this.net.now();
    const tSec = serverNow / 1000;
    this.weather = weatherAt(S.seed, S.region, this.world.biome, tSec);
    const phase = dayPhase(serverNow, S.timeShift);
    this.sky.update(dt, phase, this.weather, c.pos, this.camera, this.time);
    this.night = this.sky.night;

    this.model.sync(c.pos, c.quat, c.steerAngle, c.wheels, this.env.ground(c.pos.x, c.pos.z, this._g));
    this.model.setNight(this.night);
    this.headlight.intensity = this.night * 40;
    this.updateCable();

    this.checkProximity(dt);
    this.netTimer += dt;
    const moving = c.speed > 0.05 || c.input.throttle || c.input.brake || c.input.steer;
    if (this.net.online && this.netTimer >= (moving ? 1 / 15 : 0.5)) {
      this.netTimer = 0;
      this.sendState();
    }
    for (const r of this.remotes.values()) r.update(dt, now, this.env, this.night);

    this.view.update(dt, c.pos.x, c.pos.z);
    this.wildlife.update(dt, tSec, c.pos, c.speed, this.camera.position);
    this.rig.update(dt, c, this.input.consumeOrbit(), this.world.terrain, this.world);
    this.updateAudio(dt);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      this.updateHud(phase);
    }
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 0.2;
      this.ui.renderMinimap(c.pos.x, c.pos.z, this.mapMarkers(false));
    }
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  adaptResolution(dt) {
    const f = this.fps;
    f.t += dt;
    f.n++;
    if (f.t < 2) return;
    const avg = f.t / f.n;
    f.t = 0;
    f.n = 0;
    if (avg > 1 / 40 && this.dpr > 0.6) this.dpr = Math.max(0.6, this.dpr * 0.85);
    else if (avg < 1 / 55 && this.dpr < this.maxDpr) this.dpr = Math.min(this.maxDpr, this.dpr * 1.1);
    else return;
    this.renderer.setPixelRatio(this.dpr);
  }

  updateCable() {
    const c = this.car;
    this.cable.visible = !!c.winch;
    if (!c.winch) return;
    c.winchPoint(_v);
    const a = c.winch.anchor;
    this.cable.geometry.attributes.position.array.set([_v.x, _v.y, _v.z, a.x, a.y, a.z]);
    this.cable.geometry.attributes.position.needsUpdate = true;
  }

  sendState() {
    const c = this.car;
    const flags = (this.night > 0.3 ? FLAG.LIGHTS : 0) | (c.input.brake > 0.1 ? FLAG.BRAKE : 0) | (c.flooded ? FLAG.FLOODED : 0) | (c.winch ? FLAG.WINCH : 0);
    const d = [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z), r3(c.quat.x), r3(c.quat.y), r3(c.quat.z), r3(c.quat.w), r2(c.vel.x), r2(c.vel.y), r2(c.vel.z), r2(c.steerAngle), flags];
    if (c.winch) d.push(r2(c.winch.anchor.x), r2(c.winch.anchor.y), r2(c.winch.anchor.z));
    this.net.send({ t: 's', d });
  }

  // ---------------------------------------------------------------- interactions
  checkProximity() {
    const S = this.state;
    const W = this.world;
    const p = this.car.pos;
    const near = (o, r) => (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < r * r && Math.abs((o.y ?? p.y) - p.y) < r + 4;
    for (const m of W.meteors) {
      if (!S.collected.has(m.id) && !this.pending.has(m.id) && near(m, 4.5)) {
        this.pending.add(m.id);
        this.net.send({ t: 'collect', id: m.id });
      }
    }
    for (const c of W.crates) {
      if (!S.crates.has(`${S.region}:${c.id}`) && !this.pending.has(c.id) && near(c, 4.2)) {
        this.pending.add(c.id);
        this.net.send({ t: 'crate', id: c.id, kind: c.upgrade });
      }
    }
    this.nearCabin = null;
    let prompt = null;
    for (const poi of W.pois) {
      if (poi.kind === 'camp') continue;
      const key = `${S.region}:${poi.id}`;
      if (!S.discovered.has(key) && !this.pending.has(poi.id) && near(poi, POI_RADIUS[poi.kind])) {
        this.pending.add(poi.id);
        this.net.send({ t: 'discover', id: poi.id });
      }
      if (poi.kind === 'cabin' && near(poi, 18)) {
        this.nearCabin = poi;
        prompt = this.input.lastDevice === 'touch' ? 'Cabin garage - tap 🔧 to customise your truck' : 'Cabin garage - press G to customise your truck';
      }
      if (poi.kind === 'portal' && near(poi, 30)) {
        const n = S.collected.size;
        if (n < METEORS_TO_OPEN_PORTAL) prompt = `The portal is dormant - it needs ${METEORS_TO_OPEN_PORTAL - n} more meteorite${METEORS_TO_OPEN_PORTAL - n > 1 ? 's' : ''}`;
        else if (!S.travelAt) {
          prompt = 'The portal hums with power - drive through it!';
          if (near(poi, 7) && this.time - this.lastPortalSend > 2) {
            this.lastPortalSend = this.time;
            this.net.send({ t: 'portal' });
          }
        }
      }
    }
    if (this.car.flooded) prompt = '💧 Engine flooded! Winch out or press Recover';
    else if (this.car.upright() < 0.35 && this.car.speed < 2) prompt = 'Stuck on your roof? Press Recover (R) or get a teammate to winch you';
    this.ui.setPrompt(prompt);
    if (S.travelAt) {
      const s = Math.max(0, Math.ceil((S.travelAt - this.net.now()) / 1000));
      this.ui.setCenter(`🌀 Traveling to ${biomeFor(S.region + 1).name} in ${s}…`);
    } else this.ui.setCenter(null);
  }

  action(a) {
    if (a.startsWith('emote:')) {
      this.net.send({ t: 'emote', e: Number(a.slice(6)) });
      this.ui.show('emote-bar', false);
      return;
    }
    if (this.photoMode && !['photo', 'shutter', 'space', 'menu'].includes(a)) return;
    switch (a) {
      case 'winch':
        return this.toggleWinch();
      case 'plank':
        return this.usePlank();
      case 'recover':
        return this.recover();
      case 'horn':
        this.sound.horn(1);
        this.net.send({ t: 'horn' });
        return;
      case 'camera':
        this.ui.toast(`🎥 ${this.rig.cycle()} camera`, 1500);
        return;
      case 'photo':
        return this.setPhotoMode(!this.photoMode);
      case 'shutter':
      case 'space':
        if (this.photoMode) this.takePhoto();
        return;
      case 'map':
        this.ui.openPanel('map-panel');
        if (this.ui.panel === 'map-panel') this.ui.renderBigMap(this.world.biome.name, this.mapMarkers(true));
        return;
      case 'journal':
        this.ui.openPanel('journal');
        if (this.ui.panel === 'journal') this.renderJournal();
        return;
      case 'interact':
        if (this.nearCabin) this.openGarage();
        return;
      case 'emotes':
        document.getElementById('emote-bar').classList.toggle('hidden');
        return;
      case 'menu':
        if (this.photoMode) return this.setPhotoMode(false);
        if (this.ui.panel) return this.ui.closePanel();
        this.handlers?.openMenu?.();
        return;
    }
  }

  toggleWinch() {
    const c = this.car;
    if (c.winch) {
      c.winch = null;
      this.ui.toast('🪝 Winch released', 1500);
      return;
    }
    const range = c.winchRange;
    const wp = c.winchPoint(new THREE.Vector3());
    _f.set(0, 0, -1).applyQuaternion(c.quat);
    let best = null;
    let bestScore = Infinity;
    const consider = (x, y, z, info) => {
      const dx = x - wp.x;
      const dz = z - wp.z;
      const flat = Math.hypot(dx, dz);
      const d = Math.hypot(flat, y - wp.y);
      if (d > range || d < 4) return;
      const front = (dx * _f.x + dz * _f.z) / (flat * Math.hypot(_f.x, _f.z) || 1);
      const score = d + (front < 0.3 ? 25 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y, z, info };
      }
    };
    const T = this.world.terrain;
    this.world.collidersInRadius(wp.x, wp.z, range, (col) => {
      const g = T.heightAt(col.x, col.z);
      consider(col.x, Math.min(col.top - 0.2, g + 1.0), col.z, { kind: col.type === 1 ? 'tree' : col.type === 2 ? 'rock' : 'anchor point' });
    });
    for (const r of this.remotes.values()) if (r.has) consider(r.pos.x, r.pos.y + 0.2, r.pos.z, { kind: 'car', remote: r.id, name: r.name });
    if (!best) {
      this.ui.toast(`🪝 Nothing to anchor to within ${range} m - find a tree, a rock or a teammate`);
      return;
    }
    c.attachWinch(new THREE.Vector3(best.x, best.y, best.z), best.info);
    const what = best.info.kind === 'car' ? best.info.name : best.info.kind === 'anchor point' ? 'an anchor point' : `a ${best.info.kind}`;
    this.ui.toast(`🪝 Winch hooked to ${what} - reeling in`, 2500);
  }

  usePlank() {
    const c = this.car;
    const S = this.state;
    let near = null;
    let nd = 7 * 7;
    for (const pl of this.env.planks) {
      const mx = (pl.a.x + pl.b.x) / 2 - c.pos.x;
      const mz = (pl.a.z + pl.b.z) / 2 - c.pos.z;
      const d = mx * mx + mz * mz;
      if (d < nd) {
        nd = d;
        near = pl;
      }
    }
    if (near) {
      this.net.send({ t: 'plank-', id: near.id });
      this.ui.toast('🪵 Plank picked up', 1500);
      return;
    }
    let mine = 0;
    for (const p of S.planks.values()) if (p.owner === this.myId) mine++;
    if (mine >= plankCapacity(S.upgrades.planks)) {
      this.ui.toast('🪵 No planks left - park next to one of yours and press Plank to pick it up');
      return;
    }
    if (c.speed > 3) {
      this.ui.toast('🪵 Slow down to lay a plank', 1500);
      return;
    }
    _f.set(0, 0, -1).applyQuaternion(c.quat);
    _f.y = 0;
    if (_f.lengthSq() < 0.05) return;
    _f.normalize();
    const T = this.world.terrain;
    const L = 7.5;
    const ax = c.pos.x + _f.x * 2.6;
    const az = c.pos.z + _f.z * 2.6;
    const bx = ax + _f.x * L;
    const bz = az + _f.z * L;
    const ha = T.heightAt(ax, az);
    const hb = T.heightAt(bx, bz);
    if (Math.abs(hb - ha) / L > 0.75) {
      this.ui.toast('🪵 Too steep for a plank here', 1800);
      return;
    }
    this.net.send({ t: 'plank+', a: [r2(ax), r2(ha + 0.12), r2(az)], b: [r2(bx), r2(hb + 0.12), r2(bz)] });
  }

  recover() {
    if (this.time - this.lastRecover < 3) {
      this.ui.toast('Recovery is cooling down…', 1200);
      return;
    }
    this.lastRecover = this.time;
    const c = this.car;
    const T = this.world.terrain;
    let { x, z } = c.pos;
    const water = this.world.water;
    if (T.heightAt(x, z) < water + 0.4) {
      outer: for (let r = 4; r <= 120; r += 4) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const tx = c.pos.x + Math.cos(a) * r;
          const tz = c.pos.z + Math.sin(a) * r;
          if (T.heightAt(tx, tz) > water + 1) {
            x = tx;
            z = tz;
            break outer;
          }
        }
      }
    }
    c.reset(x, T.heightAt(x, z) + 1.3, z, yawOf(c.quat));
    this.rig.snap();
    this.ui.toast('🔄 Truck recovered', 1500);
  }

  returnToCamp() {
    if (!this.world) return;
    this.spawnAtCamp();
    this.rig.snap();
  }

  jumpToTeammate() {
    const r = [...this.remotes.values()].find((q) => q.has);
    if (!r) {
      this.ui.toast('No teammates on the map yet - invite some friends!');
      return;
    }
    _f.set(0, 0, -1).applyQuaternion(r.quat);
    const x = r.pos.x - _f.x * 8;
    const z = r.pos.z - _f.z * 8;
    this.car.reset(x, this.world.terrain.heightAt(x, z) + 1.5, z, yawOf(r.quat));
    this.rig.snap();
  }

  // ---------------------------------------------------------------- photo mode
  setPhotoMode(on) {
    if (this.photoMode === on) return;
    this.photoMode = on;
    this.rig.photo = on;
    this.ui.show('photo-ui', on);
    this.ui.showHud(!on && !this.loading && !!this.world);
    this.ui.labelsEl.classList.toggle('hidden', on);
  }

  takePhoto() {
    const seen = this.wildlife.inView(this.camera);
    this.sound.shutter();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.88);
    this.ui.flash();
    let label = `${this.world.biome.name}`;
    if (seen.length) {
      const sp = seen[0].species;
      label = `${SPECIES[sp].name} · ${label}`;
      if (!this.state.species.has(sp)) this.net.send({ t: 'photo', sp });
      else this.ui.toast(`📸 Nice shot of a ${SPECIES[sp].name.toLowerCase()}!`, 2000);
    } else this.ui.toast('📸 Photo saved to your journal', 1800);
    this.photos.unshift({ url, label, t: Date.now() });
    if (this.photos.length > 12) this.photos.pop();
  }

  async savePhoto(i) {
    const p = this.photos[i];
    if (!p) return;
    const name = `ridgeline-${new Date(p.t).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
    try {
      const blob = await (await fetch(p.url)).blob();
      const file = new File([blob], name, { type: 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Ridgeline 4x4' });
        return;
      }
    } catch {
      // fall back to a download link
    }
    const a = document.createElement('a');
    a.href = p.url;
    a.download = name;
    a.click();
  }

  // ---------------------------------------------------------------- garage
  openGarage() {
    this.ui.openPanel('garage');
    this.ui.renderGarage(
      this.prefs.color,
      this.prefs.acc,
      (color) => this.setLook({ color }),
      (acc) => this.setLook({ acc }),
    );
  }

  setLook(change) {
    Object.assign(this.prefs, change);
    this.savePrefs(this.prefs);
    this.model.setColor(this.prefs.color);
    this.model.setAccessories(this.prefs.acc);
    this.net?.send({ t: 'look', name: this.prefs.name, color: this.prefs.color, acc: this.prefs.acc });
  }

  rest() {
    this.net?.send({ t: 'rest' });
    this.ui.closePanel();
  }

  // ---------------------------------------------------------------- hud / map / journal
  revealed(o) {
    const S = this.state;
    for (const v of this.world.pois) {
      if (v.kind !== 'viewpoint' || !S.discovered.has(`${S.region}:${v.id}`)) continue;
      if ((v.x - o.x) ** 2 + (v.z - o.z) ** 2 < 360 * 360) return true;
    }
    return (o.x - this.car.pos.x) ** 2 + (o.z - this.car.pos.z) ** 2 < 70 * 70;
  }

  mapMarkers(full) {
    const S = this.state;
    const W = this.world;
    const out = [];
    for (const p of W.pois) {
      const found = p.kind === 'camp' || S.discovered.has(`${S.region}:${p.id}`);
      if (found) out.push({ x: p.x, z: p.z, icon: POI_ICON[p.kind] });
      else if (p.kind === 'portal' || this.revealed(p)) out.push({ x: p.x, z: p.z, icon: p.kind === 'portal' ? POI_ICON.portal : '?' });
    }
    for (const m of W.meteors) if (!S.collected.has(m.id) && this.revealed(m)) out.push({ x: m.x, z: m.z, icon: POI_ICON.meteor });
    for (const c of W.crates) if (!S.crates.has(`${S.region}:${c.id}`) && this.revealed(c)) out.push({ x: c.x, z: c.z, icon: POI_ICON.crate });
    if (full) for (const p of S.planks.values()) out.push({ x: p.a[0], z: p.a[2], dot: 3, color: '#a07548' });
    for (const r of this.remotes.values()) {
      if (!r.has) continue;
      out.push({ x: r.pos.x, z: r.pos.z, heading: yawOf(r.quat), color: hexColor(r.color) });
    }
    out.push({ x: this.car.pos.x, z: this.car.pos.z, heading: yawOf(this.car.quat), color: hexColor(this.prefs.color), me: true });
    return out;
  }

  updateHud(phase) {
    const S = this.state;
    const c = this.car;
    const n = S.collected.size;
    const open = n >= METEORS_TO_OPEN_PORTAL;
    let mine = 0;
    for (const p of S.planks.values()) if (p.owner === this.myId) mine++;
    const timeIcon = phase < 0.22 || phase > 0.8 ? '🌙' : phase < 0.3 || phase > 0.72 ? '🌅' : '☀️';
    const peers = [...this.remotes.values()];
    const net =
      this.mode === 'offline'
        ? '⚪ Offline solo'
        : this.netStatus === 'online'
          ? `🟢 ${this.roomCode} · ${peers.length + 1}/4 drivers`
          : '🟠 Reconnecting…';
    let status = '';
    if (c.flooded) status = '💧 Engine flooded';
    else if (c.winch) status = `🪝 Winching · ${Math.round(c.winchTension * 100)}% load`;
    else if (c.submerged > 0.3) status = '🌊 Fording water';
    this.ui.updateHud({
      speed: Math.round(Math.abs(c.forwardSpeed()) * 3.6),
      region: this.world.biome.name,
      timeIcon,
      weatherIcon: WEATHER[this.weather.kind].icon,
      objective: open ? `🌀 Portal powered (${Math.min(n, METEORS_PER_REGION)}/${METEORS_PER_REGION} ☄️) - drive into it!` : `☄️ Meteorites ${n}/${METEORS_TO_OPEN_PORTAL} - follow the light beams`,
      portalOpen: open,
      net,
      planks: Math.max(0, plankCapacity(S.upgrades.planks) - mine),
      status,
      winch: !!c.winch,
      nearCabin: !!this.nearCabin,
    });
    this.ui.setPlayers([{ name: this.prefs.name, color: this.prefs.color, me: true }, ...peers.map((r) => ({ name: r.name, color: r.color }))]);
  }

  updateLabels() {
    if (this.photoMode) return;
    const items = [];
    for (const r of this.remotes.values()) {
      if (!r.has) continue;
      const e = this.emotes.get(r.id);
      const text = e && e.until > this.time ? `${e.e} ${r.name}` : r.name;
      items.push({ key: `r${r.id}`, pos: _v.copy(r.pos).setY(r.pos.y + 2.2).clone(), text, cls: 'name' });
    }
    const me = this.emotes.get(this.myId);
    if (me && me.until > this.time) items.push({ key: 'me', pos: this.car.pos.clone().setY(this.car.pos.y + 2.4), text: me.e, cls: 'emote' });
    const S = this.state;
    const p = this.car.pos;
    for (const poi of this.world.pois) {
      const d2 = (poi.x - p.x) ** 2 + (poi.z - p.z) ** 2;
      if (d2 > 90 * 90 || poi.kind === 'camp') continue;
      const found = S.discovered.has(`${S.region}:${poi.id}`);
      const h = poi.kind === 'viewpoint' ? 10 : poi.kind === 'portal' ? 14 : poi.kind === 'landmark' ? 9 : 7;
      items.push({ key: poi.id, pos: new THREE.Vector3(poi.x, poi.y + h, poi.z), text: found ? `${POI_ICON[poi.kind]} ${poi.name}` : '?', cls: found ? 'poi' : 'poi unknown' });
    }
    this.ui.updateLabels(items, this.camera);
  }

  renderJournal() {
    const S = this.state;
    const W = this.world;
    if (!S || !W) return;
    const discoveries = W.pois
      .filter((p) => p.kind !== 'camp')
      .map((p) => ({ icon: POI_ICON[p.kind], name: p.name, found: S.discovered.has(`${S.region}:${p.id}`) }));
    this.ui.renderJournal({
      regionName: W.biome.name,
      region: S.region,
      meteors: S.collected.size,
      crates: W.crates.filter((c) => S.crates.has(`${S.region}:${c.id}`)).length,
      discoveries,
      found: discoveries.filter((d) => d.found).length,
      species: S.species.size,
      speciesSet: S.species,
      upgrades: S.upgrades,
      photos: this.photos,
    });
  }

  updateAudio() {
    const c = this.car;
    const ratio = Math.min(1, Math.abs(c.forwardSpeed()) / c.maxSpeed);
    const g = ratio * 4.2;
    const gear = Math.min(3, Math.floor(g));
    const inGear = Math.min(1, g - gear);
    const thr = Math.max(c.input.throttle, c.input.brake);
    const rpm = Math.min(1, 0.12 + (gear === 3 ? Math.min(1, g - 3) : inGear) * 0.75 + thr * 0.15);
    let rough = 0;
    for (const w of c.wheels) rough += w.grounded ? (w.surface === 0 ? 0.4 : w.surface === 2 ? 0.6 : 0.2) + w.slip : 0;
    this.sound.update({
      rpm,
      throttle: c.flooded ? 0 : thr,
      speed: c.speed,
      rough: rough / 4,
      rain: this.weather.rain,
      winch: c.winch ? 0.3 + c.winchTension * 0.7 : 0,
      active: !this.loading,
    });
  }
}

const hexColor = (i) => '#' + (VEHICLE_COLORS[i] ?? 0xffffff).toString(16).padStart(6, '0');

function toLocalState(s) {
  return {
    seed: s.seed,
    region: s.region,
    timeShift: s.timeShift,
    collected: new Set(s.collected),
    discovered: new Set(s.discovered),
    crates: new Set(s.crates),
    species: new Set(s.species),
    upgrades: { ...s.upgrades },
    planks: new Map(s.planks.map((p) => [p.id, p])),
    travelAt: s.travelAt || 0,
  };
}
