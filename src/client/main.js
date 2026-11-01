import './style.css';
import { UI } from './ui/ui.js';
import { Sound } from './audio/audio.js';
import { Game } from './game/game.js';
import { sanitizeRoomCode } from '../shared/room.js';
import { VEHICLE_COLORS } from '../shared/constants.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'ridgeline:prefs';
const RESUME_KEY = 'ridgeline:resume';

const ADJ = ['Muddy', 'Dusty', 'Rocky', 'Mossy', 'Sunny', 'Misty', 'Trail', 'Ridge', 'Pine', 'Brave'];
const NOUN = ['Rover', 'Ranger', 'Scout', 'Crawler', 'Hopper', 'Nomad', 'Wanderer', 'Badger'];

function loadPrefs() {
  let p = {};
  try {
    p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    p = {};
  }
  // Client id is per tab (survives reloads) so several tabs/players can share one browser.
  let cid = sessionStorage.getItem('ridgeline:cid');
  if (!cid) {
    cid = crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('ridgeline:cid', cid);
  }
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    name: typeof p.name === 'string' && p.name ? p.name : `${rnd(ADJ)} ${rnd(NOUN)}`,
    color: Number.isInteger(p.color) ? p.color : Math.floor(Math.random() * VEHICLE_COLORS.length),
    acc: Number.isInteger(p.acc) ? p.acc : 0b10001,
    cid,
    quality: p.quality || 'auto',
  };
}
const savePrefs = ({ cid, ...p }) => localStorage.setItem(PREFS_KEY, JSON.stringify(p));

const prefs = loadPrefs();
savePrefs(prefs);
const ui = new UI();
const sound = new Sound();
let game = null;

if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

// ---------------------------------------------------------------- start screen
const nameInput = $('name');
nameInput.value = prefs.name;
nameInput.addEventListener('change', () => {
  prefs.name = nameInput.value.trim().slice(0, 16) || prefs.name;
  savePrefs(prefs);
});
ui.swatches($('colors'), prefs.color, (i) => {
  prefs.color = i;
  savePrefs(prefs);
});

for (const id of ['quality', 'quality2']) {
  const sel = $(id);
  sel.value = prefs.quality;
  sel.addEventListener('change', () => {
    prefs.quality = sel.value;
    savePrefs(prefs);
    for (const other of ['quality', 'quality2']) $(other).value = sel.value;
    if (game?.state) game.reloadForUpdate();
  });
}
for (const id of ['sound', 'sound2']) {
  const box = $(id);
  box.checked = sound.enabled;
  box.addEventListener('change', () => {
    sound.setEnabled(box.checked);
    for (const other of ['sound', 'sound2']) $(other).checked = box.checked;
  });
}

const params = new URLSearchParams(location.search);
const invited = sanitizeRoomCode(params.get('room') || '');
if (invited) {
  $('invite-code').textContent = invited;
  ui.show('invite', true);
  ui.show('btn-join-invite', true);
  $('btn-new').classList.remove('primary');
  $('code').value = invited;
}

function startGame(mode, room, resume) {
  $('start-error').textContent = '';
  prefs.name = nameInput.value.trim().slice(0, 16) || prefs.name;
  savePrefs(prefs);
  sound.start();
  if (!resume && document.body.classList.contains('touch')) {
    document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  if (!game) {
    game = new Game({ canvas: $('view'), ui, sound, prefs, savePrefs });
    game.handlers = { openMenu };
    // Handy for debugging from the browser console.
    window.ridgeline = game;
  } else {
    game.model.setColor(prefs.color);
    game.model.setAccessories(prefs.acc);
  }
  game.start(mode, room, resume);
}

$('btn-new').addEventListener('click', () => startGame('online', null));
$('btn-join-invite').addEventListener('click', () => startGame('online', invited));
$('btn-join').addEventListener('click', () => {
  const code = sanitizeRoomCode($('code').value);
  if (!code) {
    $('start-error').textContent = 'Room codes are 5 letters/numbers, e.g. K7PQX.';
    return;
  }
  startGame('online', code);
});
$('code').addEventListener('keydown', (e) => e.key === 'Enter' && $('btn-join').click());
$('btn-offline').addEventListener('click', () => startGame('offline'));

// ---------------------------------------------------------------- in-game menu
function openMenu() {
  if (!game?.state) return;
  $('menu-code').textContent = game.mode === 'offline' ? 'offline' : game.roomCode;
  $('btn-invite').classList.toggle('hidden', game.mode === 'offline');
  ui.show('menu', true);
}
const closeMenu = () => ui.show('menu', false);
$('btn-resume').addEventListener('click', closeMenu);
$('menu').addEventListener('click', (e) => e.target.id === 'menu' && closeMenu());
$('btn-camp').addEventListener('click', () => {
  game.returnToCamp();
  closeMenu();
});
$('btn-teammate').addEventListener('click', () => {
  game.jumpToTeammate();
  closeMenu();
});
$('btn-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => ui.toast('Fullscreen is not supported here - try "Add to Home Screen"'));
  closeMenu();
});
$('btn-invite').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${game.roomCode}`;
  const text = `Join my Ridgeline 4x4 expedition! Room ${game.roomCode}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Ridgeline 4x4', text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    ui.toast('📋 Invite link copied - send it to up to 3 friends');
  } catch (e) {
    if (e?.name !== 'AbortError') window.prompt('Share this link with your friends:', url);
  }
});
$('btn-leave').addEventListener('click', () => {
  closeMenu();
  game.leave();
  ui.showScreen('start');
});
$('btn-rest').addEventListener('click', () => game?.rest());

document.addEventListener('visibilitychange', () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.ctx.suspend();
  else sound.ctx.resume();
});

fetch('/version')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => v && ($('version').textContent = `build ${v.version}`))
  .catch(() => {});

// ---------------------------------------------------------------- resume after an auto-update reload
let resume = null;
try {
  resume = JSON.parse(sessionStorage.getItem(RESUME_KEY));
} catch {
  resume = null;
}
sessionStorage.removeItem(RESUME_KEY);
if (resume && Date.now() - resume.t < 5 * 60 * 1000) {
  const unlock = () => sound.start();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  startGame(resume.mode === 'offline' ? 'offline' : 'online', resume.room, resume);
}
