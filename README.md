# GraviShot: deterministic debris simulation

GraviShot is a personal orbital-artillery game I’m building at [gravishot.com](https://gravishot.com/). This TypeScript sample handles debris from shattered objects and surface impacts: it spawns fragments, advances them under gravity, and reports collisions with terrain and ships.

The interesting problem is making those collisions consistent. If two fragments hit a ship during the same simulation step, their order can determine which player gets credit for destroying it. That order should follow the simulated impacts, even if the fragments arrive in a different array order.

## Scope and AI use

I proposed the gameplay mechanic and directed its development through iteration. AI generated the implementation and tests under my direction, and I used AI-assisted review to investigate collision behavior and add regression coverage. This documentation was also developed with AI assistance.

The sample contains the simulation, supporting geometry, types, and seeded random-number generator. The full game remains private; no employer code is included. Rendering, multiplayer, and applying damage to game state are outside this sample.

## Run the sample

Use Node.js 22.18 or later. The tests run without installing dependencies or connecting to external services:

```sh
npm test
```

To check types and formatting as well:

```sh
npm install
npm run typecheck
npm run format:check
```

Start with [`src/debris.ts`](src/debris.ts) for spawning and stepping, then [`test/debris.test.mjs`](test/debris.test.mjs) for examples and regressions. [`src/map.ts`](src/map.ts) contains the collision helpers.

## How a step works

`spawnDebris` creates fragments with seeded variations in size, speed, and direction. Its seed combines the match seed, shot ID, source body ID, and impact sequence, so the same inputs reproduce the same spawn result in the same runtime. Each fragment carries its originating player’s ID for damage attribution.

`stepDebris` advances the interval from `time - dt` to `time`. It updates velocity from gravity, calculates the next position, and checks the path for collisions. It returns surviving fragments and hit events; the caller applies damage in the returned hit order.

Fragment objects are updated in place, while the survivor and hit arrays are new. Callers that need the previous state must copy it before stepping.

## Decisions and trade-offs

### Check the path, not just the destination

A fast fragment can cross a ship between two frames without ending inside it. Sweeping the segment between its old and new positions catches this kind of missed collision. For moving ships and bodies, the calculation uses relative motion and approximates movement as linear during the step.

Circular collision checks include the fragment’s radius. Terrain checks expand the body and shrink its crater openings by that radius. This keeps the geometry manageable, but crater edges remain a gameplay approximation rather than an exact model of two colliding shapes.

### Order hits by when they occur

Previously, every hit received the end-of-step timestamp. If two fragments could each destroy a ship, the first fragment in the input array could receive credit even when it arrived later.

Each hit now records its time within the step:

```ts
impactTime = time - dt + collisionFraction * dt;
```

Hits are sorted by that time before being returned. Exact-time ties use unique fragment IDs with locale-independent string ordering. For one fragment hitting multiple objects at exactly the same time, terrain takes precedence over ships, and object IDs resolve ties within either category. These are explicit tie rules, not additional physics.

A regression test reverses the fragment array and checks that both hit order and kill credit stay the same. The test includes a small damage consumer because ordering only helps if the caller respects it.

### Keep damage tied to tuning

Damage originally used hardcoded radius and damage ranges. Changing the fragment-size settings could therefore leave the damage calculation out of sync.

`damageForRadius` now interpolates between the configured bounds and rounds the result. It rejects invalid bounds and radii outside the configured range. Tests cover both the original curve and alternate tuning, so a tuning change does not require rewriting the formula.

### Keep the workload explicit

Fragments live for four seconds. Spawning accepts the remaining capacity from the caller, allowing the game to enforce a shared fragment limit. The default capacity is 64, but repeated calls do not enforce a global cap automatically.

The step checks each active fragment against the supplied bodies and targets. It still sorts inputs and allocates temporary geometry. A spatial index or object pooling could help at larger scales, but this sample has no profiling evidence to justify that complexity or support a frame-rate claim.

### Make ordering repeatable without overstating determinism

Bodies are sorted by ID before gravity is accumulated. Floating-point addition depends on order, so this avoids changes caused solely by rearranging the body array. Collision candidates and equal-time hits also use stable ID ordering.

These choices support repeatable behavior in the same runtime. They do not establish bit-identical physics across every JavaScript engine.

## A collision edge case found during review

The terrain helper previously tested a point just beyond a circle intersection to decide whether the fragment had reached solid terrain. At a tangent contact, that probe could fall outside the circle and incorrectly discard the hit.

For bodies without craters, the helper now returns the circle-intersection result directly. A regression covers that tangent case. Bodies with craters still use the probe-based method, so the fix does not claim to solve every crater-boundary case.

## Integration contract and limitations

- Use a fixed timestep, with birth and expiry times aligned to step boundaries. Bodies and targets supply end-of-step positions; the optional `previous` map supplies their start positions. Missing entries are treated as stationary during collision checks.
- Supply unique fragment IDs and stable, unique IDs for collision objects. Remove shattered source bodies before stepping their fragments.
- Pass trusted simulation state. The module validates step duration, time, spawn capacity, and damage bounds, but it does not validate every position, velocity, or body property.
- Apply returned hits in order. Hit detection uses one target snapshot for the whole step; it does not recalculate later collisions after a target is destroyed. Combining debris hits with weapon events requires ordering at the game level.
- Debris hits do not modify terrain or spawn further fragments. Those behaviors would need separate integration rules.

Changes to collision rules can alter replay outcomes. A game that needs to replay older matches should retain the corresponding simulation rules. This extracted sample is not a drop-in patch for the full game.

## Verification

The sample has 19 passing tests covering hit ordering, kill attribution, configurable damage, repeatable spawning, capacity, moving and fast collisions, gravity, expiry, tangent contact, crater passage, and invalid inputs. It also passes strict TypeScript checking and Prettier formatting checks.

These checks validate the sample’s behavior and contracts. They do not measure full-game performance or verify browser, mobile, or multiplayer integration.

## Spawning example

The caller supplies the source body, impact position, match context, and remaining fragment capacity:

```ts
const fragments = spawnDebris({
  body,
  point: impactPoint,
  seed: matchSeed,
  shot: shotId,
  owner: playerId,
  sequence: impactSequence,
  time: simulationTime,
  capacity: remainingCapacity,
});
```

The named options make the call easier to inspect than a sequence of positional arguments. The stepping API and its mutation contract are documented alongside `stepDebris` in [`src/debris.ts`](src/debris.ts).
