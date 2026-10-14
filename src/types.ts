export type Vec = { x: number; y: number };
export type WeaponId =
  | "shell"
  | "emp"
  | "inverter"
  | "singularity"
  | "rover"
  | "skipper"
  | "splitter"
  | "pulsar"
  | "seeder"
  | "eraser";
export type BodyKind =
  | "planet"
  | "gas"
  | "moon"
  | "blackhole"
  | "asteroid"
  | "nebula"
  | "comet"
  | "satellite";
export interface Body extends Vec {
  id: string;
  kind: BodyKind;
  radius: number;
  mass: number;
  craters: (Vec & { radius: number })[];
  velocity?: Vec;
  orbit?: { parent: string; angle: number; rx: number; ry: number };
  ttl?: number;
  inverted?: number;
}
export type DebrisMaterial = "rock" | "ice" | "metal";
