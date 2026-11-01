// DOM UI: HUD, toasts, world labels, minimap/full map, journal, garage, menus, loading screen.
import * as THREE from 'three';
import {
  VEHICLE_COLORS, ACCESSORIES, SPECIES, SPECIES_IDS, UPGRADE_KINDS, UPGRADE_NAMES, MAX_UPGRADE_LEVEL,
  EMOTES, METEORS_PER_REGION, hasAccessory,
} from '../../shared/constants.js';
import { BIOMES } from '../world/biomes.js';
import { HALF } from '../world/terrain.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const POI_ICON = { camp: '🏕️', cabin: '🏠', viewpoint: '🔭', landmark: '⭐', portal: '🌀', meteor: '☄️', crate: '📦' };
const UPGRADE_FX = {
  engine: (l) => `+${l * 1700} N pull · top speed ${Math.round((21 + 2.5 * l) * 3.6)} km/h`,
  tires: (l) => `Grip ×${(1 + l * 0.095).toFixed(2)}`,
  suspension: (l) => `${Math.round((0.42 + 0.06 * l) * 100)} cm travel`,
  winch: (l) => `${22 + 8 * l} m cable · ${21 + 6 * l} kN`,
  planks: (l) => `${2 + l} planks`,
};
const TIPS = [
  'Tip: slow and steady wins — this is a driving game, not a race.',
  'Tip: climb to a viewpoint to reveal nearby discoveries on your map.',
  'Tip: stuck? Winch to a tree, a rock — or a teammate.',
  'Tip: lay a plank across a deep stream to cross it.',
  'Tip: a snorkel (cabin garage) lets you ford deeper water.',
  'Tip: find 5 meteorites to power the portal to the next region.',
  'Tip: open photo mode and frame an animal to fill your compendium.',
];

const _v = new THREE.Vector3();

export class UI {
  constructor() {
    this.hud = $('hud');
    this.toastsEl = $('toasts');
    this.labelsEl = $('labels');
    this.labels = new Map();
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.bigmap = $('bigmap');
    this.mapImage = document.createElement('canvas');
    this.panel = null;
    this.handlers = {};
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closePanel()));
    document.querySelectorAll('#journal [data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.journalTab = b.dataset.tab;
        document.querySelectorAll('#journal [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        this.handlers.renderJournal?.();
      }),
    );
    this.journalTab = 'discover';
    $('emote-bar').innerHTML = EMOTES.map((e, i) => `<button data-action="emote:${i}">${e}</button>`).join('');
    this.bigmap.addEventListener('click', () => this.closePanel());
  }

  // ---------------------------------------------------------------- screens
  show(id, on = true) {
    $(id).classList.toggle('hidden', !on);
  }

  showScreen(name) {
    for (const id of ['start', 'loading', 'menu']) this.show(id, id === name);
  }

  setLoading(title, p, tip) {
    if (title) $('loading-title').textContent = title;
    if (p !== undefined) $('loading-bar').style.width = `${Math.round(p * 100)}%`;
    if (tip !== undefined) $('loading-tip').textContent = tip;
  }

  randomTip() {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  showHud(on) {
    this.hud.classList.toggle('hidden', !on);
  }

  get modalOpen() {
    return !!this.panel || !$('menu').classList.contains('hidden');
  }

  openPanel(id) {
    if (this.panel === id) return this.closePanel();
    this.closePanel();
    this.panel = id;
    this.show(id, true);
  }

  closePanel() {
    if (this.panel) this.show(this.panel, false);
    this.panel = null;
  }

  swatches(el, selected, onPick) {
    el.innerHTML = VEHICLE_COLORS.map(
      (c, i) => `<button class="swatch${i === selected ? ' on' : ''}" style="background:${hex(c)}" data-i="${i}" aria-label="Paint ${i + 1}"></button>`,
    ).join('');
    el.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b));
      onPick(Number(b.dataset.i));
    };
  }

  // ---------------------------------------------------------------- hud
  toast(text, ms = 3800) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.toastsEl.prepend(d);
    while (this.toastsEl.children.length > 4) this.toastsEl.lastChild.remove();
    setTimeout(() => d.classList.add('out'), ms);
    setTimeout(() => d.remove(), ms + 600);
  }

  setPrompt(text) {
    const p = $('prompt');
    if (this._prompt === text) return;
    this._prompt = text;
    p.classList.toggle('hidden', !text);
    if (text) p.textContent = text;
  }

  setCenter(text) {
    const c = $('center-msg');
    if (this._center === text) return;
    this._center = text;
    c.classList.toggle('hidden', !text);
    if (text) c.textContent = text;
  }

  flash() {
    const f = $('flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  setText(id, text) {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }

  updateHud(h) {
    this.setText('speed', String(h.speed));
    this.setText('region-name', h.region);
    this.setText('sky-icons', ` ${h.timeIcon} ${h.weatherIcon}`);
    this.setText('objective', h.objective);
    this.setText('net-status', h.net);
    this.setText('plank-count', String(h.planks));
    this.setText('status-line', h.status);
    $('btn-winch').classList.toggle('on', h.winch);
    $('btn-interact').classList.toggle('hidden', !h.nearCabin);
    const obj = $('objective');
    obj.classList.toggle('ready', h.portalOpen);
  }

  setPlayers(list) {
    const html = list
      .map((p) => `<div class="pl"><i style="background:${hex(VEHICLE_COLORS[p.color] ?? 0xffffff)}"></i>${esc(p.name)}${p.me ? ' (you)' : ''}</div>`)
      .join('');
    if (html !== this._players) {
      this._players = html;
      $('players').innerHTML = html;
    }
  }

  /** items: [{key, pos: Vector3, text, cls}] */
  updateLabels(items, camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const seen = new Set();
    for (const it of items) {
      _v.copy(it.pos).project(camera);
      if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) continue;
      let el = this.labels.get(it.key);
      if (!el) {
        el = document.createElement('div');
        this.labelsEl.append(el);
        this.labels.set(it.key, el);
      }
      seen.add(it.key);
      const cls = `label ${it.cls ?? ''}`;
      if (el.className !== cls) el.className = cls;
      if (el.textContent !== it.text) el.textContent = it.text;
      el.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    for (const [k, el] of this.labels) {
      if (!seen.has(k)) {
        el.remove();
        this.labels.delete(k);
      }
    }
  }

  // ---------------------------------------------------------------- maps
  setMapImage(pixels, size = 256) {
    this.mapImage.width = this.mapImage.height = size;
    this.mapImage.getContext('2d').putImageData(new ImageData(pixels, size, size), 0, 0);
  }

  /** markers: [{x, z, icon, color?, dot?, heading?, me?}] */
  drawMap(ctx, size, cx, cz, range, markers, circle) {
    const img = this.mapImage;
    const scale = img.width / (HALF * 2);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    if (circle) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillStyle = '#2b3a3a';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    const sx = (cx - range + HALF) * scale;
    const sz = (cz - range + HALF) * scale;
    ctx.drawImage(img, sx, sz, range * 2 * scale, range * 2 * scale, 0, 0, size, size);
    const k = size / (range * 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of markers) {
      const x = (m.x - cx + range) * k;
      const y = (m.z - cz + range) * k;
      if (x < -10 || y < -10 || x > size + 10 || y > size + 10) continue;
      if (m.heading !== undefined) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-m.heading);
        ctx.fillStyle = m.color;
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 2;
        const s = m.me ? 9 : 7;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, s);
        ctx.lineTo(0, s * 0.5);
        ctx.lineTo(-s * 0.7, s);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
      } else if (m.dot) {
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(x, y, m.dot, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.font = `${m.size ?? 15}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        if (m.icon === '?') {
          ctx.fillStyle = 'rgba(20,24,28,0.75)';
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px system-ui, sans-serif';
        }
        ctx.fillText(m.icon, x, y);
      }
    }
    ctx.restore();
    if (circle) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText('N', size / 2, 10);
    }
  }

  renderMinimap(cx, cz, markers) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = this.minimap.clientWidth || 150;
    const size = Math.round(css * dpr);
    if (this.minimap.width !== size) this.minimap.width = this.minimap.height = size;
    this.mctx.setTransform(1, 0, 0, 1, 0, 0);
    this.mctx.scale(dpr, dpr);
    this.drawMap(this.mctx, css, cx, cz, 170, markers, true);
  }

  renderBigMap(regionName, markers) {
    const c = this.bigmap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const css = Math.min(c.parentElement.clientWidth - 24, c.parentElement.clientHeight - 110, 720);
    c.style.width = c.style.height = `${css}px`;
    c.width = c.height = Math.round(css * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMap(ctx, css, 0, 0, HALF - 40, markers.map((m) => ({ ...m, size: 18 })), false);
    $('map-region').textContent = regionName;
  }

  // ---------------------------------------------------------------- journal
  renderJournal(j) {
    const body = $('journal-body');
    document.querySelectorAll('#journal [data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === this.journalTab));
    if (this.journalTab === 'discover') {
      const rows = j.discoveries
        .map((d) => `<li class="${d.found ? 'found' : ''}"><span>${d.icon}</span>${d.found ? esc(d.name) : '???'}</li>`)
        .join('');
      body.innerHTML = `
        <h3>${esc(j.regionName)} <small>region ${j.region + 1}</small></h3>
        <div class="stats">
          <div><b>${j.meteors}/${METEORS_PER_REGION}</b>meteorites</div>
          <div><b>${j.crates}/5</b>supply crates</div>
          <div><b>${j.found}/${j.discoveries.length}</b>places</div>
          <div><b>${j.species}/${SPECIES_IDS.length}</b>species</div>
        </div>
        <ul class="disc">${rows}</ul>`;
    } else if (this.journalTab === 'wildlife') {
      const biomeName = (k) => BIOMES.find((b) => b.key === k)?.name ?? k;
      body.innerHTML = `<p class="tip">Open photo mode 📷 and frame an animal to record it. Shared with your whole team.</p><div class="species">${SPECIES_IDS.map(
        (id) =>
          `<div class="sp ${j.speciesSet.has(id) ? 'found' : ''}"><b>${j.speciesSet.has(id) ? esc(SPECIES[id].name) : '???'}</b><small>${esc(biomeName(SPECIES[id].biome))}</small></div>`,
      ).join('')}</div>`;
    } else if (this.journalTab === 'upgrades') {
      body.innerHTML = `<p class="tip">Open supply crates 📦 found in the wild. Upgrades are shared by the team.</p>${UPGRADE_KINDS.map((k) => {
        const l = j.upgrades[k] ?? 0;
        const pips = Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
        return `<div class="upg"><b>${esc(UPGRADE_NAMES[k])}</b><span class="pips">${pips}</span><small>${UPGRADE_FX[k](l)}</small></div>`;
      }).join('')}`;
    } else {
      body.innerHTML = j.photos.length
        ? `<div class="photos">${j.photos.map((p, i) => `<figure><img src="${p.url}" alt="photo ${i + 1}"><figcaption>${esc(p.label)}<button data-photo="${i}">Save</button></figcaption></figure>`).join('')}</div>`
        : '<p class="tip">No photos yet. Press 📷 to enter photo mode.</p>';
      body.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => this.handlers.savePhoto?.(Number(b.dataset.photo))));
    }
  }

  // ---------------------------------------------------------------- garage
  renderGarage(color, acc, onColor, onAcc) {
    this.swatches($('garage-colors'), color, onColor);
    const el = $('garage-acc');
    el.innerHTML = ACCESSORIES.map(
      (a, i) => `<label class="acc"><input type="checkbox" data-bit="${i}" ${hasAccessory(acc, a.key) ? 'checked' : ''}/> ${esc(a.name)}</label>`,
    ).join('');
    el.onchange = () => {
      let mask = 0;
      el.querySelectorAll('input').forEach((inp) => {
        if (inp.checked) mask |= 1 << Number(inp.dataset.bit);
      });
      onAcc(mask);
    };
  }
}

export { POI_ICON, esc, hex };
