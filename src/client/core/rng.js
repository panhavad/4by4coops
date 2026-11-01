// Deterministic random helpers: every client must generate the exact same world from a seed.

export function hash32(...nums) {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h = Math.imul(h ^ (n >>> 0), 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Fast 2-int hash for hot loops. */
export function hash2(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  constructor(seed) {
    this.a = seed >>> 0;
  }
  next() {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
  /** Weighted pick from [[value, weight], ...]. */
  weighted(list) {
    let total = 0;
    for (const [, w] of list) total += w;
    let r = this.next() * total;
    for (const [v, w] of list) {
      r -= w;
      if (r <= 0) return v;
    }
    return list[list.length - 1][0];
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Yield to the event loop between heavy generation steps. MessageChannel isn't throttled in
// background tabs the way setTimeout is, so loading keeps going if the player switches tabs.
const yieldQueue = [];
let yieldChannel = null;
export function yieldTask() {
  if (typeof document === 'undefined' || typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  if (!yieldChannel) {
    yieldChannel = new MessageChannel();
    yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
  }
  return new Promise((r) => {
    yieldQueue.push(r);
    yieldChannel.port2.postMessage(0);
  });
}
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
