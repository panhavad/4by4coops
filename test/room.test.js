import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, sanitizeRoomCode, sanitizeName, makeRoomCode } from '../src/shared/room.js';
import { MAX_PLAYERS, METEORS_TO_OPEN_PORTAL, PORTAL_COUNTDOWN_MS, DAY_LENGTH_MS, MORNING_PHASE, dayPhase, plankCapacity } from '../src/shared/constants.js';

const join = (room, cid, name = cid) => room.join(cid, { name, color: 2, acc: 3 }, 1000);

test('room codes and names are sanitized', () => {
  assert.equal(sanitizeRoomCode(' abcde '), 'ABCDE');
  assert.equal(sanitizeRoomCode('AB1DE'), ''); // 1 is not in the alphabet
  assert.equal(sanitizeRoomCode('TOOLONG'), '');
  assert.equal(sanitizeRoomCode(42), '');
  assert.equal(sanitizeRoomCode(makeRoomCode()).length, 5);
  assert.equal(sanitizeName('<script>x</script>'), 'scriptx/script');
  assert.equal(sanitizeName(''), 'Driver');
  assert.equal(sanitizeName('a'.repeat(40)).length, 16);
});

test('new rooms start in the morning', () => {
  const now = 123456789;
  const r = new Room({ code: 'AAAAA', seed: 1, now });
  assert.ok(Math.abs(dayPhase(now, r.timeShift) - MORNING_PHASE) < 1e-6);
});

test('join, rejoin with the same client id, and the 4-player limit', () => {
  const r = new Room({ code: 'AAAAA', seed: 1 });
  const a = join(r, 'a');
  assert.equal(a.id, 'p1');
  assert.equal(a.welcome.players.length, 0);
  const b = join(r, 'b');
  assert.deepEqual(b.welcome.players.map((p) => p.id), ['p1']);
  assert.equal(join(r, 'a').id, 'p1', 'reconnect keeps the id');
  join(r, 'c');
  join(r, 'd');
  assert.equal(r.size, MAX_PLAYERS);
  assert.match(join(r, 'e').error, /full/);
  r.leave('p2');
  assert.equal(join(r, 'e').id, 'p5');
});

test('state relay validates payloads', () => {
  const r = new Room({ code: 'AAAAA', seed: 1 });
  const { id } = join(r, 'a');
  assert.deepEqual(r.handle(id, { t: 's', d: [1, 2] }), []);
  assert.deepEqual(r.handle(id, { t: 's', d: new Array(12).fill('x') }), []);
  const ok = r.handle(id, { t: 's', d: new Array(12).fill(1) });
  assert.equal(ok[0][0], 'others');
  assert.deepEqual(r.handle('nobody', { t: 's', d: new Array(12).fill(1) }), []);
});

test('meteorites, portal countdown and region travel', () => {
  const r = new Room({ code: 'AAAAA', seed: 7 });
  const { id } = join(r, 'a');
  assert.deepEqual(r.handle(id, { t: 'portal' }, 0), [], 'portal is dormant without meteorites');
  assert.deepEqual(r.handle(id, { t: 'collect', id: 'm99' }), [], 'unknown meteorite id');
  for (let i = 0; i < METEORS_TO_OPEN_PORTAL; i++) {
    const out = r.handle(id, { t: 'collect', id: `m${i}` });
    assert.equal(out[0][1].n, i + 1);
    assert.deepEqual(r.handle(id, { t: 'collect', id: `m${i}` }), [], 'no double collect');
  }
  r.handle(id, { t: 'plank+', a: [0, 1, 0], b: [0, 1, 6] });
  const go = r.handle(id, { t: 'portal' }, 1000);
  assert.equal(go[0][1].at, 1000 + PORTAL_COUNTDOWN_MS);
  assert.deepEqual(r.handle(id, { t: 'portal' }, 1500), [], 'countdown already running');
  assert.deepEqual(r.tick(1000 + PORTAL_COUNTDOWN_MS - 1), []);
  const [[target, msg]] = r.tick(1000 + PORTAL_COUNTDOWN_MS);
  assert.equal(target, 'all');
  assert.equal(msg.t, 'region');
  assert.equal(msg.state.region, 1);
  assert.equal(msg.state.collected.length, 0);
  assert.equal(msg.state.planks.length, 0, 'planks are left behind');
});

test('discoveries, crates, photos are shared once', () => {
  const r = new Room({ code: 'AAAAA', seed: 7 });
  const { id } = join(r, 'a');
  assert.equal(r.handle(id, { t: 'discover', id: 'h1' })[0][1].key, '0:h1');
  assert.deepEqual(r.handle(id, { t: 'discover', id: 'h1' }), []);
  assert.deepEqual(r.handle(id, { t: 'discover', id: '../../etc' }), []);
  assert.equal(r.handle(id, { t: 'crate', id: 'u0', kind: 'engine' })[0][1].level, 1);
  assert.deepEqual(r.handle(id, { t: 'crate', id: 'u1', kind: 'nitro' }), []);
  assert.equal(r.handle(id, { t: 'photo', sp: 'fox' })[0][1].sp, 'fox');
  assert.deepEqual(r.handle(id, { t: 'photo', sp: 'fox' }), []);
  assert.deepEqual(r.handle(id, { t: 'photo', sp: 'dragon' }), []);
});

test('plank capacity follows the plank upgrade', () => {
  const r = new Room({ code: 'AAAAA', seed: 7 });
  const { id } = join(r, 'a');
  const add = () => r.handle(id, { t: 'plank+', a: [0, 1, 0], b: [0, 1, 7] });
  for (let i = 0; i < plankCapacity(0); i++) assert.equal(add()[0][1].t, 'plank+');
  assert.equal(add()[0][1].t, 'toast');
  assert.deepEqual(r.handle(id, { t: 'plank+', a: [0, 1, 0], b: [0, 1, 50] }), [], 'too long');
  assert.deepEqual(r.handle(id, { t: 'plank+', a: [0, 1, 0], b: [0, 1, 1e9] }), [], 'out of bounds');
  const pid = [...r.planks.keys()][0];
  assert.equal(r.handle(id, { t: 'plank-', id: pid })[0][1].id, pid);
  assert.equal(add()[0][1].t, 'plank+');
});

test('resting skips to the next morning', () => {
  const r = new Room({ code: 'AAAAA', seed: 7, now: 0 });
  const { id } = join(r, 'a');
  const later = DAY_LENGTH_MS * 0.5;
  r.handle(id, { t: 'rest' }, later);
  assert.ok(Math.abs(dayPhase(later, r.timeShift) - MORNING_PHASE) < 1e-6);
});

test('rooms survive a JSON round trip (server restarts)', () => {
  const r = new Room({ code: 'AAAAA', seed: 99 });
  const { id } = join(r, 'a');
  r.handle(id, { t: 'collect', id: 'm2' });
  r.handle(id, { t: 'crate', id: 'u3', kind: 'winch' });
  r.handle(id, { t: 'plank+', a: [0, 1, 0], b: [0, 1, 7] });
  const copy = Room.fromJSON(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(copy.publicState(), r.publicState());
  assert.equal(copy.join('a', { name: 'a' }).id, id, 'returning player keeps their id');
});
