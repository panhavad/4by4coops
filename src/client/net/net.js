// Network transports. `Net` talks to the server over WebSockets (auto-reconnect + clock sync);
// `LocalNet` runs the exact same Room logic in the browser for offline play.
import { Room } from '../../shared/room.js';

export class Net {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.joinMsg = null;
    this.closed = false;
    this.retry = 0;
    this.clockOffset = 0;
    this.bestRtt = Infinity;
    this.status = 'idle';
  }

  connect(joinMsg) {
    this.joinMsg = joinMsg;
    this.closed = false;
    this.open();
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 8000);
  }

  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('online');
      ws.send(JSON.stringify(this.joinMsg));
      this.send({ t: 'ping', c: Date.now() });
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.clockOffset = m.now - Date.now();
        this.joinMsg.room = m.room;
      } else if (m.t === 'pong') {
        const rtt = Date.now() - m.c;
        if (rtt <= this.bestRtt * 1.5) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.clockOffset = m.now + rtt / 2 - Date.now();
        }
        this.rtt = rtt;
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      if (e.code === 4000) {
        this.setStatus('replaced');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  scheduleReconnect() {
    this.setStatus('reconnecting');
    const delay = Math.min(8000, 500 * 2 ** this.retry++);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => !this.closed && this.open(), delay);
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  get online() {
    return this.ws?.readyState === 1;
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  setStatus(s) {
    this.status = s;
    this.onStatus?.(s);
  }
}

const OFFLINE_KEY = 'ridgeline:offline-room';

export class LocalNet {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.status = 'offline';
    this.clockOffset = 0;
  }

  connect(joinMsg) {
    let room = null;
    try {
      const saved = JSON.parse(localStorage.getItem(OFFLINE_KEY));
      if (saved) room = Room.fromJSON(saved);
    } catch {
      room = null;
    }
    this.room = room ?? new Room({ code: 'SOLO' });
    const res = this.room.join(joinMsg.cid, joinMsg, Date.now());
    this.id = res.id;
    queueMicrotask(() => this.onMessage({ ...res.welcome, version: 'offline' }));
    this.timer = setInterval(() => this.deliver(this.room.tick(Date.now())), 250);
    this.onStatus?.('offline');
  }

  send(msg) {
    if (!this.room || msg.t === 's' || msg.t === 'ping') return;
    this.deliver(this.room.handle(this.id, msg, Date.now()));
  }

  deliver(outs) {
    for (const [target, m] of outs) if (target !== 'others') this.onMessage(m);
    if (this.room.dirty) {
      this.room.dirty = false;
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(this.room));
    }
  }

  get online() {
    return false;
  }

  now() {
    return Date.now();
  }

  close() {
    clearInterval(this.timer);
  }

  static reset() {
    localStorage.removeItem(OFFLINE_KEY);
  }
}
