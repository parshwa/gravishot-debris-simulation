import { PHYSICS, random } from "./config.ts";
import { segmentBody, segmentCircle } from "./map.ts";
import type { Body, DebrisMaterial, Vec, WeaponId } from "./types.ts";
export const DEBRIS = {
  cap: 64,
  lifetime: 4,
  minRadius: 4,
  maxRadius: 8,
  minSpeed: 220,
  maxSpeed: 420,
  minDamage: 150,
  maxDamage: 300,
} as const;
/** Interpolate damage for a finite radius within valid tuning bounds. */
export function damageForRadius(
  radius: number,
  config: Readonly<{
    minRadius: number;
    maxRadius: number;
    minDamage: number;
    maxDamage: number;
  }> = DEBRIS,
): number {
  if (
    ![
      radius,
      config.minRadius,
      config.maxRadius,
      config.minDamage,
      config.maxDamage,
    ].every(Number.isFinite) ||
    config.minRadius < 0 ||
    config.maxRadius <= config.minRadius ||
    config.minDamage < 0 ||
    config.maxDamage < config.minDamage ||
    radius < config.minRadius ||
    radius > config.maxRadius
  ) {
    throw new RangeError(
      "Radius and damage bounds must be finite, ordered, and contain the radius",
    );
  }
  const fraction =
    (radius - config.minRadius) / (config.maxRadius - config.minRadius);
  return Math.round(
    config.minDamage + fraction * (config.maxDamage - config.minDamage),
  );
}

// Code-unit ordering is independent of the machine's locale.
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface Debris extends Vec {
  id: string;
  sourceBody: string;
  shot: string;
  owner: string;
  material: DebrisMaterial;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  born: number;
  expires: number;
}
export interface DebrisTarget extends Vec {
  id: string;
  radius: number;
}
interface Impact extends Vec {
  id: string;
  owner: string;
  radius: number;
  t: number;
}

/** Exactly one collision destination is present. */
export type DebrisHit = Impact &
  (
    | { kind: "target"; target: string; bodyId?: never; damage: number }
    | { kind: "body"; bodyId: string; target?: never; damage: 0 }
  );

export const debrisEnabled = (version?: string) =>
  version === "gravishot-1.3.0" ||
  version === "arena-2" ||
  version === "invasion-2";
export const shatters = (body: Body) =>
  ["asteroid", "comet", "satellite"].includes(body.kind);
export const ejectsDebris = (body: Body, weapon?: WeaponId) =>
  ["planet", "moon", "asteroid", "comet", "satellite"].includes(body.kind) &&
  ["shell", "rover", "skipper", "splitter"].includes(weapon || "");
function hash(text: string) {
  let n = 2166136261;
  for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
export interface SpawnOptions {
  body: Body;
  point: Vec;
  seed: number;
  shot: string;
  owner: string;
  sequence: number;
  time: number;
  /** Remaining session capacity, supplied by the caller. */
  capacity?: number;
}

/** Source geometry is read-only. Remove shattered sources before stepping fragments. */
export function spawnDebris({
  body,
  point,
  seed,
  shot,
  owner,
  sequence,
  time,
  capacity = DEBRIS.cap,
}: SpawnOptions): Debris[] {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError("Capacity must be a nonnegative safe integer");
  }
  const rng = random(hash(`${seed}:${shot}:${body.id}:${sequence}`));
  const broken = shatters(body),
    count = broken ? 8 : 4;
  const normal = Math.atan2(point.y - body.y, point.x - body.x);
  const spin = rng() * Math.PI * 2;
  return Array.from(
    { length: Math.min(count, Math.max(0, capacity)) },
    (_, i) => {
      const radius =
        DEBRIS.minRadius + rng() * (DEBRIS.maxRadius - DEBRIS.minRadius);
      const angle = broken
        ? spin + (i * Math.PI) / 4 + (rng() - 0.5) * 0.18
        : normal - Math.PI / 3 + (i * ((2 * Math.PI) / 3)) / 3;
      const speed =
        DEBRIS.minSpeed + rng() * (DEBRIS.maxSpeed - DEBRIS.minSpeed);
      // Surface ejecta start outside the surface; shattered sources must be removed by the caller.
      const origin = broken ? body : point;
      const offset = broken ? body.radius * 0.35 : radius + 2;
      return {
        id: `debris:${shot}:${sequence}:${i}`,
        sourceBody: body.id,
        shot,
        owner,
        material:
          body.kind === "comet"
            ? "ice"
            : body.kind === "satellite"
              ? "metal"
              : "rock",
        x: origin.x + Math.cos(broken ? angle : normal) * offset,
        y: origin.y + Math.sin(broken ? angle : normal) * offset,
        vx: Math.cos(angle) * speed + (body.velocity?.x || 0),
        vy: Math.sin(angle) * speed + (body.velocity?.y || 0),
        radius,
        damage: damageForRadius(radius),
        born: time,
        expires: time + DEBRIS.lifetime,
      };
    },
  );
}
export function debrisGravity(
  p: { x: number; y: number; vx: number; vy: number },
  bodies: Body[],
  dt: number,
) {
  for (const b of bodies)
    if (b.mass) {
      const dx = b.x - p.x,
        dy = b.y - p.y,
        d2 = Math.max(100, dx * dx + dy * dy);
      const force =
        ((PHYSICS.gravity * b.mass) / (d2 * Math.sqrt(d2))) *
        (b.inverted ? -1 : 1);
      p.vx += dx * force * dt;
      p.vy += dy * force * dt;
    }
}
/**
 * Advances fragment objects in place over [time - dt, time]. Returns new arrays.
 * Call with a fixed timestep and fragments born/expired on step boundaries.
 * Targets/bodies describe end-of-step positions; previous supplies start positions.
 * Hits are ordered by impact time, then unique fragment ID for exact ties.
 * A body wins an exact body/ship collision tie; IDs break ties within each kind.
 * Callers must apply damage in the returned order. Survivors retain input order.
 */
export function stepDebris(
  pieces: Debris[],
  bodies: Body[],
  targets: DebrisTarget[],
  dt: number,
  time: number,
  bounds = 1080,
  previous?: Map<string, Vec>,
): { pieces: Debris[]; hits: DebrisHit[] } {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(time)) {
    throw new RangeError(
      "Step duration must be positive and time must be finite",
    );
  }
  if (pieces.length === 0) return { pieces: [], hits: [] };
  const alive: Debris[] = [],
    hits: DebrisHit[] = [];
  const orderedBodies = [...bodies].sort((a, b) => compareIds(a.id, b.id)),
    orderedTargets = [...targets].sort((a, b) => compareIds(a.id, b.id));
  for (const p of pieces) {
    if (time > p.expires + 1e-8) continue;
    if (time <= p.born + 1e-8) {
      alive.push(p);
      continue;
    }
    const old = { x: p.x, y: p.y };
    debrisGravity(p, orderedBodies, dt);
    const next = { x: p.x + p.vx * dt, y: p.y + p.vy * dt };
    let first = 2,
      target: string | undefined,
      bodyId: string | undefined;
    for (const b of orderedBodies) {
      if (b.kind === "gas" || b.kind === "nebula") continue;
      const prior = previous?.get(b.id) || b;
      const relative = { x: old.x + b.x - prior.x, y: old.y + b.y - prior.y };
      const f = segmentBody(relative, next, {
        ...b,
        radius: b.radius + p.radius,
        craters: b.craters.map((c) => ({
          ...c,
          radius: Math.max(0, c.radius - p.radius),
        })),
      });
      if (f !== null && f < first) {
        first = f;
        bodyId = b.id;
        target = undefined;
      }
    }
    for (const ship of orderedTargets) {
      const prior = previous?.get(ship.id) || ship;
      const f = segmentCircle(
        { x: old.x + ship.x - prior.x, y: old.y + ship.y - prior.y },
        next,
        ship,
        ship.radius + p.radius,
      );
      if (f !== null && f < first) {
        first = f;
        target = ship.id;
        bodyId = undefined;
      }
    }
    p.x = first <= 1 ? old.x + (next.x - old.x) * first : next.x;
    p.y = first <= 1 ? old.y + (next.y - old.y) * first : next.y;
    if (first <= 1) {
      const impact: Impact = {
        id: p.id,
        owner: p.owner,
        x: p.x,
        y: p.y,
        radius: p.radius,
        t: time - dt + first * dt,
      };
      if (target !== undefined) {
        hits.push({ ...impact, kind: "target", target, damage: p.damage });
      } else if (bodyId !== undefined) {
        hits.push({ ...impact, kind: "body", bodyId, damage: 0 });
      }
    } else if (
      time < p.expires &&
      p.x >= -200 &&
      p.y >= -200 &&
      p.x <= bounds + 200 &&
      p.y <= bounds + 200
    )
      alive.push(p);
  }
  hits.sort((a, b) => a.t - b.t || compareIds(a.id, b.id));
  return { pieces: alive, hits };
}
