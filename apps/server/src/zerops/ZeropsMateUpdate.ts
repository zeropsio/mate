/**
 * The server's half of spec-mate.md §2.9 "Updates in the product — one reader, one verb": zcp is
 * the only place that compares an installed mate with the stable manifest (`zcp mate status
 * --json`), and the only one that decides which version runs and when to restart; this service
 * relays its answer through {@link ZeropsCli}, holds the last good result, and exposes it as the
 * descriptor's `update` field.
 *
 * Reads it once at start (`--local`, from zcp's last read without a network call) and again from
 * the release source whenever the screen asks (`zerops.mate.checkUpdate`) or a person's Update ran — never fabricating a value:
 * outside a Zerops project, or when `zcp` is not on PATH (MU-3), the held value is always absent.
 * A transient `mate status` failure elsewhere (network, a malformed answer) is logged and the
 * previous good value kept, so one flaky check does not blank the card.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsCli } from "./ZeropsCli.ts";
import type { MateStatusResult } from "./zeropsMateUpdateParse.ts";

export class ZeropsMateUpdate extends Context.Service<
  ZeropsMateUpdate,
  {
    /** The last good `mate status` answer, mapped to the descriptor shape. Absent per MU-3. */
    readonly current: Effect.Effect<ExecutionEnvironmentUpdate | undefined>;
    /** {@link current} now, then every time it changes: the Mate's link to HQ follows it. */
    readonly changes: Stream.Stream<ExecutionEnvironmentUpdate | undefined>;
    /**
     * `zerops.mate.checkUpdate`'s implementation: runs `zcp mate status` now, updates
     * {@link current}, and returns the new value — the descriptor's `update` field re-read on
     * demand (MU-1: never a version comparison done here or by the client). A failed check keeps
     * the previous held value and returns it unchanged.
     */
    readonly check: Effect.Effect<ExecutionEnvironmentUpdate | undefined>;
  }
>()("t3/zerops/ZeropsMateUpdate") {}

const toDescriptorUpdate = (status: MateStatusResult): ExecutionEnvironmentUpdate => ({
  installed: status.installed,
  latest: status.latest,
  available: status.updateAvailable,
  checkedAt: status.checkedAt,
  ...(status.updater === undefined ? {} : { automatic: status.updater }),
  ...(status.zcp === undefined ? {} : { zcp: status.zcp }),
  ...(status.restartNeeded === undefined
    ? {}
    : {
        restart: {
          needed: status.restartNeeded,
          ...(status.why === undefined ? {} : { why: status.why }),
        },
      }),
});

/** Whether two `mate status` answers say the same, whenever each was run. */
const sameAnswer = (held: MateStatusResult, next: MateStatusResult): boolean => {
  const { checkedAt: _held, ...heldSays } = held;
  const { checkedAt: _next, ...nextSays } = next;
  return Equal.equals(heldSays, nextSays);
};

export interface ZeropsMateUpdateOptions {
  readonly cli: Pick<ZeropsCli["Service"], "mateStatus">;
  readonly isZeropsEnvironment: boolean;
}

export const make = (options: ZeropsMateUpdateOptions) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<ExecutionEnvironmentUpdate | undefined>(undefined);
    let reading: MateStatusResult | undefined;
    const setReading = (status: MateStatusResult | undefined) =>
      Effect.suspend(() => {
        // zcp stamps every answer with the moment it ran: an answer that says nothing new keeps
        // the stamp of the one that last did, and is not published again, so neither the link to
        // HQ nor any client hears a re-read that found nothing.
        if (status !== undefined && reading !== undefined && sameAnswer(reading, status))
          return Effect.void;
        reading = status;
        return SubscriptionRef.set(
          state,
          status === undefined ? undefined : toDescriptorUpdate(status),
        );
      });

    if (options.isZeropsEnvironment)
      yield* options.cli.mateStatus({ local: true }).pipe(
        Effect.flatMap(setReading),
        Effect.catchTags({
          ZeropsCliNotFound: () =>
            Effect.logWarning("zerops mate update: local status unavailable"),
          ZeropsCliFailed: () => Effect.logWarning("zerops mate update: local status read failed"),
        }),
      );

    const check: Effect.Effect<ExecutionEnvironmentUpdate | undefined> = options.isZeropsEnvironment
      ? Effect.suspend(() => options.cli.mateStatus()).pipe(
          Effect.flatMap(setReading),
          Effect.andThen(SubscriptionRef.get(state)),
          Effect.catchTags({
            ZeropsCliNotFound: () => setReading(undefined).pipe(Effect.as(undefined)),
            ZeropsCliFailed: (error) =>
              Effect.logWarning("zerops mate update: on-demand check failed", {
                detail: error.message,
              }).pipe(Effect.andThen(SubscriptionRef.get(state))),
          }),
        )
      : SubscriptionRef.get(state);

    return {
      current: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      check,
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
