// Authoritative co-op room state + message handling.
// Pure logic (no I/O) so it runs both on the Node server and in the browser (offline mode).
import {
  MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, NAME_MAX, VEHICLE_COLORS, ACCESSORIES,
  METEORS_PER_REGION, METEORS_TO_OPEN_PORTAL, PORTAL_COUNTDOWN_MS, UPGRADE_KINDS,
  MAX_UPGRADE_LEVEL, plankCapacity, SPECIES_IDS, EMOTES, DAY_LENGTH_MS, MORNING_PHASE, dayPhase,
} from './constants.js';

const POI_ID = /^[a-z]{1,2}\d{1,2}$/;
const METEOR_ID = /^m\d{1,2}$/;
const COORD_LIMIT = 600;

export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
  }
  return s;
}

export function sanitizeRoomCode(code) {
  if (typeof code !== 'string') return '';
  const c = code.trim().toUpperCase();
  if (c.length !== ROOM_CODE_LENGTH) return '';
  for (const ch of c) if (!ROOM_CODE_ALPHABET.includes(ch)) return '';
  return c;
}

export function sanitizeName(name) {
  const n = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, NAME_MAX);
  return n || 'Driver';
}

const sanitizeColor = (c) => {
  const n = Math.floor(Number(c));
  return n >= 0 && n < VEHICLE_COLORS.length ? n : 0;
};
const sanitizeAcc = (a) => Math.floor(Number(a)) & ((1 << ACCESSORIES.length) - 1) || 0;

function vec3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  for (const x of v) if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > COORD_LIMIT) return null;
  return v.map((x) => Math.round(x * 100) / 100);
}

export class Room {
  constructor({ code, seed, now = Date.now() } = {}) {
    this.code = code;
    this.seed = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.region = 0;
    // Start new expeditions in the morning.
    this.timeShift = Math.round((MORNING_PHASE - dayPhase(now, 0)) * DAY_LENGTH_MS);
    this.collected = new Set();
    this.discovered = new Set();
    this.crates = new Set();
    this.species = new Set();
    this.upgrades = Object.fromEntries(UPGRADE_KINDS.map((k) => [k, 0]));
    this.planks = new Map();
    this.plankSeq = 1;
    this.travelAt = 0;
    this.players = new Map();
    this.cids = new Map();
    this.nextId = 1;
    this.lastActive = now;
    this.dirty = true;
  }

  get size() {
    return this.players.size;
  }

  publicState() {
    return {
      seed: this.seed,
      region: this.region,
      timeShift: this.timeShift,
      collected: [...this.collected],
      discovered: [...this.discovered],
      crates: [...this.crates],
      species: [...this.species],
      upgrades: { ...this.upgrades },
      planks: [...this.planks.values()],
      travelAt: this.travelAt,
    };
  }

  publicPlayer(p) {
    return { id: p.id, name: p.name, color: p.color, acc: p.acc, d: p.state };
  }

  /** Returns { id, welcome, outs } or { error }. */
  join(cid, info, now = Date.now()) {
    cid = String(cid || '').slice(0, 64) || `anon-${Math.random()}`;
    let id = this.cids.get(cid);
    if (!(id && this.players.has(id)) && this.players.size >= MAX_PLAYERS) {
      return { error: 'This expedition is full (4 drivers max).' };
    }
    if (!id) {
      id = `p${this.nextId++}`;
      this.cids.set(cid, id);
      this.dirty = true;
    }
    const prev = this.players.get(id);
    const p = {
      id,
      name: sanitizeName(info?.name),
      color: sanitizeColor(info?.color),
      acc: sanitizeAcc(info?.acc),
      state: prev?.state ?? null,
      lastHorn: 0,
    };
    this.players.set(id, p);
    this.lastActive = now;
    const welcome = {
      t: 'welcome',
      id,
      room: this.code,
      now,
      state: this.publicState(),
      players: [...this.players.values()].filter((o) => o.id !== id).map((o) => this.publicPlayer(o)),
    };
    return { id, welcome, outs: [['others', { t: 'join', p: this.publicPlayer(p) }]] };
  }

  leave(id, now = Date.now()) {
    if (!this.players.delete(id)) return [];
    this.lastActive = now;
    return [['others', { t: 'leave', id }]];
  }

  /** Handle a client message. Returns a list of [target, message] where target is 'all' | 'others' | 'self'. */
  handle(id, msg, now = Date.now()) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg.t !== 'string') return [];
    this.lastActive = now;
    switch (msg.t) {
      case 's': {
        const d = msg.d;
        if (!Array.isArray(d) || d.length < 12 || d.length > 16) return [];
        for (const x of d) if (typeof x !== 'number' || !Number.isFinite(x)) return [];
        p.state = d;
        return [['others', { t: 's', id, d }]];
      }
      case 'collect': {
        const mid = String(msg.id);
        if (!METEOR_ID.test(mid) || Number(mid.slice(1)) >= METEORS_PER_REGION) return [];
        if (this.collected.has(mid)) return [];
        this.collected.add(mid);
        this.dirty = true;
        return [['all', { t: 'collect', id: mid, by: id, n: this.collected.size }]];
      }
      case 'discover': {
        const poi = String(msg.id);
        if (!POI_ID.test(poi)) return [];
        const key = `${this.region}:${poi}`;
        if (this.discovered.has(key)) return [];
        this.discovered.add(key);
        this.dirty = true;
        return [['all', { t: 'discover', id: poi, key, by: id }]];
      }
      case 'crate': {
        const cid = String(msg.id);
        const kind = String(msg.kind);
        if (!POI_ID.test(cid) || !UPGRADE_KINDS.includes(kind)) return [];
        const key = `${this.region}:${cid}`;
        if (this.crates.has(key)) return [];
        this.crates.add(key);
        this.upgrades[kind] = Math.min(MAX_UPGRADE_LEVEL, this.upgrades[kind] + 1);
        this.dirty = true;
        return [['all', { t: 'crate', id: cid, key, kind, level: this.upgrades[kind], by: id }]];
      }
      case 'photo': {
        const sp = String(msg.sp);
        if (!SPECIES_IDS.includes(sp) || this.species.has(sp)) return [];
        this.species.add(sp);
        this.dirty = true;
        return [['all', { t: 'photo', sp, by: id }]];
      }
      case 'plank+': {
        const a = vec3(msg.a);
        const b = vec3(msg.b);
        if (!a || !b) return [];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (len < 2 || len > 10) return [];
        let mine = 0;
        for (const pl of this.planks.values()) if (pl.owner === id) mine++;
        if (mine >= plankCapacity(this.upgrades.planks)) {
          return [['self', { t: 'toast', msg: 'No planks left - pick one up first.' }]];
        }
        const pl = { id: `k${this.plankSeq++}`, owner: id, a, b };
        this.planks.set(pl.id, pl);
        this.dirty = true;
        return [['all', { t: 'plank+', p: pl }]];
      }
      case 'plank-': {
        const pl = this.planks.get(String(msg.id));
        if (!pl) return [];
        this.planks.delete(pl.id);
        this.dirty = true;
        return [['all', { t: 'plank-', id: pl.id, by: id }]];
      }
      case 'horn': {
        if (now - p.lastHorn < 400) return [];
        p.lastHorn = now;
        return [['others', { t: 'horn', id }]];
      }
      case 'emote': {
        const e = Math.floor(Number(msg.e));
        if (!(e >= 0 && e < EMOTES.length)) return [];
        return [['all', { t: 'emote', id, e }]];
      }
      case 'look': {
        p.name = sanitizeName(msg.name);
        p.color = sanitizeColor(msg.color);
        p.acc = sanitizeAcc(msg.acc);
        return [['others', { t: 'look', id, name: p.name, color: p.color, acc: p.acc }]];
      }
      case 'portal': {
        if (this.travelAt || this.collected.size < METEORS_TO_OPEN_PORTAL) return [];
        this.travelAt = now + PORTAL_COUNTDOWN_MS;
        this.dirty = true;
        return [['all', { t: 'portal', at: this.travelAt, by: id }]];
      }
      case 'rest': {
        let delta = MORNING_PHASE - dayPhase(now, this.timeShift);
        if (delta < 0.02) delta += 1;
        this.timeShift = Math.round((this.timeShift + delta * DAY_LENGTH_MS) % DAY_LENGTH_MS);
        this.dirty = true;
        return [['all', { t: 'time', shift: this.timeShift, by: id }]];
      }
      case 'ping':
        return [['self', { t: 'pong', c: Number(msg.c) || 0, now }]];
      default:
        return [];
    }
  }

  /** Time-based updates (portal travel). */
  tick(now = Date.now()) {
    if (this.travelAt && now >= this.travelAt) {
      this.travelAt = 0;
      this.region += 1;
      this.collected.clear();
      this.planks.clear();
      for (const p of this.players.values()) p.state = null;
      this.dirty = true;
      return [['all', { t: 'region', state: this.publicState() }]];
    }
    return [];
  }

  toJSON() {
    return {
      code: this.code,
      seed: this.seed,
      region: this.region,
      timeShift: this.timeShift,
      collected: [...this.collected],
      discovered: [...this.discovered],
      crates: [...this.crates],
      species: [...this.species],
      upgrades: this.upgrades,
      planks: [...this.planks.values()],
      plankSeq: this.plankSeq,
      travelAt: this.travelAt,
      cids: [...this.cids],
      nextId: this.nextId,
      lastActive: this.lastActive,
    };
  }

  static fromJSON(o) {
    const r = new Room({ code: o.code, seed: o.seed, now: o.lastActive || Date.now() });
    r.region = o.region | 0;
    r.timeShift = Number(o.timeShift) || 0;
    r.collected = new Set(o.collected || []);
    r.discovered = new Set(o.discovered || []);
    r.crates = new Set(o.crates || []);
    r.species = new Set(o.species || []);
    for (const k of UPGRADE_KINDS) r.upgrades[k] = Math.min(MAX_UPGRADE_LEVEL, o.upgrades?.[k] | 0);
    r.planks = new Map((o.planks || []).map((p) => [p.id, p]));
    r.plankSeq = o.plankSeq || r.planks.size + 1;
    r.travelAt = o.travelAt || 0;
    r.cids = new Map(o.cids || []);
    r.nextId = o.nextId || r.cids.size + 1;
    r.lastActive = o.lastActive || Date.now();
    r.dirty = false;
    return r;
  }
}
