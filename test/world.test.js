import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/client/world/world.js';
import { HALF, CELL } from '../src/client/world/terrain.js';
import { VehiclePhysics, plankPhysics, yawOf } from '../src/client/vehicle/physics.js';

const worlds = new Map();
async function world(region, seed) {
  const key = `${region}:${seed}`;
  if (!worlds.has(key)) {
    const w = new World(region, seed);
    await w.generate();
    worlds.set(key, w);
  }
  return worlds.get(key);
}

function envFor(w, planks = []) {
  return {
    ground: (x, z, o) => w.terrain.sample(x, z, o),
    heightAt: (x, z) => w.terrain.heightAt(x, z),
    water: w.water,
    planks,
    cars: [],
    forColliders: (x, z, fn) => w.forColliders(x, z, fn),
  };
}

function simulate(car, seconds, input) {
  Object.assign(car.input, { steer: 0, throttle: 0, brake: 0, handbrake: 0 }, input);
  for (let i = 0; i < seconds * 120; i++) {
    if (i % 2 === 0) car.updateSteering(1 / 60);
    car.step(1 / 120);
  }
}

test('world generation is deterministic (all co-op clients build the same world)', async () => {
  const a = new World(1, 777);
  const b = new World(1, 777);
  await a.generate();
  await b.generate();
  assert.ok(a.terrain.h.every((v, i) => v === b.terrain.h[i]));
  assert.deepEqual(a.pois, b.pois);
  assert.deepEqual(a.meteors, b.meteors);
  assert.deepEqual(a.animals, b.animals);
  assert.deepEqual(a.items, b.items);
});

test('every region places its points of interest on dry land', async () => {
  for (let region = 0; region < 4; region++) {
    const w = await world(region, 4242);
    const kinds = w.pois.map((p) => p.kind);
    assert.equal(kinds.filter((k) => k === 'cabin').length, 3, `region ${region} cabins`);
    assert.equal(kinds.filter((k) => k === 'portal').length, 1);
    assert.equal(w.meteors.length, 7);
    assert.equal(w.crates.length, 5);
    for (const p of [...w.pois, ...w.meteors]) {
      assert.ok(w.terrain.heightAt(p.x, p.z) > w.water, `${p.id} in region ${region} is under water`);
      assert.ok(Math.abs(p.x) < HALF - 60 && Math.abs(p.z) < HALF - 60, `${p.id} outside the playable area`);
    }
    assert.ok(w.trails.length >= 5, 'trails connect the points of interest');
  }
});

test('heightAt matches the rendered triangles exactly', async () => {
  const w = await world(0, 4242);
  const T = w.terrain;
  const N = (HALF * 2) / CELL + 1;
  for (let k = 0; k < 200; k++) {
    const i = 10 + ((k * 37) % 400);
    const j = 10 + ((k * 91) % 400);
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;
    assert.equal(T.heightAt(x, z), T.h[j * N + i]);
    // Points on the cell diagonal lie on both triangles.
    const mid = T.heightAt(x + CELL / 2, z + CELL / 2);
    const expected = (T.h[j * N + i] + T.h[(j + 1) * N + i + 1]) / 2;
    assert.ok(Math.abs(mid - expected) < 1e-4);
  }
});

test('the truck settles, drives, turns, brakes and stays upright', async () => {
  const w = await world(0, 4242);
  const car = new VehiclePhysics(envFor(w));
  const { x, z } = w.spawn;
  car.reset(x, w.terrain.heightAt(x, z) + 1.2, z, 0);
  simulate(car, 3, {});
  const ride = car.pos.y - w.terrain.heightAt(car.pos.x, car.pos.z);
  assert.ok(ride > 0.7 && ride < 1.05, `ride height ${ride}`);
  assert.ok(car.speed < 0.2, 'parked truck stays put');
  assert.equal(car.groundedCount, 4);

  simulate(car, 4, { throttle: 1 });
  assert.ok(car.forwardSpeed() > 10, `accelerates (${car.forwardSpeed()})`);
  const yaw0 = yawOf(car.quat);
  simulate(car, 1.5, { throttle: 0.6, steer: 1 });
  assert.ok(yawOf(car.quat) < yaw0 - 0.2, 'steering right turns clockwise');
  const v0 = car.forwardSpeed();
  simulate(car, 1, { brake: 1 });
  assert.ok(car.forwardSpeed() < v0 - 5, `brakes (${v0} -> ${car.forwardSpeed()})`);
  assert.ok(car.upright() > 0.8, 'still upright');
  assert.ok(Number.isFinite(car.pos.x) && Number.isFinite(car.quat.w));
});

test('wheels ride on planks', async () => {
  const w = await world(0, 4242);
  const { x, z } = w.spawn;
  const h = w.terrain.heightAt(x, z - 8);
  const plank = plankPhysics({ id: 'k1', a: [x, h + 0.6, z - 4], b: [x, h + 0.6, z - 12] });
  const car = new VehiclePhysics(envFor(w, [plank]));
  car.reset(x, h + 2.5, z - 8, 0);
  simulate(car, 2, {});
  assert.ok(car.wheels.every((wh) => wh.grounded && wh.surface === 5), 'all wheels on wood');
  assert.ok(car.pos.y > h + 0.6 + 0.6, 'truck sits on top of the plank');
});

test('the winch pulls the truck toward its anchor', async () => {
  const w = await world(0, 4242);
  const car = new VehiclePhysics(envFor(w));
  const { x, z } = w.spawn;
  car.reset(x, w.terrain.heightAt(x, z) + 1, z, 0);
  simulate(car, 1, {});
  const anchor = car.pos.clone();
  anchor.z -= 15;
  anchor.y = w.terrain.heightAt(anchor.x, anchor.z) + 1;
  car.attachWinch(anchor, { kind: 'tree' });
  const d0 = car.pos.distanceTo(anchor);
  simulate(car, 4, {});
  assert.ok(car.pos.distanceTo(anchor) < d0 - 3, 'reeled in');
});
