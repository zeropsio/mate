// @effect-diagnostics nodeBuiltinImport:off
/**
 * spec-mate.md §2.9 invariants:
 * - MU-2: a failing `zcp mate update` is a successful RPC carrying its JSON.
 * - MU-3: the descriptor's `update` field is absent, never fabricated, when
 *   `zcp` cannot be run.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodePath from "node:path";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";

import {
  ZCP_SELF_RESTART_SINCE,
  ZeropsCliFailed,
  ZeropsCliNotFound,
  type SelfRestartResult,
  type ZeropsCli,
} from "./ZeropsCli.ts";
import { make } from "./ZeropsMateUpdate.ts";
import type { MateStatusResult } from "./zeropsMateUpdateParse.ts";

const STATUS_RESULT: MateStatusResult = {
  installed: "0.8.0",
  latest: "0.8.1",
  contract: 1,
  updateAvailable: true,
  checkedAt: "2026-09-09T00:00:00Z",
};

const stubCli = (
  mateStatus: (options?: {
    readonly refresh?: boolean;
    readonly local?: boolean;
  }) => Effect.Effect<MateStatusResult, ZeropsCliNotFound | ZeropsCliFailed>,
) => ({
  mateStatus,
  mateUpdate: () => Effect.die("not used"),
  version: Effect.die("not used"),
  leaseRelease: () => Effect.die("not used"),
  selfRestart: Effect.die("not used"),
});

describe("ZeropsMateUpdate (MU-3: absent, never fabricated)", () => {
  it.effect("holds nothing outside a Zerops project — mateStatus is never called", () =>
    Effect.gen(function* () {
      let called = false;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => {
            called = true;
            return Effect.succeed(STATUS_RESULT);
          }),
          isZeropsEnvironment: false,
        }),
      );
      expect(yield* service.current).toBeUndefined();
      expect(called).toBe(false);
    }),
  );

  it.effect("holds the mapped status once started inside a Zerops project", () =>
    Effect.gen(function* () {
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => Effect.succeed(STATUS_RESULT)),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
        }),
      );
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect("clears to absent when zcp is not found", () =>
    Effect.gen(function* () {
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => Effect.fail(new ZeropsCliNotFound({ command: "zcp" }))),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
        }),
      );
      expect(yield* service.current).toBeUndefined();
    }),
  );

  it.effect("keeps the last good answer through a transient failure", () =>
    Effect.gen(function* () {
      let call = 0;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => {
            call += 1;
            return call === 1
              ? Effect.succeed(STATUS_RESULT)
              : Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "timed out" }));
          }),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
        }),
      );
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
      yield* service.refresh;
      expect(yield* service.current).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
    }),
  );

  it.effect(
    "refresh updates the held answer on demand (used after a successful update — MU-2)",
    () =>
      Effect.gen(function* () {
        let installed = "0.8.0";
        const service = yield* Effect.scoped(
          make({
            cli: stubCli(() =>
              Effect.succeed({
                ...STATUS_RESULT,
                installed,
                updateAvailable: installed !== "0.8.1",
              }),
            ),
            isZeropsEnvironment: true,
            refreshInterval: Duration.hours(1),
          }),
        );
        expect((yield* service.current)?.available).toBe(true);
        installed = "0.8.1";
        yield* service.refresh;
        expect((yield* service.current)?.available).toBe(false);
      }),
  );

  it.effect("check re-reads the manifest with --refresh, updates and returns the new value", () =>
    Effect.gen(function* () {
      let installed = "0.8.0";
      let sawRefresh = false;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli((options) => {
            sawRefresh = options?.refresh === true;
            return Effect.succeed({
              ...STATUS_RESULT,
              installed,
              updateAvailable: installed !== "0.8.1",
            });
          }),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
        }),
      );
      installed = "0.8.1";
      const result = yield* service.check;
      expect(sawRefresh).toBe(true);
      expect(result?.available).toBe(false);
      expect((yield* service.current)?.available).toBe(false);
    }),
  );

  it.effect("check keeps the previous value when zcp fails", () =>
    Effect.gen(function* () {
      let call = 0;
      const service = yield* Effect.scoped(
        make({
          cli: stubCli(() => {
            call += 1;
            return call === 1
              ? Effect.succeed(STATUS_RESULT)
              : Effect.fail(new ZeropsCliFailed({ command: "zcp", reason: "timed out" }));
          }),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
        }),
      );
      const result = yield* service.check;
      expect(result).toEqual({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      });
      expect(yield* service.current).toEqual(result);
    }),
  );
});

describe("ZeropsMateUpdate's update line, followed", () => {
  // The Mate's link to HQ sends the line again whenever it moves (step A).
  it.effect("publishes a changed update line to whoever follows it", () =>
    Effect.gen(function* () {
      let latest = "0.8.1";
      const service = yield* make({
        cli: stubCli(() => Effect.succeed({ ...STATUS_RESULT, latest })),
        isZeropsEnvironment: true,
        refreshInterval: Duration.hours(1),
      });
      const heard = yield* service.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      latest = "0.8.2";
      yield* service.check;
      const lines = yield* Fiber.join(heard);
      expect(Array.from(lines).map((line) => line?.latest)).toEqual(["0.8.1", "0.8.2"]);
    }).pipe(Effect.scoped),
  );
});

describe("ZeropsMateUpdate hears zcp's own reads", () => {
  // zcp caches the release manifest it fetched (~/.zcp/mate/manifest.json, an
  // hour's TTL); a refresh by the Mate's agent, a shell or zcp's boot rewrites it.
  it.effect(
    "a release zcp has already read reaches the app without waiting for the hourly check",
    () =>
      Effect.gen(function* () {
        const manifestFile = "/home/zerops/.zcp/mate/manifest.json";
        // The directory's watch, as the OS reports a write: the file's name, a moment later.
        const listeners = new Map<string, (event: string, name: string | null) => void>();
        let cached = "0.15.30";
        const reads: Array<{ readonly refresh?: boolean; readonly local?: boolean } | undefined> =
          [];
        const service = yield* make({
          cli: stubCli((options) => {
            reads.push(options);
            return Effect.succeed({ ...STATUS_RESULT, installed: "0.15.30", latest: cached });
          }),
          isZeropsEnvironment: true,
          refreshInterval: Duration.hours(1),
          manifestFile,
          watch: (dir, listener) => {
            listeners.set(dir, listener);
            return { close: () => listeners.delete(dir) };
          },
        });
        expect((yield* service.current)?.latest).toBe("0.15.30");

        cached = "0.15.31";
        reads.length = 0;
        const hearing = yield* service.changes.pipe(
          Stream.filter((line) => line?.latest === "0.15.31"),
          Stream.runHead,
          Effect.forkChild,
        );
        listeners.get(NodePath.dirname(manifestFile))?.("rename", "manifest.json");
        yield* TestClock.adjust(Duration.seconds(5));
        const heard = yield* Fiber.join(hearing);

        expect(heard._tag).toBe("Some");
        expect(reads.every((options) => options?.local === true)).toBe(true);
      }).pipe(Effect.scoped),
  );
});

describe("a Mate that only a restart gets current", () => {
  const BEHIND: MateStatusResult = {
    installed: "0.15.200",
    latest: "0.15.200",
    contract: 1,
    updateAvailable: false,
    checkedAt: "2026-10-27T00:00:00Z",
    updater: { protocol: 1, rollbackCompatible: true, phase: "idle", runningVersion: "0.15.200" },
    zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
    restartNeeded: true,
    why: "zcp 9.226.0 is out; only a restart installs it",
  };
  const policyOn = {
    current: Effect.succeed(Option.some({ orgId: "org", enabled: true, revision: 1 })),
    verify: Effect.succeed(Option.some({ orgId: "org", enabled: true, revision: 1 })),
    changes: Stream.never,
  };

  /** A zcp that reads `status` and records what else it is asked. */
  const zcp = (input: {
    readonly status: () => MateStatusResult;
    readonly version?: string;
    readonly asksVersion?: Effect.Effect<string | undefined>;
    readonly restart?: SelfRestartResult;
  }) => {
    const asked: Array<string> = [];
    const cli: ZeropsCli["Service"] = {
      mateStatus: () => Effect.sync(input.status),
      mateUpdate: (options) =>
        Effect.sync(() => {
          asked.push(options?.automatic ? "mate update --automatic" : "mate update");
          return { action: "none", restarted: false, started: true };
        }),
      version: input.asksVersion ?? Effect.sync(() => input.version ?? ZCP_SELF_RESTART_SINCE),
      leaseRelease: () => Effect.die("not used"),
      selfRestart: Effect.sync(() => {
        asked.push("self restart");
        return input.restart ?? { outcome: "accepted", process: "proc-1" };
      }),
    };
    return { cli, asked };
  };

  /** The drain the automatic updater runs: idle when `idle` resolves, never before. */
  const drainUntil = (idle: Deferred.Deferred<boolean>) => {
    const drains: Array<{ readonly automatic: boolean }> = [];
    let reopened = 0;
    return {
      drains,
      reopened: () => reopened,
      ports: (marker: { value: string | undefined }) => ({
        drain: (input: { readonly automatic: boolean }) =>
          Effect.sync(() => drains.push(input)).pipe(Effect.andThen(Deferred.await(idle))),
        reopen: Effect.sync(() => {
          reopened += 1;
        }),
        marker: {
          read: Effect.sync(() => marker.value),
          write: (key: string) =>
            Effect.sync(() => {
              marker.value = key;
            }),
        },
      }),
    };
  };

  const phaseOf = (line: ExecutionEnvironmentUpdate | undefined) => line?.restart?.phase;
  const awaitPhase = (
    service: { readonly changes: Stream.Stream<ExecutionEnvironmentUpdate | undefined> },
    phase: string,
  ) =>
    service.changes.pipe(
      Stream.filter((line) => phaseOf(line) === phase),
      Stream.runHead,
      Effect.map((head) => {
        const line = Option.getOrThrow(head);
        if (line === undefined) throw new Error("no update line");
        return line;
      }),
    );

  it.effect("the update line relays zcp's own reading and why only a restart gets it current", () =>
    Effect.gen(function* () {
      const { cli } = zcp({ status: () => BEHIND });
      const service = yield* make({ cli, isZeropsEnvironment: true });
      expect(yield* service.current).toMatchObject({
        zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
        restart: { needed: true, why: "zcp 9.226.0 is out; only a restart installs it" },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("a Mate whose zcp is behind updates by restarting once it is idle", () =>
    Effect.gen(function* () {
      const { cli, asked } = zcp({ status: () => BEHIND });
      const idle = yield* Deferred.make<boolean>();
      const drain = drainUntil(idle);
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drain.ports({ value: undefined }),
      });
      yield* service.refresh;
      yield* awaitPhase(service, "draining");
      yield* Deferred.succeed(idle, true);
      yield* awaitPhase(service, "restarting");
      expect(drain.drains).toEqual([{ automatic: true }]);
      expect(asked).toEqual(["self restart"]);
    }).pipe(Effect.scoped),
  );

  it.effect("a Mate needing a restart never restarts while it works", () =>
    Effect.gen(function* () {
      const { cli, asked } = zcp({ status: () => BEHIND });
      const idle = yield* Deferred.make<boolean>();
      const drain = drainUntil(idle);
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drain.ports({ value: undefined }),
      });
      yield* service.refresh;
      yield* awaitPhase(service, "draining");
      expect(asked).toEqual([]);
      // Its work outlasts the drain: the Mate stays up, and says why.
      yield* Deferred.succeed(idle, false);
      const line = yield* awaitPhase(service, "postponed");
      expect(asked).toEqual([]);
      expect(line.restart?.reason).toMatch(/work/);
    }).pipe(Effect.scoped),
  );

  it.effect("one zcp reading restarts the container at most once", () =>
    Effect.gen(function* () {
      const { cli, asked } = zcp({ status: () => BEHIND });
      const idle = yield* Deferred.make<boolean>();
      yield* Deferred.succeed(idle, true);
      const marker = { value: undefined as string | undefined };
      const first = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drainUntil(idle).ports(marker),
      });
      yield* first.refresh;
      yield* awaitPhase(first, "restarting");
      yield* first.refresh;
      yield* first.refresh;
      // The container came back with zcp still behind: the same reading never restarts it again.
      const again = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drainUntil(idle).ports(marker),
      });
      yield* again.refresh;
      yield* Effect.yieldNow;
      expect(asked).toEqual(["self restart"]);
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    {
      name: "an older zcp without self restart",
      version: "9.225.0",
      restart: undefined,
      reason: "this Zerops Control Plane can't restart its Mate yet",
    },
    {
      name: "a restart the platform refused",
      version: undefined,
      restart: { outcome: "refused", reason: "the project token may not restart zcp" } as const,
      reason: "the project token may not restart zcp",
    },
  ])("$name leaves the update postponed, saying why", ({ version, restart, reason }) =>
    Effect.gen(function* () {
      const { cli, asked } = zcp({
        status: () => BEHIND,
        ...(version === undefined ? {} : { version }),
        ...(restart === undefined ? {} : { restart }),
      });
      const idle = yield* Deferred.make<boolean>();
      yield* Deferred.succeed(idle, true);
      const drain = drainUntil(idle);
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drain.ports({ value: undefined }),
      });
      yield* service.refresh;
      const line = yield* awaitPhase(service, "postponed");
      expect(line.restart?.reason).toBe(reason);
      expect(asked).toEqual(version === undefined ? ["self restart"] : []);
      // Whatever closed for the restart opens again.
      expect(drain.reopened()).toBe(drain.drains.length === 0 ? 0 : 1);
    }).pipe(Effect.scoped),
  );

  it.effect("a status without the zcp fields updates mate as before", () =>
    Effect.gen(function* () {
      const { cli, asked } = zcp({
        status: () => ({
          installed: "0.15.200",
          latest: "0.15.201",
          contract: 1,
          updateAvailable: true,
          checkedAt: "2026-10-27T00:00:00Z",
          updater: {
            protocol: 1,
            rollbackCompatible: true,
            phase: "idle",
            runningVersion: "0.15.200",
          },
        }),
      });
      const idle = yield* Deferred.make<boolean>();
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drainUntil(idle).ports({ value: undefined }),
      });
      yield* service.refresh;
      expect(asked).toEqual(["mate update --automatic"]);
      expect((yield* service.current)?.restart).toBeUndefined();
    }).pipe(Effect.scoped),
  );

  it.effect("a person's Update on a Mate needing a restart restarts it once it is idle", () =>
    Effect.gen(function* () {
      const { cli, asked } = zcp({ status: () => BEHIND });
      const idle = yield* Deferred.make<boolean>();
      const drain = drainUntil(idle);
      // No organization policy: the person's own press needs none.
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        restart: drain.ports({ value: undefined }),
      });
      const press = yield* service.restart;
      expect(press.started).toBe(true);
      const attempt = press.started ? press.attempt : undefined;
      // Draining, as this restart, before the press is answered: the tab never reads an older
      // attempt's postponed line as this one's.
      expect((yield* service.current)?.restart).toMatchObject({ phase: "draining", attempt });
      // Pressed again while it waits: the same restart, not a second one.
      expect(yield* service.restart).toEqual(press);
      yield* Deferred.succeed(idle, true);
      yield* awaitPhase(service, "restarting");
      expect(drain.drains).toEqual([{ automatic: false }]);
      expect(asked).toEqual(["self restart"]);
    }).pipe(Effect.scoped),
  );

  it.effect("a spent restart never blocks the Mate's own automatic update", () =>
    Effect.gen(function* () {
      const status: MateStatusResult = {
        ...BEHIND,
        latest: "0.15.201",
        updateAvailable: true,
      };
      const { cli, asked } = zcp({ status: () => status });
      const idle = yield* Deferred.make<boolean>();
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        policy: policyOn,
        restart: drainUntil(idle).ports({
          value: "zcp 9.225.0 -> 9.226.0; mate 0.15.200",
        }),
      });
      yield* service.refresh;
      expect(asked).toEqual(["mate update --automatic"]);
    }).pipe(Effect.scoped),
  );

  it.effect("an interrupted press leaves the next press free", () =>
    Effect.gen(function* () {
      const version = yield* Deferred.make<string | undefined>();
      const { cli } = zcp({ status: () => BEHIND, asksVersion: Deferred.await(version) });
      const idle = yield* Deferred.make<boolean>();
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        restart: drainUntil(idle).ports({ value: undefined }),
      });
      // The first press is interrupted while zcp's version is read: the restart goes on.
      const first = yield* service.restart.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(version, ZCP_SELF_RESTART_SINCE);
      const next = yield* service.restart;
      expect(next.started).toBe(true);
      expect((yield* service.current)?.restart?.phase).toBe("draining");
    }).pipe(Effect.scoped),
  );

  it.effect(
    "a press joined to one interrupted while zcp's version is read still gets its restart",
    () =>
      Effect.gen(function* () {
        const version = yield* Deferred.make<string | undefined>();
        const { cli } = zcp({ status: () => BEHIND, asksVersion: Deferred.await(version) });
        const idle = yield* Deferred.make<boolean>();
        const service = yield* make({
          cli,
          isZeropsEnvironment: true,
          restart: drainUntil(idle).ports({ value: undefined }),
        });
        const first = yield* service.restart.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const joined = yield* service.restart.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(first);
        yield* Deferred.succeed(version, ZCP_SELF_RESTART_SINCE);
        const answer = yield* Fiber.join(joined);
        expect(answer.started).toBe(true);
        expect((yield* service.current)?.restart).toMatchObject({
          phase: "draining",
          attempt: answer.started ? answer.attempt : undefined,
        });
      }).pipe(Effect.scoped),
  );

  it.effect(
    "an answer zcp did not give keeps the Mate closed through the grace, then says the container did not restart",
    () =>
      Effect.gen(function* () {
        const { cli, asked } = zcp({ status: () => BEHIND, restart: { outcome: "uncertain" } });
        const idle = yield* Deferred.make<boolean>();
        yield* Deferred.succeed(idle, true);
        const drain = drainUntil(idle);
        const service = yield* make({
          cli,
          isZeropsEnvironment: true,
          restart: { ...drain.ports({ value: undefined }), grace: Duration.minutes(5) },
        });
        yield* service.restart;
        yield* awaitPhase(service, "restarting");
        expect(asked).toEqual(["self restart"]);
        expect(drain.reopened()).toBe(0);
        yield* TestClock.adjust(Duration.minutes(5));
        const line = yield* awaitPhase(service, "postponed");
        expect(line.restart?.reason).toBe("the container did not restart");
        expect(drain.reopened()).toBe(1);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "an error zcp does not call a refusal holds the Mate closed through the grace, then says zcp's words",
    () =>
      Effect.gen(function* () {
        const reason = "the platform refused the restart: connection reset";
        const { cli } = zcp({ status: () => BEHIND, restart: { outcome: "uncertain", reason } });
        const idle = yield* Deferred.make<boolean>();
        yield* Deferred.succeed(idle, true);
        const drain = drainUntil(idle);
        const service = yield* make({
          cli,
          isZeropsEnvironment: true,
          restart: { ...drain.ports({ value: undefined }), grace: Duration.minutes(5) },
        });
        yield* service.restart;
        yield* awaitPhase(service, "restarting");
        expect(drain.reopened()).toBe(0);
        yield* TestClock.adjust(Duration.minutes(5));
        const line = yield* awaitPhase(service, "postponed");
        expect(line.restart?.reason).toBe(reason);
        expect(drain.reopened()).toBe(1);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "a postponed restart gives way to the Mate's own automatic update that follows it",
    () =>
      Effect.gen(function* () {
        const status: MateStatusResult = { ...BEHIND, latest: "0.15.201", updateAvailable: true };
        const { cli, asked } = zcp({
          status: () => status,
          restart: { outcome: "refused", reason: "not inside a container" },
        });
        const idle = yield* Deferred.make<boolean>();
        yield* Deferred.succeed(idle, true);
        const service = yield* make({
          cli,
          isZeropsEnvironment: true,
          policy: policyOn,
          restart: drainUntil(idle).ports({ value: undefined }),
        });
        yield* service.refresh;
        yield* awaitPhase(service, "postponed");
        // The restart for this reading is spent: the next reading takes the Mate's own update.
        yield* service.refresh;
        expect(asked).toEqual(["self restart", "mate update --automatic"]);
        // Its attempt stays on the line for the press that waits on it; zcp's own update phase
        // outranks it where the line is drawn.
        expect((yield* service.current)?.restart).toMatchObject({
          phase: "postponed",
          attempt: "restart-1",
        });
      }).pipe(Effect.scoped),
  );

  it.effect("a second press while the first reads zcp's version joins the first's attempt", () =>
    Effect.gen(function* () {
      const version = yield* Deferred.make<string | undefined>();
      const { cli } = zcp({ status: () => BEHIND, asksVersion: Deferred.await(version) });
      const idle = yield* Deferred.make<boolean>();
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        restart: drainUntil(idle).ports({ value: undefined }),
      });
      const first = yield* service.restart.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      const second = yield* service.restart.pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(version, ZCP_SELF_RESTART_SINCE);
      const answer = yield* Fiber.join(first);
      expect(answer.started).toBe(true);
      expect(yield* Fiber.join(second)).toEqual(answer);
    }).pipe(Effect.scoped),
  );

  it.effect("a press says what its restart installs and when it started, on the line too", () =>
    Effect.gen(function* () {
      const { cli } = zcp({
        status: () => ({ ...BEHIND, latest: "0.15.201", updateAvailable: true }),
      });
      const idle = yield* Deferred.make<boolean>();
      const service = yield* make({
        cli,
        isZeropsEnvironment: true,
        restart: drainUntil(idle).ports({ value: undefined }),
      });
      const answer = yield* service.restart;
      expect(answer).toMatchObject({
        started: true,
        target: { zcp: "9.226.0", mate: "0.15.201" },
      });
      const restart = (yield* service.current)?.restart;
      expect(restart?.startedAt).toEqual(expect.any(String));
      expect(answer.started && answer.startedAt).toBe(restart?.startedAt);
    }).pipe(Effect.scoped),
  );
});
