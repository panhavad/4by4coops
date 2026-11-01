// Ridgeline 4x4 game server: serves the built client and relays co-op rooms over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, makeRoomCode, sanitizeRoomCode } from '../src/shared/room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const VERSION = process.env.APP_VERSION || 'dev';
const MAX_ROOMS = 2000;
const ROOM_TTL_MS = 3 * 24 * 3600 * 1000;
const STARTED = Date.now();

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- static files
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.txt']);
const files = new Map();

function loadStatic() {
  files.clear();
  if (!fs.existsSync(DIST)) return;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else {
        const rel = '/' + path.relative(DIST, full).split(path.sep).join('/');
        const ext = path.extname(full);
        const body = fs.readFileSync(full);
        const entry = {
          body,
          type: TYPES[ext] || 'application/octet-stream',
          etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"',
          immutable: rel.startsWith('/assets/'),
        };
        if (COMPRESSIBLE.has(ext) && body.length > 512) {
          entry.br = zlib.brotliCompressSync(body, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10 },
          });
          entry.gz = zlib.gzipSync(body, { level: 9 });
        }
        files.set(rel, entry);
      }
    }
  };
  walk(DIST);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self' ws: wss:; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'self'",
};

function serveStatic(req, res, pathname) {
  let f = files.get(pathname);
  if (!f && (pathname === '/' || pathname === '/index.html' || !path.extname(pathname))) {
    f = files.get('/index.html');
  }
  if (!f) {
    if (!files.size) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      return res.end('Client not built. Run "npm run build" (or use "npm run dev").');
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': f.type,
    ETag: f.etag,
    'Cache-Control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === f.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accept = String(req.headers['accept-encoding'] || '');
  let body = f.body;
  if (f.br && /\bbr\b/.test(accept)) {
    body = f.br;
    headers['Content-Encoding'] = 'br';
  } else if (f.gz && /\bgzip\b/.test(accept)) {
    body = f.gz;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------- rooms
const rooms = new Map();
const sockets = new Map(); // room code -> Map<playerId, ws>

function loadRooms() {
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const now = Date.now();
    for (const o of list) {
      if (now - (o.lastActive || 0) < ROOM_TTL_MS && sanitizeRoomCode(o.code)) {
        rooms.set(o.code, Room.fromJSON(o));
      }
    }
    log(`restored ${rooms.size} rooms`);
  } catch (e) {
    if (e.code !== 'ENOENT') log('could not load rooms:', e.message);
  }
}

function saveRooms(force = false) {
  let dirty = force;
  for (const r of rooms.values()) if (r.dirty) dirty = true;
  if (!dirty) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...rooms.values()]));
    fs.renameSync(tmp, DATA_FILE);
    for (const r of rooms.values()) r.dirty = false;
  } catch (e) {
    log('could not save rooms:', e.message);
  }
}

function pruneRooms() {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.size === 0 && now - r.lastActive > ROOM_TTL_MS) {
      rooms.delete(code);
      sockets.delete(code);
    }
  }
}

function socketsFor(code) {
  let m = sockets.get(code);
  if (!m) sockets.set(code, (m = new Map()));
  return m;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function dispatch(room, fromId, outs) {
  if (!outs.length) return;
  const peers = socketsFor(room.code);
  for (const [target, msg] of outs) {
    const data = JSON.stringify(msg);
    if (target === 'self') {
      const ws = peers.get(fromId);
      if (ws) send(ws, data);
    } else {
      for (const [pid, ws] of peers) {
        if (target === 'others' && pid === fromId) continue;
        send(ws, data);
      }
    }
  }
}

function uniqueCode() {
  for (;;) {
    const c = makeRoomCode();
    if (!rooms.has(c)) return c;
  }
}

function handleJoin(ws, msg) {
  if (ws.room) leave(ws);
  let code = sanitizeRoomCode(msg.room);
  let room = code ? rooms.get(code) : null;
  if (!room) {
    if (rooms.size >= MAX_ROOMS) pruneRooms();
    if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', msg: 'Server is busy, try again later.' });
    code = code || uniqueCode();
    room = new Room({ code });
    rooms.set(code, room);
    log(`room ${code} created`);
  }
  const res = room.join(msg.cid, msg, Date.now());
  if (res.error) return send(ws, { t: 'error', msg: res.error });
  const peers = socketsFor(code);
  const old = peers.get(res.id);
  if (old && old !== ws) {
    old.replaced = true;
    old.room = null;
    old.close(4000, 'replaced');
  }
  peers.set(res.id, ws);
  ws.room = room;
  ws.pid = res.id;
  send(ws, { ...res.welcome, version: VERSION });
  dispatch(room, res.id, res.outs);
}

function leave(ws) {
  const room = ws.room;
  ws.room = null;
  if (!room) return;
  const peers = socketsFor(room.code);
  if (peers.get(ws.pid) !== ws) return;
  peers.delete(ws.pid);
  dispatch(room, ws.pid, room.leave(ws.pid, Date.now()));
}

// Token bucket: ~40 msgs/s sustained, bursts of 80.
function allow(ws) {
  const now = Date.now();
  ws.tokens = Math.min(80, ws.tokens + ((now - ws.lastRefill) / 1000) * 40);
  ws.lastRefill = now;
  if (ws.tokens < 1) return false;
  ws.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------- http + ws
const server = http.createServer((req, res) => {
  try {
    handleHttp(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});

function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end('ok');
  }
  if (url.pathname === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ version: VERSION, uptime: Math.round((Date.now() - STARTED) / 1000) }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res, decodeURIComponent(url.pathname));
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.tokens = 80;
  ws.lastRefill = Date.now();
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data, isBinary) => {
    if (isBinary || !allow(ws)) return;
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') return handleJoin(ws, msg);
    if (!ws.room) return;
    dispatch(ws.room, ws.pid, ws.room.handle(ws.pid, msg, Date.now()));
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

const ticker = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.travelAt) dispatch(room, null, room.tick(now));
  }
}, 250);
const saver = setInterval(() => saveRooms(), 20000);
const pruner = setInterval(pruneRooms, 10 * 60 * 1000);

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, saving and shutting down`);
  clearInterval(heartbeat);
  clearInterval(ticker);
  clearInterval(saver);
  clearInterval(pruner);
  saveRooms(true);
  // 1012 = service restart: clients reconnect and pick up the new version.
  for (const ws of wss.clients) ws.close(1012, 'restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

loadStatic();
loadRooms();
server.listen(PORT, () => {
  log(`Ridgeline 4x4 server ${VERSION} listening on :${PORT} (${files.size} static files)`);
});
