import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";
import { MateAttentionSource } from "./zeropsAttention.ts";

const Counter = Schema.Struct({
  high: NonNegativeInt,
  oom: NonNegativeInt,
  oomKill: NonNegativeInt,
});
const PressureLine = Schema.Struct({ avg10: Schema.Finite, total: NonNegativeInt });
export const ResourcePressure = Schema.Struct({
  some: PressureLine,
  full: Schema.NullOr(PressureLine),
});
export type ResourcePressure = typeof ResourcePressure.Type;
export const MateResourceHealth = Schema.Struct({
  status: Schema.Literals(["ok", "strained", "unknown"]),
  severity: Schema.Literals(["warning", "critical"]),
  resources: Schema.Array(Schema.Literals(["memory", "disk", "cpu"])),
  memory: Schema.NullOr(
    Schema.Struct({
      scope: Schema.optionalKey(Schema.String),
      current: NonNegativeInt,
      high: Schema.NullOr(NonNegativeInt),
      max: Schema.NullOr(NonNegativeInt),
      events: Counter,
      growth: Counter,
      pressure: Schema.NullOr(ResourcePressure),
      swapCurrent: Schema.NullOr(NonNegativeInt),
      swapMax: Schema.NullOr(NonNegativeInt),
    }),
  ),
  cpu: Schema.NullOr(ResourcePressure),
  io: Schema.NullOr(ResourcePressure),
  disk: Schema.NullOr(Schema.Struct({ free: NonNegativeInt, total: NonNegativeInt })),
  unavailable: Schema.Array(Schema.String),
});
export type MateResourceHealth = typeof MateResourceHealth.Type;
export const MateHealth = Schema.Struct({
  source: MateAttentionSource,
  sampledAt: IsoDateTime,
  evidence: MateResourceHealth,
});
export type MateHealth = typeof MateHealth.Type;
