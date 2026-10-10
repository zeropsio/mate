import { V1UpdateDrain } from "../update/V1UpdateDrain.ts";
// @effect-diagnostics nodeBuiltinImport:off
/**
 * The server's half of spec-mate.md §2.9 "Updates in the product — one
 * reader, one verb": zcp is the only place that compares an installed mate
 * with the stable manifest (`zcp mate status --json`); this service relays
 * that answer through {@link ZeropsCli}, holds the last good result, and
 * exposes it as the descriptor's `update` field.
 *
 * Runs the check once at start, then hourly (both cache-served through
 * `zcp mate status`), again whenever zcp's update state or manifest cache
 * file changes, and re-reads the manifest on demand via
 * `zerops.mate.checkUpdate` (spec-mate.md §2.9 step 2 "on demand"), passing
 * `--refresh` so `zcp` bypasses its own cache — never fabricating a
 * value: outside a Zerops project, or when `zcp` is not on PATH (MU-3), the
 * held value is always absent. A transient `mate status` failure elsewhere
 * (network, a malformed answer) is logged and the previous good value kept,
 * so one flaky check does not blank the card.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Queue from "effect/Queue";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { MateAutoUpdatePolicy } from "./MateAutoUpdatePolicy.ts";
import { RpcUpdateAdmission } from "../RpcUpdateAdmission.ts";
import { MateEngine } from "../engine/MateEngine.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { mayAutoUpdate } from "./mateAutoUpdate.logic.ts";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

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
    /** {@link current} now, then every time it changes: the Mate's link to HQ follows it. */
    readonly changes: Stream.Stream<ExecutionEnvironmentUpdate | undefined>;
    /** Runs `zcp mate status` now and updates {@link current}. Never fails. */
    readonly refresh: Effect.Effect<void>;
    /**
     * `zerops.mate.checkUpdate`'s implementation: runs `zcp mate status
     * --refresh` now, updates {@link current}, and returns the new value —
     * the descriptor's `update` field re-read on demand (MU-1: never a
     * version comparison done here or by the client). A failed check keeps
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
});

export interface ZeropsMateUpdateOptions {
  readonly cli: ZeropsCli["Service"];
  readonly isZeropsEnvironment: boolean;
  readonly refreshInterval?: Duration.Input;
  readonly policy?:
    | Pick<MateAutoUpdatePolicy["Service"], "current" | "changes" | "verify">
    | undefined;
  readonly stateFile?: string | undefined;
  /** zcp's cached release manifest; rewritten whenever anyone's `zcp mate status` fetches one. */
  readonly manifestFile?: string | undefined;
  readonly recoverAdmission?: Effect.Effect<void> | undefined;
}

export const make = (options: ZeropsMateUpdateOptions) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<ExecutionEnvironmentUpdate | undefined>(undefined);

    let launching = false;
    const automatic = (status: MateStatusResult): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (launching || options.policy === undefined) return;
        const policy = yield* options.policy.verify;
        if (
          !mayAutoUpdate({
            enabled: Option.isSome(policy) ? policy.value.enabled : undefined,
            available: status.updateAvailable,
            latest: status.latest,
            updater: status.updater,
          })
        )
          return;
        launching = true;
        yield* options.cli.mateUpdate({ automatic: true }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("automatic Mate update could not start", { detail: error.message }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              launching = false;
            }),
          ),
        );
      });
    const readStatus = (input?: { refresh?: boolean; local?: boolean }) =>
      options.cli
        .mateStatus(input)
        .pipe(
          Effect.flatMap((status) =>
            SubscriptionRef.set(state, toDescriptorUpdate(status)).pipe(
              Effect.andThen(
                ["updated", "postponed", "failed"].includes(status.updater?.phase ?? "")
                  ? (options.recoverAdmission ?? Effect.void)
                  : Effect.void,
              ),
              Effect.andThen(input?.local ? Effect.void : automatic(status)),
            ),
          ),
        );
    const refresh: Effect.Effect<void> = options.isZeropsEnvironment
      ? Effect.suspend(() => readStatus({ refresh: true })).pipe(
          Effect.catchTags({
            ZeropsCliNotFound: () => SubscriptionRef.set(state, undefined),
            ZeropsCliFailed: (error) =>
              Effect.logWarning("zerops mate update: status check failed", {
                detail: error.message,
              }),
          }),
        )
      : SubscriptionRef.set(state, undefined);

    const check: Effect.Effect<ExecutionEnvironmentUpdate | undefined> = options.isZeropsEnvironment
      ? Effect.suspend(() => options.cli.mateStatus({ refresh: true })).pipe(
          Effect.flatMap((status) => {
            const mapped = toDescriptorUpdate(status);
            return SubscriptionRef.set(state, mapped).pipe(Effect.as(mapped));
          }),
          Effect.catchTags({
            ZeropsCliNotFound: () =>
              SubscriptionRef.set(state, undefined).pipe(Effect.as(undefined)),
            ZeropsCliFailed: (error) =>
              Effect.logWarning("zerops mate update: on-demand check failed", {
                detail: error.message,
              }).pipe(Effect.andThen(SubscriptionRef.get(state))),
          }),
        )
      : SubscriptionRef.get(state);

    // The first check runs synchronously ("at start") so a descriptor read
    // right after boot already sees a real answer; only the hourly repeats
    // run in the background.
    yield* options.isZeropsEnvironment
      ? readStatus({ local: true }).pipe(Effect.catch(() => Effect.void))
      : Effect.void;
    if (options.policy !== undefined && options.isZeropsEnvironment) {
      yield* forkParked(
        options.policy.changes.pipe(
          Stream.changesWith(
            (left, right) =>
              left._tag === right._tag &&
              (Option.isNone(left) ||
                (Option.isSome(right) &&
                  left.value.orgId === right.value.orgId &&
                  left.value.revision === right.value.revision &&
                  left.value.enabled === right.value.enabled)),
          ),
          Stream.runForEach(() => refresh),
        ),
      );
    }
    // zcp's update state and its release manifest cache both change outside
    // this server (an update, or a refresh by the Mate's agent, a shell or
    // zcp's boot): a change re-reads the cache-served `mate status --local`.
    const watched = [options.stateFile, options.manifestFile].filter(
      (file): file is string => file !== undefined,
    );
    if (watched.length > 0 && options.isZeropsEnvironment) {
      const notices = yield* Queue.unbounded<void>();
      for (const dir of new Set(watched.map((file) => NodePath.dirname(file)))) {
        const names = new Set(
          watched
            .filter((file) => NodePath.dirname(file) === dir)
            .map((file) => NodePath.basename(file)),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            try {
              return NodeFS.watch(dir, (_event, name) => {
                if (name !== null && names.has(name)) Queue.offerUnsafe(notices, undefined);
              }).on("error", () => {});
            } catch {
              return undefined;
            }
          }),
          (watcher) => Effect.sync(() => watcher?.close()),
        );
      }
      yield* forkParked(
        Queue.take(notices).pipe(
          // One write fires several events a few milliseconds apart: one re-read.
          Effect.andThen(Effect.sleep(Duration.millis(100))),
          Effect.andThen(Queue.clear(notices)),
          Effect.andThen(Effect.suspend(() => readStatus({ local: true }))),
          Effect.catch(() => Effect.void),
          Effect.forever,
        ),
      );
    }
    if (options.isZeropsEnvironment) {
      yield* forkParked(
        Effect.gen(function* () {
          while (true) {
            const jitter = yield* Random.next;
            const interval =
              options.refreshInterval ?? Duration.millis(3_600_000 * (0.9 + jitter * 0.2));
            yield* Effect.sleep(interval);
            yield* refresh;
          }
        }),
      );
    }

    return {
      current: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      refresh,
      check,
    } satisfies ZeropsMateUpdate["Service"];
  });

/**
 * zcp's release manifest cache: `filepath.Join(mate.Prefix(), "manifest.json")`
 * with `Prefix() = $HOME/.zcp/mate` and HOME falling back to /home/zerops
 * (zcp internal/mate/manifest.go `manifestCachePath`, internal/runtime `HomeDir`).
 */
const zcpManifestCacheFile = (): string => {
  const home = process.env.HOME;
  return NodePath.join(
    home === undefined || home === "" || home === "/" ? "/home/zerops" : home,
    ".zcp",
    "mate",
    "manifest.json",
  );
};

export const layer = Layer.effect(
  ZeropsMateUpdate,
  Effect.gen(function* () {
    const cli = yield* ZeropsCli;
    const config = yield* ServerConfig;
    const policy = yield* MateAutoUpdatePolicy;
    const engine = yield* MateEngine;
    const legacyDrain = Option.getOrUndefined(yield* Effect.serviceOption(V1UpdateDrain));
    const terminal = yield* TerminalManager;
    const rpcAdmission = Option.getOrUndefined(yield* Effect.serviceOption(RpcUpdateAdmission));
    return yield* make({
      cli,
      isZeropsEnvironment: isZeropsEnvironment(config),
      policy,
      stateFile: process.env.ZCP_MATE_UPDATE_STATE_FILE,
      manifestFile: zcpManifestCacheFile(),
      recoverAdmission: (
        (engine.live ? engine.updateDrain : legacyDrain)?.cancel ?? Effect.void
      ).pipe(
        Effect.andThen(terminal.updateDrain?.cancel ?? Effect.void),
        Effect.andThen(rpcAdmission?.cancel ?? Effect.void),
      ),
    });
  }),
);
