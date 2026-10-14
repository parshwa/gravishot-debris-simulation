import test from "node:test";
import assert from "node:assert/strict";
import { segmentBody, segmentCircle } from "../src/map.ts";
import {
  DEBRIS,
  damageForRadius,
  spawnDebris,
  stepDebris,
} from "../src/debris.ts";

const dt = 1 / 60;
const body = (patch = {}) => ({
  id: "rock",
  kind: "asteroid",
  x: 500,
  y: 500,
  radius: 30,
  mass: 0,
  craters: [],
  ...patch,
});
const fragment = (patch = {}) => ({
  id: "fragment",
  sourceBody: "gone",
  shot: "shot",
  owner: "pilot",
  material: "rock",
  x: 80,
  y: 500,
  vx: 1200,
  vy: 0,
  radius: 1,
  damage: 300,
  born: 0,
  expires: 4,
  ...patch,
});
const target = { id: "victim", x: 100, y: 500, radius: 1 };
function hitsFor(pieces) {
  return stepDebris(structuredClone(pieces), [], [target], dt, dt).hits;
}
// Minimal consumer following the game's rule: the first lethal hit gets credit.
function killer(hits) {
  let hp = 200;
  for (const hit of hits) {
    if (hit.target !== "victim" || hp <= 0) continue;
    hp -= Math.min(hp, hit.damage);
    if (hp === 0) return hit.owner;
  }
}
test("earlier lethal impact wins regardless of fragment array order", () => {
  const late = fragment({ id: "late", owner: "late", x: 80 });
  const early = fragment({ id: "early", owner: "early", x: 95 });
  const forward = hitsFor([late, early]);
  const reverse = hitsFor([early, late]);
  assert.deepEqual(forward, reverse);
  assert.equal(killer(forward), "early");
  assert.equal(killer(reverse), "early");
  assert.ok(Math.abs(forward[0].t - 0.0025) < 1e-12);
  assert.ok(Math.abs(forward[1].t - 0.015) < 1e-12);
});
test("exact-time ties use fragment ID, independent of array order", () => {
  const a = fragment({ id: "a", owner: "A" });
  const z = fragment({ id: "z", owner: "Z" });
  assert.deepEqual(hitsFor([z, a]), hitsFor([a, z]));
  assert.equal(killer(hitsFor([z, a])), "A");
});
test("impact times include a nonzero step start", () => {
  const hits = stepDebris([fragment()], [], [target], dt, 1 + dt).hits;
  assert.ok(Math.abs(hits[0].t - 1.015) < 1e-12);
});
test("damage interpolation follows alternate radius and damage bounds", () => {
  const config = {
    minRadius: 10,
    maxRadius: 30,
    minDamage: 40,
    maxDamage: 140,
  };
  assert.equal(damageForRadius(10, config), 40);
  assert.equal(damageForRadius(20, config), 90);
  assert.equal(damageForRadius(30, config), 140);
  assert.equal(damageForRadius(20, { ...config, maxDamage: 240 }), 140);
});
test("current tuning retains the original damage curve", () => {
  for (const radius of [4, 4.25, 5, 6, 7.75, 8]) {
    assert.equal(
      damageForRadius(radius),
      Math.round(150 + ((radius - 4) / 4) * 150),
    );
  }
});
test("spawn is repeatable, capacity preserves a prefix, damage uses tuning", () => {
  const spawn = (capacity = DEBRIS.cap) =>
    spawnDebris({
      body: body(),
      point: { x: 470, y: 500 },
      seed: 42,
      shot: "shot",
      owner: "pilot",
      sequence: 0,
      time: 0,
      capacity,
    });
  const full = spawn();
  assert.deepEqual(full, spawn());
  assert.equal(full.length, 8);
  assert.deepEqual(spawn(3), full.slice(0, 3));
  assert.deepEqual(spawn(0), []);
  for (const p of full) assert.equal(p.damage, damageForRadius(p.radius));
});
test("fast fragments stop at the nearest obstruction", () => {
  const result = stepDebris(
    [fragment({ vx: 12000 })],
    [body({ x: 150 })],
    [{ ...target, x: 200 }],
    dt,
    dt,
  );
  assert.equal(result.hits[0].bodyId, "rock");
  assert.equal(result.hits[0].target, undefined);
  assert.equal(result.pieces.length, 0);
});
test("moving target collision uses relative motion", () => {
  const result = stepDebris(
    [fragment({ x: 100, vx: 0 })],
    [],
    [{ ...target, x: 160 }],
    dt,
    dt,
    1080,
    new Map([["victim", { x: 40, y: 500 }]]),
  );
  assert.equal(result.hits[0].target, "victim");
  assert.ok(result.hits[0].t > 0 && result.hits[0].t < dt);
});
test("expired fragments disappear and gravity changes velocity", () => {
  assert.equal(stepDebris([fragment()], [], [], dt, 4.1).pieces.length, 0);
  const p = fragment({ vx: 0 });
  stepDebris([p], [body({ y: 700, mass: 4000 })], [], dt, dt);
  assert.ok(p.vy > 0);
});
test("body collisions neither mutate terrain nor spawn chain reactions", () => {
  const rock = body({ x: 150 });
  const before = structuredClone(rock);
  const result = stepDebris([fragment({ vx: 12000 })], [rock], [], dt, dt);
  assert.deepEqual(rock, before);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].damage, 0);
  assert.equal(result.pieces.length, 0);
});

test("uncratered terrain preserves a tangent contact", () => {
  const rock = body({ x: 0, y: 0, radius: 1 });
  const start = { x: -2, y: 1 };
  const end = { x: 2, y: 1 };
  assert.equal(segmentCircle(start, end, rock, 1), 0.5);
  assert.equal(segmentBody(start, end, rock), 0.5);
});

test("crater openings permit passage but the far wall stops a segment", () => {
  const rock = body({
    x: 0,
    y: 0,
    radius: 10,
    craters: [{ x: -10, y: 0, radius: 5 }],
  });
  assert.equal(segmentBody({ x: -20, y: 0 }, { x: -8, y: 0 }, rock), null);
  assert.ok(
    Math.abs(segmentBody({ x: -20, y: 0 }, { x: 0, y: 0 }, rock) - 0.75) <
      1e-12,
  );
});

test("invalid damage tuning fails instead of returning NaN or extrapolation", () => {
  for (const radius of [NaN, Infinity, -1, 9])
    assert.throws(() => damageForRadius(radius), RangeError);
  assert.throws(
    () =>
      damageForRadius(4, {
        minRadius: 4,
        maxRadius: 4,
        minDamage: 1,
        maxDamage: 2,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      damageForRadius(6, {
        minRadius: 4,
        maxRadius: 8,
        minDamage: 10,
        maxDamage: 2,
      }),
    RangeError,
  );
});

test("invalid step durations are rejected before fragment mutation", () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    const p = fragment();
    const before = structuredClone(p);
    assert.throws(() => stepDebris([p], [], [], invalid, 1), RangeError);
    assert.deepEqual(p, before);
  }
});

test("spawn rejects invalid remaining capacity", () => {
  for (const capacity of [-1, 0.5, Infinity, NaN]) {
    assert.throws(
      () =>
        spawnDebris({
          body: body(),
          point: { x: 470, y: 500 },
          seed: 42,
          shot: "s",
          owner: "p",
          sequence: 0,
          time: 0,
          capacity,
        }),
      RangeError,
    );
  }
});

test("collision tie rules do not depend on body or target array order", () => {
  const targets = [
    { ...target, id: "z" },
    { ...target, id: "a" },
  ];
  const run = (bodies, ships) =>
    stepDebris([fragment()], bodies, ships, dt, dt).hits;
  assert.equal(run([], targets)[0].target, "a");
  assert.deepEqual(run([], targets), run([], [...targets].reverse()));
  const bodies = [body({ ...target, id: "z" }), body({ ...target, id: "a" })];
  assert.equal(run(bodies, targets)[0].kind, "body");
  assert.equal(run(bodies, targets)[0].bodyId, "a");
  assert.deepEqual(
    run(bodies, targets),
    run([...bodies].reverse(), [...targets].reverse()),
  );
});

test("gravity accumulation is independent of caller body order", () => {
  const bodies = [
    body({ id: "z", x: 1000, mass: 4000 }),
    body({ id: "a", x: 800, y: 700, mass: 2000 }),
    body({ id: "b", x: 900, y: 100, mass: 1000 }),
  ];
  const run = (ordered) =>
    stepDebris([fragment({ vx: 0 })], ordered, [], dt, dt);
  assert.deepEqual(run(bodies), run([...bodies].reverse()));
});

test("newborn fragments wait a step and boundary expiry removes survivors", () => {
  const p = fragment({ born: dt });
  assert.deepEqual(stepDebris([p], [], [], dt, dt).pieces, [p]);
  assert.equal(p.x, 80);
  const expiring = fragment({ expires: dt });
  assert.equal(stepDebris([expiring], [], [], dt, dt).pieces.length, 0);
});

test("empty input returns empty arrays", () => {
  assert.deepEqual(stepDebris([], [], [], dt, dt), { pieces: [], hits: [] });
});
