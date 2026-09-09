/**
 * The server's half of spec-mate.md §2.9 "Updates in the product — one
 * reader, one verb": zcp is the only place that compares an installed mate
 * with the stable manifest (`zcp mate status --json`); this service relays
 * that answer through {@link ZeropsCli}, holds the last good result, and
 * exposes it as the descriptor's `update` field.
 *
 * Runs the check once at start, then hourly, and again on demand (a client
 * probe, or after a successful `zerops.mate.update`) — never fabricating a
 * value: outside a Zerops project, or when `zcp` is not on PATH (MU-3), the
 * held value is always absent. A transient `mate status` failure elsewhere
 * (network, a malformed answer) is logged and the previous good value kept,
 * so one flaky check does not blank the card.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import { forkParked } from "../serverActivation.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsCli } from "./ZeropsCli.ts";
import type { MateStatusResult } from "./zeropsMateUpdateParse.ts";

/** How often the background check re-reads `zcp mate status` (spec-mate.md §2.9). */
export const MATE_STATUS_REFRESH_INTERVAL = Duration.hours(1);

export class ZeropsMateUpdate extends Context.Service<
  ZeropsMateUpdate,
  {
    /** The last good `mate status` answer, mapped to the descriptor shape. Absent per MU-3. */
    readonly current: Effect.Effect<ExecutionEnvironmentUpdate | undefined>;
    /** Runs `zcp mate status` now and updates {@link current}. Never fails. */
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsMateUpdate") {}

const toDescriptorUpdate = (status: MateStatusResult): ExecutionEnvironmentUpdate => ({
  installed: status.installed,
  latest: status.latest,
  available: status.updateAvailable,
  checkedAt: status.checkedAt,
});

export interface ZeropsMateUpdateOptions {
  readonly cli: ZeropsCli["Service"];
  readonly isZeropsEnvironment: boolean;
  readonly refreshInterval?: Duration.Input;
}

export const make = (options: ZeropsMateUpdateOptions) =>
  Effect.gen(function* () {
    const state = yield* Ref.make<ExecutionEnvironmentUpdate | undefined>(undefined);

    const refresh: Effect.Effect<void> = options.isZeropsEnvironment
      ? Effect.suspend(() => options.cli.mateStatus()).pipe(
          Effect.flatMap((status) => Ref.set(state, toDescriptorUpdate(status))),
          Effect.catchTags({
            ZeropsCliNotFound: () => Ref.set(state, undefined),
            ZeropsCliFailed: (error) =>
              Effect.logWarning("zerops mate update: status check failed", {
                detail: error.message,
              }),
          }),
        )
      : Ref.set(state, undefined);

    // The first check runs synchronously ("at start") so a descriptor read
    // right after boot already sees a real answer; only the hourly repeats
    // run in the background.
    yield* refresh;
    if (options.isZeropsEnvironment) {
      const interval = options.refreshInterval ?? MATE_STATUS_REFRESH_INTERVAL;
      yield* forkParked(
        refresh.pipe(Effect.delay(interval), Effect.repeat(Schedule.spaced(interval))),
      );
    }

    return {
      current: Ref.get(state),
      refresh,
    } satisfies ZeropsMateUpdate["Service"];
  });

export const layer = Layer.effect(
  ZeropsMateUpdate,
  Effect.gen(function* () {
    const cli = yield* ZeropsCli;
    const config = yield* ServerConfig;
    return yield* make({ cli, isZeropsEnvironment: isZeropsEnvironment(config) });
  }),
);
