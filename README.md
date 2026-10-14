# GraviShot: deterministic debris simulation

A focused TypeScript code sample extracted from my personal orbital-artillery game. Destroyed space objects produce fragments that follow gravity, collide with terrain and ships, and credit damage to their originating player.

## Authorship and scope

AI generated the implementation and tests under my direction. I proposed the gameplay mechanic and directed its development through iteration. This sample also includes an AI-assisted review and fixes for within-step hit ordering, hardcoded damage interpolation, and missed tangent contacts on uncratered bodies. It is not presented as hand-written code or as a production-ready game.

This repository contains only the simulation and its minimal supporting geometry, types, and random-number generator. It includes no employer code, credentials, account data, game assets, server infrastructure, or multiplayer implementation.

## Run

Use Node.js 22.18+ (Node 24 recommended). Tests need no package installation or external services:

```sh
npm test
```

Optional static verification:

```sh
npm install
npm run typecheck
npm run format:check
```

## Suggested reading order

1. `src/debris.ts`: seeded spawning, configured damage, gravity, and swept collisions.
2. `test/debris.test.mjs`: behavioral and regression tests, including a minimal damage consumer.
3. `src/map.ts`: collision helpers, including simplified crater geometry.

## Design decisions

- Seed fragment variation from the match, shot, source body, and impact sequence. The same input produces the same spawn result in the same runtime.
- Sweep each fragment's path rather than checking only its final position. Relative motion accounts for moving targets.
- Return hits in collision-time order. Exact-time ties use unique fragment IDs with locale-independent code-unit ordering. Callers must apply damage in this order.
- Derive damage from the configured radius and damage ranges. Current tuning remains unchanged.
- Bound work through caller-supplied remaining capacity and a four-second lifetime. The full game supplies remaining capacity; this module does not manage a session-wide budget.
- Use a named options object for spawning, validate capacity and damage tuning, and distinguish body hits from target hits in the type system.
- Accumulate gravity in stable body-ID order rather than caller array order. Skip collision preparation entirely for empty fragment input.
- Mutate fragment positions and velocities in place; return new survivor and hit arrays. This ownership contract is explicit in the API documentation.

## Correctness fixes

Previously every hit received the end-of-step timestamp. Two lethal fragments could award the kill to a later arrival simply because it appeared first in the input array. Hits now retain their within-step time (`time - dt + fraction * dt`) and are sorted before the consumer processes damage. A regression reverses the fragment array and verifies identical hit order and kill credit. Another covers exact-time ties.

Damage previously embedded radius and damage ranges as numeric literals. `damageForRadius` now derives interpolation from named bounds; tests use alternate tuning as well as the original curve.

An additional regression exposed missed tangent contact in the uncratered-body helper: probing beyond contact could leave the circle and incorrectly report no collision. Uncratered bodies now use the exact circle-intersection result. Cratered geometry retains its approximate probe-based behavior.

## Assumptions and trade-offs

- Fixed timestep; birth and expiry times align to step boundaries. Inputs are trusted simulation state, not an API validation boundary. Invalid step duration, capacity, radius, or damage tuning is rejected; complete body/fragment state validation remains the caller’s responsibility.
- Bodies and targets describe end-of-step positions; `previous` supplies start positions. Motion is approximated as linear within each step.
- Bodies win exact body/ship collision ties; IDs break ties within a category. Fragment IDs must be unique.
- Terrain collision inflates the body and shrinks crater holes. This is an educational/gameplay approximation, not a general rigid-body engine.
- Hit detection uses the target snapshot for the entire step. Removing a destroyed target mid-step, or globally ordering weapon and debris events together, belongs to the game integration and is not implemented here.
- There are still allocations in the collision loop. A spatial index or allocation pooling should follow profiling, not precede it. No mobile frame-rate claim is made.
- Deterministic ordering does not guarantee bit-identical floating-point physics across all JavaScript engines.

## Verification

The sample has 19 passing tests and passes strict TypeScript checking, including unused-code and return-path checks. Formatting is checked with Prettier. Tests cover ordering, tie-breaking, configurable damage, repeatable spawning, capacity, fast/moving collisions, expiry, gravity, no terrain mutation or chain reactions, tangent contact, crater passage, invalid inputs, deterministic collision ties, body-order-independent gravity, and lifecycle boundaries. These are sample-level checks, not full-game regression or browser/mobile checks.

The changes are isolated here and have not been applied to the original game. In particular, the game should version changed collision semantics to preserve existing replay behavior.

## API example

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

The named values come from the caller’s simulation state. `stepDebris` retains the game’s positional stepping API; see its contract in `src/debris.ts`. This sample is deliberately not a drop-in patch for the game.
