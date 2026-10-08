import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";
import { MateAttentionSource } from "./zeropsAttention.ts";

const Counter = Schema.Struct({
  high: NonNegativeInt,
  // Optional for retained reports and older Mates that did not sample max events.
  max: Schema.optionalKey(NonNegativeInt),
  oom: NonNegativeInt,
  oomKill: NonNegativeInt,
});
const PressureAverage = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const PressureLine = Schema.Struct({
  avg10: PressureAverage,
  // Optional for retained reports and older Mates.
  avg60: Schema.optionalKey(PressureAverage),
  avg300: Schema.optionalKey(PressureAverage),
  total: NonNegativeInt,
});
export const ResourcePressure = Schema.Struct({
  some: PressureLine,
  full: Schema.NullOr(PressureLine),
});
export type ResourcePressure = typeof ResourcePressure.Type;

/** No preceding sample is retained: both longer averages must prove sustained stalls.
 * Used by notice eligibility and hierarchy selection so brief spikes cannot hide sustained stalls.
 */
export function sustainedPressureLevel(pressure: ResourcePressure | null): number {
  const level = (line: ResourcePressure["full"], threshold: number) =>
    line === null ? 0 : Math.min(line.avg60 ?? 0, line.avg300 ?? 0) / threshold;
  return pressure === null ? 0 : Math.max(level(pressure.full, 10), level(pressure.some, 40));
}
export const MateResourceHealth = Schema.Struct({
  status: Schema.Literals(["ok", "strained", "unknown"]),
  severity: Schema.Literals(["warning", "critical"]),
  resources: Schema.Array(Schema.Literals(["memory", "disk", "io", "cpu"])),
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
      swapGrowth: Schema.optionalKey(NonNegativeInt),
    }),
  ),
  cpu: Schema.NullOr(
    Schema.Struct({
      ...ResourcePressure.fields,
      // Optional while older Mates/HQ instances still relay the avg10-only report.
      window: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            scope: Schema.String,
            elapsedUsec: NonNegativeInt.check(Schema.isGreaterThan(0)),
            usageUsec: NonNegativeInt,
            someUsec: NonNegativeInt,
            fullUsec: Schema.NullOr(NonNegativeInt),
            capacityCpus: Schema.Finite.check(Schema.isGreaterThan(0)),
            throttledPeriods: NonNegativeInt,
            saturated: Schema.Boolean,
            consumer: Schema.NullOr(
              Schema.Struct({
                pid: NonNegativeInt,
                name: Schema.String,
                cpuCores: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
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
