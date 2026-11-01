// Unified input: keyboard, touch (floating steer pad + pedals + action buttons), gamepad, camera orbit.

const KEY_ACTIONS = {
  KeyR: 'recover',
  KeyQ: 'winch',
  KeyF: 'winch',
  KeyE: 'plank',
  KeyP: 'photo',
  KeyC: 'camera',
  KeyM: 'map',
  KeyJ: 'journal',
  Tab: 'journal',
  KeyH: 'horn',
  KeyG: 'interact',
  KeyT: 'emotes',
  Escape: 'menu',
  Enter: 'shutter',
  Space: 'space',
};
const PAD_ACTIONS = { 1: 'recover', 2: 'winch', 3: 'plank', 4: 'horn', 5: 'camera', 8: 'map', 9: 'menu', 12: 'photo', 13: 'interact', 14: 'journal' };

const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const toward = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

export class Input {
  constructor({ canvas, steerEl, gasEl, brakeEl, actionRoot }) {
    this.keys = new Set();
    this.actions = [];
    this.touch = { steer: 0, gas: false, brake: false };
    this.held = new Set();
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
    this.kbSteer = 0;
    this.orbit = { dx: 0, dy: 0, zoom: 0, active: false };
    this.padPrev = [];
    this.lastDevice = 'keyboard';

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) {
        const a = KEY_ACTIONS[e.code];
        if (a) this.actions.push(a);
        if (/^Digit[1-8]$/.test(e.code)) this.actions.push(`emote:${Number(e.code.slice(5)) - 1}`);
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touch.gas = this.touch.brake = false;
      this.touch.steer = 0;
      this.held.clear();
    });

    if (steerEl) this.bindSteer(steerEl);
    if (gasEl) this.bindPedal(gasEl, 'gas');
    if (brakeEl) this.bindPedal(brakeEl, 'brake');
    if (actionRoot) {
      actionRoot.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('[data-action],[data-hold]');
        if (!b) return;
        e.preventDefault();
        if (e.pointerType === 'touch') this.lastDevice = 'touch';
        if (b.dataset.hold) {
          this.held.add(b.dataset.hold);
          b.classList.add('down');
          const up = () => {
            this.held.delete(b.dataset.hold);
            b.classList.remove('down');
          };
          b.addEventListener('pointerup', up, { once: true });
          b.addEventListener('pointercancel', up, { once: true });
          b.addEventListener('pointerleave', up, { once: true });
        } else this.actions.push(b.dataset.action);
      });
      actionRoot.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.bindOrbit(canvas);
  }

  bindSteer(el) {
    const knob = el.querySelector('.knob');
    let id = null;
    let startX = 0;
    const range = () => Math.max(40, el.clientWidth * 0.32);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      startX = e.clientX;
      el.setPointerCapture(id);
      this.lastDevice = 'touch';
      el.classList.add('active');
      if (knob) knob.style.left = `${e.clientX - el.getBoundingClientRect().left}px`;
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = Math.max(-range(), Math.min(range(), e.clientX - startX));
      this.touch.steer = dx / range();
      if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), -50%)`;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.touch.steer = 0;
      el.classList.remove('active');
      if (knob) {
        knob.style.transform = '';
        knob.style.left = '';
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  bindPedal(el, key) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      this.touch[key] = true;
      this.lastDevice = 'touch';
      el.classList.add('down');
    });
    const end = () => {
      this.touch[key] = false;
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  bindOrbit(canvas) {
    const pts = new Map();
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      this.orbit.active = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        this.orbit.dx += e.clientX - p.x;
        this.orbit.dy += e.clientY - p.y;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.orbit.zoom += (pinch - d) * 0.01;
        pinch = d;
      }
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      pinch = 0;
      if (!pts.size) this.orbit.active = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.zoom += Math.sign(e.deltaY) * 0.6;
    }, { passive: false });
  }

  consumeOrbit() {
    const o = { dx: this.orbit.dx, dy: this.orbit.dy, zoom: this.orbit.zoom, active: this.orbit.active };
    this.orbit.dx = this.orbit.dy = this.orbit.zoom = 0;
    return o;
  }

  consumeActions() {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  update(dt) {
    const k = this.keys;
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.kbSteer) ? 9 : 3.4;
    this.kbSteer = toward(this.kbSteer, target, rate * dt);
    let steer = this.kbSteer;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let handbrake = k.has('Space') ? 1 : 0;

    if (Math.abs(this.touch.steer) > Math.abs(steer)) steer = this.touch.steer;
    if (this.touch.gas) throttle = 1;
    if (this.touch.brake) brake = 1;
    if (this.held.has('handbrake')) handbrake = 1;

    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] ?? 0;
      const gs = Math.abs(ax) > 0.12 ? (ax - Math.sign(ax) * 0.12) / 0.88 : 0;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (gs || rt > 0.05 || lt > 0.05) this.lastDevice = 'gamepad';
      if (Math.abs(gs) > Math.abs(steer)) steer = gs;
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      if (pad.buttons[0]?.pressed) handbrake = 1;
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padPrev[i] && PAD_ACTIONS[i]) this.actions.push(PAD_ACTIONS[i]);
        this.padPrev[i] = b.pressed;
      });
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.abs(rx) > 0.2) this.orbit.dx += rx * dt * 400;
      if (Math.abs(ry) > 0.2) this.orbit.dy += ry * dt * 300;
      break;
    }
    this.state.steer = clamp1(steer);
    this.state.throttle = Math.min(1, throttle);
    this.state.brake = Math.min(1, brake);
    this.state.handbrake = handbrake;
    return this.state;
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
