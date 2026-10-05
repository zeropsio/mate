import * as Duration from "effect/Duration";
import { startCore } from "../../../../hq/test/harness/runningCore.ts";
import type { FakeWorld } from "../../../../hq/test/harness/zeropsFake.ts";

/** Milliseconds; overrides are local to one scenario. */
export interface HqTimings {
  pingEvery?: number;
  reconcileEvery?: number;
  streamRecheck?: number;
}

export function startScenarioCore(
  zeropsHttp: { baseUrl: string; world: FakeWorld },
  timings: HqTimings = {},
) {
  return startCore(true, {
    zeropsHttp,
    pingEvery: Duration.millis(timings.pingEvery ?? 20_000),
    reconcileEvery: Duration.millis(timings.reconcileEvery ?? 60_000),
    streamRecheck: Duration.millis(timings.streamRecheck ?? 30_000),
  });
}
