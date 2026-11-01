// Multiplayer test bot: joins a room and drives circles around the first human player.
// Usage: node scripts/bot.mjs <ROOM> [ws://localhost:8088/ws] [seconds]
import WebSocket from 'ws';
import * as THREE from 'three';
import { World } from '../src/client/world/world.js';

const room = process.argv[2];
const url = process.argv[3] || 'ws://localhost:8088/ws';
const seconds = Number(process.argv[4] || 60);
if (!room) {
  console.error('usage: node scripts/bot.mjs <ROOM> [url] [seconds]');
  process.exit(1);
}

const ws = new WebSocket(url);
let world = null;
let target = null;
let angle = 0;
const g = { h: 0, nx: 0, ny: 1, nz: 0 };
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room, name: 'Bot Bessie', color: 5, acc: 31, cid: `bot-${Date.now()}` })));
ws.on('message', async (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    console.log(`joined ${m.room} as ${m.id}; region ${m.state.region}; ${m.players.length} other player(s)`);
    for (const p of m.players) if (p.d) target = { x: p.d[0], z: p.d[2] };
    world = new World(m.state.region, m.state.seed);
    await world.generate();
    console.log(`world generated; spawn ${world.spawn.x.toFixed(1)},${world.spawn.z.toFixed(1)}`);
    target ??= { x: world.spawn.x, z: world.spawn.z };
  } else if (m.t === 's' && !target) {
    target = { x: m.d[0], z: m.d[2] };
  } else if (m.t === 'horn') console.log(`horn from ${m.id}`);
  else if (m.t === 'emote' || m.t === 'collect' || m.t === 'plank+' || m.t === 'discover') console.log('event', JSON.stringify(m));
});

const R = 14;
const speed = 7;
const start = Date.now();
setInterval(() => {
  if (!world || !target || ws.readyState !== 1) return;
  angle += (speed / R) / 15;
  const x = target.x + Math.cos(angle) * R;
  const z = target.z + Math.sin(angle) * R;
  world.terrain.sample(x, z, g);
  const fwd = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  const up = new THREE.Vector3(g.nx, g.ny, g.nz);
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  fwd.crossVectors(up, right).normalize();
  m4.makeBasis(right, up, fwd.clone().negate());
  q.setFromRotationMatrix(m4);
  const r2 = (v) => Math.round(v * 100) / 100;
  const d = [r2(x), r2(g.h + 0.88), r2(z), q.x, q.y, q.z, q.w, r2(fwd.x * speed), 0, r2(fwd.z * speed), 0.25, 0];
  ws.send(JSON.stringify({ t: 's', d }));
}, 1000 / 15);
setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'horn' })), 6000);
setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'emote', e: Math.floor(Math.random() * 4) })), 9000);
setTimeout(() => {
  console.log(`done after ${Math.round((Date.now() - start) / 1000)}s`);
  ws.close();
  process.exit(0);
}, seconds * 1000);
