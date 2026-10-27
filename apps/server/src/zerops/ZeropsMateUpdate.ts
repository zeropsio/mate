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
import { mayAutoRestart, mayAutoUpdate, restartReading } from "./mateAutoUpdate.logic.ts";
import { MATE_UPDATE_DRAIN_MINUTES } from "@t3tools/shared/mateAutoUpdatePolicy";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import { forkParked } from "../serverActivation.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  SELF_RESTART_TOO_OLD,
  ZCP_SELF_RESTART_SINCE,
  ZeropsCli,
  zcpAtLeast,
} from "./ZeropsCli.ts";
import { makeMateUpdateDrain, reopenMateUpdateAdmission } from "./mateUpdateDrainLive.ts";
import type { MateStatusResult } from "./zeropsMateUpdateParse.ts";

/** How often the background check re-reads `zcp mate status` (spec-mate.md §2.9). */
export const MATE_STATUS_REFRESH_INTERVAL = Duration.hours(1);

/**
 * How long a restart the platform took may leave this server running before it is called off:
 * admission opens again and the line says the restart did not happen.
 */
export const MATE_RESTART_GRACE = Duration.minutes(5);

/** A restart's drain that ran out of time, or found the organization's policy off. */
const RESTART_WORK_NOT_DONE = `its work wasn't done within ${MATE_UPDATE_DRAIN_MINUTES} minutes`;

/** What the Mate's own restart needs beside zcp (spec-mate §2.9: the update drain, its fence). */
export interface MateRestartPorts {
  /**
   * The update drain: true once the Mate is idle with admission closed; false when its work
   * outlasts the deadline or, for an automatic update, the organization's policy says no.
   */
  readonly drain: (input: { readonly automatic: boolean }) => Effect.Effect<boolean>;
  /** Opens admission again after a drain whose restart did not happen. */
  readonly reopen: Effect.Effect<void>;
  /** The reading a restart was last made for, kept across the restart it causes. */
  readonly marker: {
    readonly read: Effect.Effect<string | undefined>;
    readonly write: (reading: string) => Effect.Effect<void>;
  };
  readonly grace?: Duration.Input;
}

/** What a person's Update on a Mate needing a restart answers at once. */
export type MateRestartStart =
  | { readonly started: true }
  | { readonly started: false; readonly reason: string };

type RestartProgress = Pick<NonNullable<ExecutionEnvironmentUpdate["restart"]>, "phase" | "reason">;

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
    /**
     * The person's Update on a Mate whose last reading needs a restart: drains it (admission
     * closed at once, as a person's update does) and restarts the container through zcp. Answers
     * as soon as the restart is under way, or why it cannot start.
     */
    readonly restart: Effect.Effect<MateRestartStart>;
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
  /** Watches a directory for the files above; a test hands the change itself, not the OS's report. */
  readonly watch?: (
    dir: string,
    listener: (event: string, name: string | null) => void,
  ) => { readonly close: () => void };
  readonly recoverAdmission?: Effect.Effect<void> | undefined;
  /** Absent where this server cannot drain itself: a Mate needing a restart is never restarted. */
  readonly restart?: MateRestartPorts | undefined;
}

export const make = (options: ZeropsMateUpdateOptions) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make<ExecutionEnvironmentUpdate | undefined>(undefined);
    const scope = yield* Effect.scope;

    // The line is zcp's last reading, with this server's own restart progress laid over it.
    let reading: MateStatusResult | undefined;
    let progress: RestartProgress | undefined;
    // One restart at a time: set before anything yields, so a second press joins the first.
    let restartUnderWay = false;
    const line = (): ExecutionEnvironmentUpdate | undefined => {
      if (reading === undefined) return undefined;
      const mapped = toDescriptorUpdate(reading);
      return progress === undefined
        ? mapped
        : { ...mapped, restart: { ...(mapped.restart ?? { needed: false }), ...progress } };
    };
    const setReading = (status: MateStatusResult | undefined) =>
      Effect.suspend(() => {
        reading = status;
        // A restart called off for a reading that no longer needs one says nothing any more.
        if (!restartUnderWay && status?.restartNeeded !== true) progress = undefined;
        return SubscriptionRef.set(state, line());
      });
    const setProgress = (next: RestartProgress) =>
      Effect.suspend(() => {
        progress = next;
        return SubscriptionRef.set(state, line());
      });

    const restartPorts = options.restart;
    const attemptRestart = (
      ports: MateRestartPorts,
      automatic: boolean,
      key: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* setProgress({ phase: "draining" });
        if (!(yield* ports.drain({ automatic }))) {
          // An automatic drain also stops when the organization pauses automatic updates.
          const paused =
            automatic &&
            options.policy !== undefined &&
            !Option.exists(yield* options.policy.verify, (policy) => policy.enabled);
          yield* setProgress({
            phase: "postponed",
            reason: paused ? "automatic updates were paused" : RESTART_WORK_NOT_DONE,
          });
          return;
        }
        // Written before the platform is asked: the restart it causes ends this process.
        yield* ports.marker.write(key);
        const answer = yield* options.cli.selfRestart;
        if (answer.outcome === "refused") {
          yield* ports.reopen;
          yield* setProgress({ phase: "postponed", reason: answer.reason });
          return;
        }
        // Said once the platform took it, never before: admission stays closed until it ends us.
        yield* setProgress({ phase: "restarting" });
        yield* Effect.logInfo("mate update: the platform took the container restart", {
          process: answer.process,
        });
        yield* Effect.sleep(ports.grace ?? MATE_RESTART_GRACE);
        yield* ports.reopen;
        yield* setProgress({ phase: "postponed", reason: "the container did not restart" });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            restartUnderWay = false;
          }),
        ),
      );
    const startRestart = (
      status: MateStatusResult,
      automatic: boolean,
    ): Effect.Effect<MateRestartStart> =>
      Effect.gen(function* () {
        if (restartPorts === undefined)
          return { started: false, reason: "this Mate can't restart itself here" } as const;
        if (restartUnderWay) return { started: true } as const;
        restartUnderWay = true;
        // An older zcp is never asked: it does not know the verb.
        if (!zcpAtLeast(yield* options.cli.version, ZCP_SELF_RESTART_SINCE)) {
          restartUnderWay = false;
          yield* setProgress({ phase: "postponed", reason: SELF_RESTART_TOO_OLD });
          return { started: false, reason: SELF_RESTART_TOO_OLD } as const;
        }
        yield* Effect.forkIn(
          attemptRestart(restartPorts, automatic, restartReading(status)),
          scope,
        );
        return { started: true } as const;
      });
    const restart: Effect.Effect<MateRestartStart> = Effect.suspend(() =>
      reading?.restartNeeded === true
        ? startRestart(reading, false)
        : Effect.succeed({ started: false, reason: "this Mate needs no restart" } as const),
    );

    /** The organization's automatic update of a Mate that only a restart gets current. */
    const automaticRestart = (status: MateStatusResult, enabled: boolean | undefined) =>
      Effect.gen(function* () {
        if (restartPorts === undefined) return;
        const key = restartReading(status);
        const restartedFor = yield* restartPorts.marker.read;
        if (
          mayAutoRestart({
            enabled,
            restartNeeded: true,
            reading: key,
            restartedFor,
            underWay: restartUnderWay,
          })
        ) {
          yield* startRestart(status, true);
          return;
        }
        // Already tried for this reading (the container came back still behind, or the platform
        // refused): said once, never tried again by itself; the person's Update tries again.
        if (enabled === true && !restartUnderWay && restartedFor === key && progress === undefined)
          yield* setProgress({
            phase: "postponed",
            reason:
              status.zcp?.behind === true
                ? `a restart was already tried for zcp ${status.zcp.latest}; Update to try again`
                : "a restart was already tried; Update to try again",
          });
      });

    let launching = false;
    const automatic = (status: MateStatusResult): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (launching || options.policy === undefined) return;
        const policy = yield* options.policy.verify;
        const enabled = Option.isSome(policy) ? policy.value.enabled : undefined;
        // Only a restart gets this Mate current: `mate update` would not.
        if (status.restartNeeded === true) {
          yield* automaticRestart(status, enabled);
          return;
        }
        if (
          !mayAutoUpdate({
            enabled,
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
      options.cli.mateStatus(input).pipe(
        Effect.flatMap((status) =>
          setReading(status).pipe(
            Effect.andThen(
              // zcp's settled record reopens what its update closed; never under a restart's drain.
              !restartUnderWay &&
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
            ZeropsCliNotFound: () => setReading(undefined),
            ZeropsCliFailed: (error) =>
              Effect.logWarning("zerops mate update: status check failed", {
                detail: error.message,
              }),
          }),
        )
      : setReading(undefined);

    const check: Effect.Effect<ExecutionEnvironmentUpdate | undefined> = options.isZeropsEnvironment
      ? Effect.suspend(() => options.cli.mateStatus({ refresh: true })).pipe(
          Effect.flatMap((status) => setReading(status).pipe(Effect.andThen(Effect.sync(line)))),
          Effect.catchTags({
            ZeropsCliNotFound: () => setReading(undefined).pipe(Effect.as(undefined)),
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
      const watch =
        options.watch ?? ((dir, listener) => NodeFS.watch(dir, listener).on("error", () => {}));
      for (const dir of new Set(watched.map((file) => NodePath.dirname(file)))) {
        const names = new Set(
          watched
            .filter((file) => NodePath.dirname(file) === dir)
            .map((file) => NodePath.basename(file)),
        );
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            try {
              return watch(dir, (_event, name) => {
                if (name !== null && names.has(name)) Queue.offerUnsafe(notices, undefined);
              });
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
      restart,
    } satisfies ZeropsMateUpdate["Service"];
  });

/**
 * zcp's release manifest cache: `filepath.Join(mate.Prefix(), "manifest.json")`
 * with `Prefix() = $HOME/.zcp/mate` and HOME falling back to /home/zerops
 * (zcp internal/mate/manifest.go `manifestCachePath`, internal/runtime `HomeDir`).
 */
const zcpManifestCacheFile = (home: string): string => {
  return NodePath.join(
    home === "" || home === "/" ? "/home/zerops" : home,
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
    const reopen = yield* reopenMateUpdateAdmission;
    const markerFile = NodePath.join(config.stateDir, "zcp-restart-reading");
    return yield* make({
      cli,
      isZeropsEnvironment: isZeropsEnvironment(config),
      policy,
      stateFile: config.zerops?.mateUpdateStateFile,
      manifestFile: zcpManifestCacheFile(config.homeDir),
      recoverAdmission: reopen,
      restart: {
        drain: yield* makeMateUpdateDrain,
        reopen,
        marker: {
          read: Effect.sync(() => {
            try {
              return NodeFS.readFileSync(markerFile, "utf8").trim() || undefined;
            } catch {
              return undefined;
            }
          }),
          write: (reading) =>
            Effect.try(() => NodeFS.writeFileSync(markerFile, `${reading}\n`)).pipe(
              Effect.catch((error) =>
                Effect.logWarning("mate update: the restart's reading could not be kept", {
                  detail: String(error),
                }),
              ),
            ),
        },
      },
    });
  }),
);
