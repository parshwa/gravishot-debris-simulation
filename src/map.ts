import type { Body, Vec } from "./types.ts";
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export function solidAt(p: Vec, b: Body) {
  return (
    !["gas", "nebula"].includes(b.kind) &&
    distance(p, b) <= b.radius &&
    !b.craters.some((c) => distance(p, c) < c.radius)
  );
}
export function segmentCircle(
  a: Vec,
  b: Vec,
  c: Vec,
  r: number,
): number | null {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    fx = a.x - c.x,
    fy = a.y - c.y;
  const aa = dx * dx + dy * dy,
    cc = fx * fx + fy * fy - r * r;
  if (cc <= 0) return 0;
  if (!aa) return null;
  const bb = 2 * (fx * dx + fy * dy),
    disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}
export function segmentBody(a: Vec, b: Vec, body: Body): number | null {
  if (body.kind === "gas" || body.kind === "nebula") return null;
  const first = segmentCircle(a, b, body, body.radius);
  if (first === null) return null;
  // Preserve exact tangencies; probing past contact can leave the circle.
  if (body.craters.length === 0) return first;
  const cuts = [first, 1];
  const dx = b.x - a.x,
    dy = b.y - a.y,
    aa = dx * dx + dy * dy;
  if (!aa) return solidAt(a, body) ? 0 : null;
  for (const c of body.craters) {
    const fx = a.x - c.x,
      fy = a.y - c.y,
      bb = 2 * (fx * dx + fy * dy),
      cc = fx * fx + fy * fy - c.radius ** 2;
    const disc = bb * bb - 4 * aa * cc;
    if (disc >= 0)
      for (const t of [
        (-bb - Math.sqrt(disc)) / (2 * aa),
        (-bb + Math.sqrt(disc)) / (2 * aa),
      ])
        if (t >= first && t <= 1) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  for (let i = 0; i < cuts.length; i++) {
    const t = cuts[i];
    const probe = Math.min(1, t + 1e-7);
    if (solidAt({ x: a.x + dx * probe, y: a.y + dy * probe }, body)) return t;
  }
  return null;
}
