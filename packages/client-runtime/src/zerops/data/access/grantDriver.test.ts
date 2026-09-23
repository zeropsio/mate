/**
 * The access grant as the data runtime interprets it (DESIGN §4.2, D16(a)): the 0.5 reducer
 * tables re-run through `runtime.access`, with its verification reads on a fake verifier and its
 * timers on the harness clock, wall and monotonic time moving apart as a browser moves them.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";

import { mateDiagnostics } from "../../diagnostics.ts";
import { INVALIDATION_COALESCE_MS, makeInvalidationBus } from "../../knowledge/invalidation.ts";
import { makeDeadlineClock, type DeadlineClock } from "../../testing/deadlineClock.ts";
import { organization, project, scope, verifiedAccess } from "../__fixtures__/index.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../policy.ts";
import { makeZeropsDataRuntime } from "../runtime.ts";
import type { AccessState, ProjectRef, ZeropsDataAdapter } from "../types.ts";
import {
  grantPlatformRead,
  grantPlatformWrite,
  grantRoundInFlight,
  type GrantFailure,
  type ProjectOutcome,
} from "./grant.ts";
import type { AccessVerifier } from "./verifier.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const WINDOW = 15 * MINUTE;
const START_WALL_MS = Date.UTC(2026, 8, 23, 10, 0, 0);
const policy = DEFAULT_ZEROPS_GRANT_POLICY;
const organizations = [{ organization, mutationsAllowed: true }];
const A = project("project-a");
const B = project("project-b");

const verified = (target: ProjectRef): ProjectOutcome => ({
  kind: "verified",
  access: { project: target, role: "ADMIN", mutationsAllowed: true },
});
const serverDown: GrantFailure = { kind: "server", status: 503 };
const forbidden: ProjectOutcome = { kind: "denied", evidence: "direct-forbidden" };

/** Nothing leases an interest here: the runtime never reaches its push half. */
const unused = Effect.die("the grant tests lease no interest");
const inertAdapter: ZeropsDataAdapter = {
  openReceiver: () => unused,
  register: () => unused,
  read: () => unused,
  execute: () => unused,
  closeReceiver: () => Effect.void,
};

/** What the platform answers the grant's reads, changeable mid-test. */
interface Platform {
  listed: ReadonlyArray<ProjectRef>;
  /** From a round's start to its account part, then to its project answers. */
  accountMs: number;
  projectMs: number;
  /** A project's answer to a round (`round`) or a read between rounds (`read`); null never answers. */
  outcome: (target: ProjectRef, read: "round" | "read") => ProjectOutcome | null;
  /** `fetchUser` answers this failure instead. */
  roundFailure: GrantFailure | null;
  readonly rounds: Array<{ readonly round: number; readonly startedAtMono: number }>;
  readonly reads: Array<{ readonly project: ProjectRef; readonly atMono: number }>;
  /** Each round (by id) and project read (by project id) interrupted before it answered. */
  readonly interrupted: Array<number | string>;
}

const healthy = (listed: ReadonlyArray<ProjectRef> = [A, B], roundMs = 2 * SECOND): Platform => ({
  listed,
  accountMs: Math.min(roundMs, SECOND),
  projectMs: roundMs - Math.min(roundMs, SECOND),
  outcome: (target) => verified(target),
  roundFailure: null,
  rounds: [],
  reads: [],
  interrupted: [],
});

/**
 * Requests in flight. A request is not a timer: a hidden tab's throttling never delays its
 * answer, so each waits here for the monotonic time it answers at, not on the tab's clock.
 */
interface Network {
  readonly wait: (ms: number) => Effect.Effect<void>;
  /** Answers every request due by now. */
  readonly deliver: Effect.Effect<void>;
  /** When the next request answers, on the monotonic clock. */
  readonly next: () => number;
}

const makeNetwork = (clock: DeadlineClock): Network => {
  const pending: Array<{ readonly at: number; readonly answer: Deferred.Deferred<void> }> = [];
  return {
    wait: (ms) =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<void>();
        pending.push({ at: clock.monoMs() + ms, answer });
        yield* Deferred.await(answer);
      }),
    deliver: Effect.suspend(() => {
      const due = pending.filter(({ at }) => at <= clock.monoMs());
      for (const request of due) pending.splice(pending.indexOf(request), 1);
      return Effect.forEach(due, ({ answer }) => Deferred.succeed(answer, undefined), {
        discard: true,
      });
    }),
    next: () => Math.min(...pending.map(({ at }) => at)),
  };
};

/** The verifier over `platform`; each read takes its time on the network. */
const fakeVerifier = (
  platform: Platform,
  clock: DeadlineClock,
  network: Network,
): AccessVerifier => ({
  verifyRound: ({ round, report }) =>
    Effect.gen(function* () {
      platform.rounds.push({ round, startedAtMono: clock.monoMs() });
      yield* network.wait(platform.accountMs);
      const failure = platform.roundFailure;
      if (failure !== null) return yield* Effect.fail({ failure, message: "Zerops is down." });
      const listed = platform.listed;
      yield* report({ type: "ROUND_ACCOUNT", round, organizations, projects: listed });
      yield* network.wait(platform.projectMs);
      for (const target of listed) {
        const outcome = platform.outcome(target, "round");
        if (outcome !== null)
          yield* report({ type: "ROUND_PROJECT", round, project: target, outcome });
      }
    }).pipe(Effect.onInterrupt(() => Effect.sync(() => platform.interrupted.push(round)))),
  verifyProject: (target) =>
    Effect.gen(function* () {
      platform.reads.push({ project: target, atMono: clock.monoMs() });
      yield* network.wait(platform.projectMs);
      const outcome = platform.outcome(target, "read");
      return outcome === null ? yield* Effect.never : outcome;
    }).pipe(
      Effect.onInterrupt(() => Effect.sync(() => platform.interrupted.push(target.projectId))),
    ),
});

/** Lets every fiber the last step woke run to its next wait, on whichever scheduler it runs. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    yield* Effect.yieldNow;
  }
});

/**
 * One tab's data runtime with its grant started at the start of the test's time; `clocks` may
 * replace the clock the runtime reads.
 */
const tab = Effect.fnUntraced(function* (
  platform: Platform,
  clocks: (clock: DeadlineClock) => Clock.Clock = (clock) => clock,
) {
  const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
  const registry = AtomRegistry.make();
  let opaque = 0;
  const runtime = yield* makeZeropsDataRuntime({
    scope: scope(),
    adapter: inertAdapter,
    atomRegistry: registry,
    makeOpaqueId: () => `opaque-${++opaque}`,
  }).pipe(Effect.provideService(Clock.Clock, clocks(clock)));
  yield* Effect.addFinalizer(() => runtime.shutdown("application-close"));
  /** Every access status the runtime published, in order. */
  const statuses: Array<AccessState["status"]> = [];
  const unsubscribe = registry.subscribe(
    runtime.stateAtom,
    ({ access }) => {
      if (statuses.at(-1) !== access.status) statuses.push(access.status);
    },
    { immediate: true },
  );
  yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
  const view = () => registry.get(runtime.access.view);
  const ctx = () => ({ now: { wall: clock.wallMs(), mono: clock.monoMs() }, policy });
  const network = makeNetwork(clock);
  const answer = Effect.andThen(settle, Effect.andThen(network.deliver, settle));
  let hidden = false;
  /** When the grant's timer fires, on the monotonic clock: a hidden tab's on a minute bucket. */
  const nextTimer = () => {
    const at = view().machine.timer;
    if (at === null) return Number.POSITIVE_INFINITY;
    const due =
      clock.monoMs() + Math.max(0, Math.min(at.wall - clock.wallMs(), at.mono - clock.monoMs()));
    return hidden ? Math.ceil(due / MINUTE) * MINUTE : due;
  };
  /**
   * Time passes in a running tab: it stops at each timer and each answer, so what one starts
   * starts at its own moment.
   */
  const pass = Effect.fnUntraced(function* (ms: number) {
    const until = clock.monoMs() + ms;
    for (;;) {
      const next = Math.min(network.next(), nextTimer());
      if (next > until) break;
      yield* clock.advance(Math.max(1, next - clock.monoMs()));
      yield* answer;
    }
    yield* clock.advance(Math.max(0, until - clock.monoMs()));
    yield* answer;
  });
  /** The tab is hidden: the grant hears it, and its timers fire on one-minute buckets. */
  const hide = Effect.suspend(() => {
    hidden = true;
    clock.alignHiddenTimers(true);
    return Effect.andThen(runtime.access.signal({ type: "VISIBILITY", hidden: true }), settle);
  });
  /** The tab is shown again after a while: a visible wake. */
  const show = Effect.suspend(() => {
    hidden = false;
    clock.alignHiddenTimers(false);
    return runtime.access
      .signal({ type: "VISIBILITY", hidden: false })
      .pipe(
        Effect.andThen(runtime.access.signal({ type: "WAKE", visible: true })),
        Effect.andThen(answer),
      );
  });
  /** The tab is frozen for `ms`: nothing runs, then the overdue timers and answers do. */
  const freeze = (ms: number) => Effect.andThen(clock.freeze(ms), answer);
  yield* runtime.access.start({
    verifier: fakeVerifier(platform, clock, network),
    hidden: false,
    online: true,
  });
  yield* settle;
  return {
    clock,
    runtime,
    platform,
    statuses,
    view,
    pass,
    freeze,
    hide,
    show,
    phase: () => view().machine.phase.phase,
    write: (target: ProjectRef) => grantPlatformWrite(view().machine, target.projectId, ctx()),
    read: (target: ProjectRef) => grantPlatformRead(view().machine, target.projectId, ctx()),
    authority: (target: ProjectRef) =>
      view().machine.published.projects.get(target.projectId)?.authority,
    /** Where a denial of `target` stands in the evidence the grant holds. */
    denial: (target: ProjectRef) => {
      const phase = view().machine.phase;
      return phase.phase === "granted"
        ? phase.evidence.closedProjects.get(target.projectId)?.confirmation.status
        : undefined;
    },
    access: () => Effect.map(runtime.state, ({ access }) => access),
    granted: () =>
      Effect.map(runtime.state, ({ access }) =>
        access.status === "verified"
          ? access.projects.map(({ project: ref }) => ref.projectId)
          : null,
      ),
  };
});

type Tab = Effect.Success<ReturnType<typeof tab>>;

/** A tab whose first round answered, `roundMs` after it started. */
const grantedTab = Effect.fnUntraced(function* (platform: Platform) {
  const opened = yield* tab(platform);
  yield* opened.pass(platform.accountMs + platform.projectMs);
  expect(opened.phase()).toBe("granted");
  return opened;
});

/** Moves time a minute at a time, checking the tab after each step. */
const everyMinute = Effect.fnUntraced(function* (
  opened: { readonly pass: (ms: number) => Effect.Effect<void> },
  minutes: number,
  check: () => Effect.Effect<void>,
) {
  for (let minute = 0; minute < minutes; minute++) {
    yield* opened.pass(MINUTE);
    yield* check();
  }
});

describe("the access grant inside the data runtime", () => {
  it.effect("admits the first round and hands the runtime a grant of each verified project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* tab(healthy());
        expect(opened.phase()).toBe("verifying");
        expect((yield* opened.access()).status).toBe("verifying");
        expect(opened.write(A)).toEqual({
          allowed: false,
          reason: "access-unverified",
          waitable: true,
        });

        yield* opened.pass(2 * SECOND);

        expect(opened.phase()).toBe("granted");
        expect(opened.write(A)).toEqual({ allowed: true });
        expect(opened.authority(A)).toEqual({ kind: "authorized" });
        expect(yield* opened.granted()).toEqual(["project-a", "project-b"]);
        const access = yield* opened.access();
        expect(access.status === "verified" && access.deadlineMs).toBe(START_WALL_MS + WINDOW);
      }),
    ),
  );

  it.effect(
    "keeps a tab hidden across the renewal granted, with writes open throughout (T-L1)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* grantedTab(healthy([A, B], 3 * SECOND));
          yield* opened.pass(MINUTE);
          yield* opened.hide;

          yield* everyMinute(opened, 40, () =>
            Effect.gen(function* () {
              expect(opened.write(A)).toEqual({ allowed: true });
              expect((yield* opened.access()).status).toBe("verified");
            }),
          );
          yield* opened.show;

          expect(opened.phase()).toBe("granted");
          expect(opened.platform.rounds.length).toBeGreaterThanOrEqual(3);
          expect(opened.statuses).not.toContain("expired");
        }),
      ),
  );

  it.effect.each([
    ["a quick round", 1 * SECOND, 2],
    ["a 30 s round", 30 * SECOND, 2],
    // 20 projects give the round 105 s (G7) and the renewal a wider lead.
    ["a round slow enough to widen the lead", 100 * SECOND, 20],
  ] as const)(
    "renews before the deadline with %s while hidden timers fire late to one-minute buckets (G13)",
    ([, roundMs, projects]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const listed = [
            A,
            B,
            ...Array.from({ length: projects - 2 }, (_, index) => project(`project-${index}`)),
          ];
          const opened = yield* grantedTab(healthy(listed, roundMs));
          yield* opened.hide;
          const admitted = new Set<number>();

          yield* everyMinute(opened, 50, () =>
            Effect.sync(() => {
              expect(opened.write(A)).toEqual({ allowed: true });
              const phase = opened.view().machine.phase;
              if (phase.phase === "granted") admitted.add(phase.evidence.account.round);
            }),
          );

          expect(admitted.size).toBeGreaterThanOrEqual(4);
          expect(opened.statuses).not.toContain("expired");
        }),
      ),
  );

  it.effect(
    "lapses a tab frozen for 30 min when it runs again, and starts a round at once (T-L2, G9)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* grantedTab(healthy());
          const rounds = opened.platform.rounds.length;

          yield* opened.freeze(30 * MINUTE);

          expect(opened.phase()).toBe("lapsed");
          expect((yield* opened.access()).status).toBe("expired");
          expect(opened.write(A)).toEqual({
            allowed: false,
            reason: "access-lapsed",
            waitable: true,
          });
          expect(opened.authority(A)).toMatchObject({ kind: "withheld", reason: "access-lapsed" });
          expect(opened.platform.rounds).toHaveLength(rounds + 1);
          expect(opened.platform.rounds.at(-1)?.startedAtMono).toBe(opened.clock.monoMs());

          yield* opened.pass(2 * SECOND);

          expect(opened.phase()).toBe("granted");
          expect(opened.write(A)).toEqual({ allowed: true });
          expect((yield* opened.access()).status).toBe("verified");
        }),
      ),
  );

  it.effect.each([
    ["the first round", false],
    ["a renewal round", true],
  ] as const)(
    "discards %s that a frozen tab completes after its evidence expired, and starts another (G3)",
    ([, renewal]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = healthy([A, B], 2 * SECOND);
          const opened = renewal ? yield* grantedTab(platform) : yield* tab(platform);
          if (renewal) yield* opened.pass(12 * MINUTE - 2 * SECOND);
          const late = grantRoundInFlight(opened.view().machine)!.id;
          yield* opened.pass(SECOND);
          // Frozen after the account part answered; the project answers arrive 16 min later.
          yield* opened.freeze(16 * MINUTE);

          expect(opened.write(A).allowed).toBe(false);
          expect(opened.phase()).not.toBe("granted");
          expect(grantRoundInFlight(opened.view().machine)?.id).not.toBe(late);
          expect(opened.platform.rounds.at(-1)?.round).not.toBe(late);
          expect((yield* opened.access()).status).not.toBe("verified");
        }),
      ),
  );

  it.effect("lapses and re-verifies at once when the wall clock is set back 1 h (G5)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* grantedTab(healthy());
        yield* opened.pass(5 * MINUTE);
        opened.clock.skewWall(-60 * MINUTE);
        expect(opened.write(A)).toEqual({
          allowed: false,
          reason: "access-lapsed",
          waitable: true,
        });

        yield* opened.runtime.access.signal({ type: "WAKE", visible: false });
        yield* settle;
        expect(opened.phase()).toBe("lapsed");
        expect(grantRoundInFlight(opened.view().machine)).not.toBeNull();
        expect((yield* opened.access()).status).toBe("expired");

        yield* opened.pass(2 * SECOND);
        expect(opened.write(A)).toEqual({ allowed: true });
        expect((yield* opened.access()).status).toBe("verified");
      }),
    ),
  );

  it.effect.each([
    ["back 59 s", -59 * SECOND, "granted"],
    ["back 61 s", -61 * SECOND, "lapsed"],
    ["forward 61 s", 61 * SECOND, "granted"],
    ["forward past the deadline", 11 * MINUTE, "lapsed"],
  ] as const)("treats a wall-clock jump %s as %s (G5)", ([, jumpMs, phase]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* grantedTab(healthy());
        yield* opened.pass(4 * MINUTE);
        opened.clock.skewWall(jumpMs);
        expect(opened.write(A).allowed).toBe(phase === "granted");

        yield* opened.runtime.access.signal({ type: "WAKE", visible: false });
        yield* settle;

        expect(opened.phase()).toBe(phase);
        expect((yield* opened.access()).status).toBe(phase === "granted" ? "verified" : "expired");
      }),
    ),
  );

  it.effect(
    "closes a denied project's writes at once and withholds it until a confirming read (G6)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = healthy();
          const opened = yield* grantedTab(platform);
          platform.outcome = (target) => (target === A ? forbidden : verified(target));
          yield* opened.pass(12 * MINUTE - 2 * SECOND);
          yield* opened.pass(2 * SECOND);

          expect(opened.phase()).toBe("granted");
          expect(opened.write(A)).toEqual({
            allowed: false,
            reason: "project-closed",
            waitable: false,
          });
          expect(opened.write(B)).toEqual({ allowed: true });
          // Withheld, not removed: the project stays in the grant's scopes (law 5).
          expect(opened.authority(A)).toEqual({
            kind: "withheld",
            reason: "access-denied",
            cause: null,
          });
          expect(yield* opened.granted()).toEqual(["project-b"]);
          expect(opened.denial(A)).toBe("due");

          // The confirming read, 5 s after the denial, answers the same: it is gone.
          yield* opened.pass(5 * SECOND);
          yield* opened.pass(SECOND);
          expect(opened.platform.reads.map(({ project: ref }) => ref.projectId)).toEqual([
            "project-a",
          ]);
          expect(opened.denial(A)).toBe("confirmed");
          expect(opened.read(A).allowed).toBe(false);
        }),
      ),
  );

  it.effect(
    "keeps the account granted when one project's read 5xx's, and that project's writes lapse at its own deadline (C2b, T-L19)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = healthy();
          const opened = yield* grantedTab(platform);
          platform.outcome = (target) =>
            target === B ? { kind: "failed", failure: serverDown } : verified(target);
          const beforeDeadline: Array<boolean> = [];
          const afterDeadline: Array<boolean> = [];

          yield* everyMinute(opened, 20, () =>
            Effect.gen(function* () {
              expect(opened.write(A)).toEqual({ allowed: true });
              const past = opened.clock.monoMs() >= WINDOW;
              (past ? afterDeadline : beforeDeadline).push(opened.write(B).allowed);
              if (past) expect(yield* opened.granted()).toEqual(["project-a"]);
            }),
          );

          expect(opened.phase()).toBe("granted");
          expect(beforeDeadline.every(Boolean)).toBe(true);
          expect(afterDeadline.length > 0 && afterDeadline.every((allowed) => !allowed)).toBe(true);
          expect(opened.write(B)).toEqual({
            allowed: false,
            reason: "project-unverified",
            waitable: true,
          });
          expect(opened.authority(B)).toMatchObject({
            kind: "withheld",
            reason: "access-unverified",
            cause: { failure: serverDown },
          });
          expect(opened.statuses).not.toContain("expired");
        }),
      ),
  );

  it.effect.each([
    ["a second 403 confirms it gone", forbidden, false],
    ["a 200 reopens it", verified(A), true],
  ] as const)(
    "keeps a project that 403s once after a lapse withheld until confirmed: %s (G6, T-L20)",
    ([, confirmation, reopened]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = healthy();
          const opened = yield* grantedTab(platform);
          platform.outcome = (target, read) =>
            target === A ? (read === "round" ? forbidden : confirmation) : verified(target);
          yield* opened.freeze(30 * MINUTE);
          yield* opened.pass(2 * SECOND);

          expect(opened.phase()).toBe("granted");
          expect(opened.authority(B)).toEqual({ kind: "authorized" });
          expect(opened.authority(A)).toEqual({
            kind: "withheld",
            reason: "access-denied",
            cause: null,
          });
          expect(opened.write(A).allowed).toBe(false);
          expect(yield* opened.granted()).toEqual(["project-b"]);

          yield* opened.pass(5 * SECOND);
          yield* opened.pass(SECOND);

          expect(opened.read(A).allowed).toBe(reopened);
          expect(opened.authority(A)?.kind).toBe(reopened ? "authorized" : "withheld");
          expect(yield* opened.granted()).toEqual(
            reopened ? ["project-b", "project-a"] : ["project-b"],
          );
        }),
      ),
  );

  it.effect.each([
    [4, 45 * SECOND],
    [40, 180 * SECOND],
  ] as const)(
    "gives a round with %i listed projects a deadline of %i ms (G7)",
    ([projects, deadlineMs]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const listed = Array.from({ length: projects }, (_, index) =>
            project(`project-${index}`),
          );
          const platform: Platform = {
            ...healthy(listed, SECOND),
            // The first listed project never answers.
            outcome: (target) => (target === listed[0] ? null : verified(target)),
          };
          const opened = yield* tab(platform);

          yield* opened.pass(deadlineMs - 1);
          expect(opened.phase()).toBe("verifying");
          yield* opened.pass(1);

          // The account part answered in time; the one project without an answer is unverified.
          expect(opened.phase()).toBe("granted");
          expect(opened.write(listed[0]!)).toEqual({
            allowed: false,
            reason: "project-unverified",
            waitable: true,
          });
          expect(opened.write(listed[1]!)).toEqual({ allowed: true });
        }),
      ),
  );

  it.effect(
    "interrupts a round its deadline abandons, and the round after it runs alone (G7)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          // The account part never answers.
          const platform: Platform = { ...healthy(), accountMs: Number.POSITIVE_INFINITY };
          const opened = yield* tab(platform);

          yield* opened.pass(30 * SECOND);
          expect(opened.phase()).toBe("unverified-failed");
          expect(platform.interrupted).toEqual([1]);

          yield* opened.pass(2 * SECOND);
          expect(platform.rounds).toHaveLength(2);
          expect(platform.interrupted).toEqual([1]);
        }),
      ),
  );

  it.effect("interrupts a read between rounds its own deadline abandons (G1)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // A's round read fails; its retry never answers.
        const platform: Platform = {
          ...healthy(),
          outcome: (target, read) =>
            target !== A
              ? verified(target)
              : read === "round"
                ? { kind: "failed", failure: serverDown }
                : null,
        };
        const opened = yield* grantedTab(platform);
        yield* opened.pass(10 * SECOND);
        expect(platform.reads.map(({ project: read }) => read.projectId)).toEqual(["project-a"]);
        expect(platform.interrupted).toEqual([]);

        yield* opened.pass(45 * SECOND);

        expect(platform.interrupted).toEqual(["project-a"]);
      }),
    ),
  );

  it.effect(
    "the first mount's wait is overdue 20 s after the round that granted it, and never once it mounted",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* grantedTab(healthy());
          yield* opened.pass(20 * SECOND - 1);
          expect(opened.view().overdue).toBe(false);

          yield* opened.pass(1);
          expect(opened.view().overdue).toBe(true);

          yield* opened.runtime.access.mounted;
          expect(opened.view().overdue).toBe(false);
          // Renewals come and go; the mounted epoch never waits for a first mount again.
          yield* opened.pass(30 * MINUTE);
          expect(opened.platform.rounds.length).toBeGreaterThan(1);
          expect(opened.view().overdue).toBe(false);
        }),
      ),
  );

  it.effect(
    "the first mount's wait is overdue 20 s into a round that never answers, and starts over with each round",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform: Platform = { ...healthy(), accountMs: Number.POSITIVE_INFINITY };
          const opened = yield* tab(platform);
          yield* opened.pass(20 * SECOND - 1);
          expect(opened.view().overdue).toBe(false);

          yield* opened.pass(1);
          expect(opened.phase()).toBe("verifying");
          expect(opened.view().overdue).toBe(true);

          // The round's own deadline fails it; the retry 2 s later waits afresh.
          yield* opened.pass(10 * SECOND);
          expect(opened.phase()).toBe("unverified-failed");
          expect(opened.view().overdue).toBe(false);
          yield* opened.pass(2 * SECOND);
          expect(platform.rounds).toHaveLength(2);
          yield* opened.pass(20 * SECOND - 1);
          expect(opened.view().overdue).toBe(false);
          yield* opened.pass(1);
          expect(opened.view().overdue).toBe(true);
        }),
      ),
  );

  it.effect(
    "fails the first round with the platform's words and retries it by the session backoff",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform: Platform = { ...healthy(), roundFailure: serverDown };
          const opened = yield* tab(platform);
          yield* opened.pass(SECOND);

          expect(opened.phase()).toBe("unverified-failed");
          expect(opened.view().failure).toBe("Zerops is down.");
          expect((yield* opened.access()).status).toBe("failed");

          platform.roundFailure = null;
          yield* opened.pass(2 * SECOND);
          expect(opened.platform.rounds).toHaveLength(2);
          expect(opened.view().failure).toBeNull();
          yield* opened.pass(2 * SECOND);
          expect(opened.phase()).toBe("granted");
          expect((yield* opened.access()).status).toBe("verified");
        }),
      ),
  );

  it.effect(
    "a person's retry on the bus joins a round in flight and starts one after a failure",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform: Platform = { ...healthy(), roundFailure: serverDown };
          const opened = yield* tab(platform);
          const bus = yield* makeInvalidationBus({ signals: Stream.never, shown: () => true });
          yield* opened.runtime.access.listen(bus);
          /** A person's "Try again", heard once the bus's coalescing window closes. */
          const retry = bus
            .invalidate({ topic: "access", change: "renew-now" })
            .pipe(
              Effect.provideService(Clock.Clock, opened.clock),
              Effect.andThen(opened.pass(INVALIDATION_COALESCE_MS)),
            );
          yield* retry;
          expect(opened.platform.rounds).toHaveLength(1);

          yield* opened.pass(SECOND);
          platform.roundFailure = null;
          yield* retry;
          expect(opened.platform.rounds).toHaveLength(2);

          // Nothing else on the bus is a retry.
          yield* opened.pass(4 * SECOND);
          expect(opened.phase()).toBe("granted");
          yield* bus
            .invalidate({ topic: "access", change: "lapsed" })
            .pipe(Effect.provideService(Clock.Clock, opened.clock));
          yield* bus
            .invalidate({ topic: "inventory", organization })
            .pipe(Effect.provideService(Clock.Clock, opened.clock));
          yield* opened.pass(INVALIDATION_COALESCE_MS);
          expect(opened.platform.rounds).toHaveLength(2);
        }),
      ),
  );

  it.effect.each([
    ["a fresh lapse", 1500, false, [0, 3 * SECOND, 9 * SECOND]],
    ["a lapse on its 60 s cadence", 3 * MINUTE, false, [0, 3 * SECOND, 9 * SECOND]],
    ["a lapse on its 60 s cadence, the round answering", 3 * MINUTE, true, [0]],
  ] as const)(
    "a user retry in a lapse starts one round, and no second round before the first rung of the ladder after it fails: %s",
    ([, lapsedMs, answers, startsAfterRetry]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = healthy();
          const opened = yield* grantedTab(platform);
          platform.roundFailure = serverDown;
          yield* opened.freeze(30 * MINUTE);
          yield* opened.pass(lapsedMs);
          expect(opened.phase()).toBe("lapsed");
          const before = opened.platform.rounds.length;
          const bus = yield* makeInvalidationBus({ signals: Stream.never, shown: () => true });
          yield* opened.runtime.access.listen(bus);
          if (answers) platform.roundFailure = null;

          yield* bus
            .invalidate({ topic: "access", change: "renew-now" })
            .pipe(Effect.provideService(Clock.Clock, opened.clock));
          yield* opened.pass(INVALIDATION_COALESCE_MS);
          const retried = opened.platform.rounds.slice(before);
          expect(retried).toHaveLength(1);
          const clicked = retried[0]!.startedAtMono;
          yield* opened.pass(10 * SECOND - INVALIDATION_COALESCE_MS);

          // Each round fails 1 s after it starts; the ladder waits 2 s, then 5 s.
          expect(
            opened.platform.rounds
              .slice(before)
              .map(({ startedAtMono }) => startedAtMono - clicked),
          ).toEqual(startsAfterRetry);
          expect(opened.phase()).toBe(answers ? "granted" : "lapsed");
        }),
      ),
  );

  it.effect.each([
    ["the epoch's first", healthy(), () => Effect.void, ["first"]],
    [
      "a renewal due",
      healthy(),
      (opened: Tab) => opened.pass(12 * MINUTE + 2 * SECOND),
      ["first", "scheduled"],
    ],
    [
      "a retry on the ladder",
      { ...healthy(), roundFailure: serverDown },
      (opened: Tab) => opened.pass(3 * SECOND),
      ["first", "scheduled"],
    ],
    [
      "a person's retry",
      { ...healthy(), roundFailure: serverDown },
      (opened: Tab) =>
        Effect.gen(function* () {
          yield* opened.pass(1500);
          const bus = yield* makeInvalidationBus({ signals: Stream.never, shown: () => true });
          yield* opened.runtime.access.listen(bus);
          yield* bus
            .invalidate({ topic: "access", change: "renew-now" })
            .pipe(Effect.provideService(Clock.Clock, opened.clock));
          yield* opened.pass(INVALIDATION_COALESCE_MS);
        }),
      ["first", "user-retry"],
    ],
    [
      "the network back",
      { ...healthy(), roundFailure: serverDown },
      (opened: Tab) =>
        opened
          .pass(1500)
          .pipe(
            Effect.andThen(opened.runtime.access.signal({ type: "ONLINE" })),
            Effect.andThen(settle),
          ),
      ["first", "wake-online"],
    ],
    [
      "a visible wake",
      { ...healthy(), roundFailure: serverDown },
      (opened: Tab) =>
        opened
          .pass(1500)
          .pipe(
            Effect.andThen(opened.runtime.access.signal({ type: "WAKE", visible: true })),
            Effect.andThen(settle),
          ),
      ["first", "wake-visible"],
    ],
  ] as const)("the diagnostics record the round's cause: %s", ([, platform, act, causes]) =>
    Effect.scoped(
      Effect.gen(function* () {
        mateDiagnostics.enable();
        mateDiagnostics.clear();
        const opened = yield* tab({ ...platform, rounds: [], reads: [], interrupted: [] });

        yield* act(opened);

        expect(
          mateDiagnostics
            .snapshot()
            .flatMap((entry) =>
              entry.kind === "access-round-cause"
                ? [{ round: entry.round, cause: entry.cause }]
                : [],
            ),
        ).toEqual(
          opened.platform.rounds.map(({ round }, index) => ({ round, cause: causes[index] })),
        );
        expect(opened.platform.rounds).toHaveLength(causes.length);
        expect(mateDiagnostics.snapshot().map(({ kind }) => kind)).not.toContain("access-timer");
      }),
    ),
  );

  it.effect("a timer that wakes short of its instant on both clocks waits on until it comes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The monotonic clock the runtime reads drifts from the one its timers sleep on, as
        // `process.hrtime` drifts from a faked `Date` in a test, or a corrected system clock.
        let driftMs = 0;
        const opened = yield* tab(healthy(), (clock) => ({
          ...clock,
          monotonicTimeNanosUnsafe: () => BigInt(Math.round((clock.monoMs() + driftMs) * 1e6)),
          monotonicTimeNanos: Effect.sync(() =>
            BigInt(Math.round((clock.monoMs() + driftMs) * 1e6)),
          ),
        }));
        // Ahead when the renewal timer is armed, so it is armed 5 ms short...
        driftMs = 5;
        yield* opened.pass(2 * SECOND);
        expect(opened.phase()).toBe("granted");
        // ...and behind when it wakes, so neither clock has reached the renewal then.
        driftMs = -10;

        yield* opened.pass(12 * MINUTE);

        expect(opened.platform.rounds).toHaveLength(2);
      }),
    ),
  );

  it.effect(
    "a foreground return past the deadline leaves the lapse to the grant: the runtime expires nothing itself",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const changes = yield* Queue.unbounded<"visible" | "hidden">();
          let visibility: "visible" | "hidden" = "visible";
          const runtime = yield* makeZeropsDataRuntime({
            scope: scope(),
            adapter: inertAdapter,
            atomRegistry: registry,
            makeOpaqueId: () => "opaque",
            initialAccess: verifiedAccess(1, START_WALL_MS + MINUTE),
            visibility: {
              current: Effect.sync(() => visibility),
              changes: Stream.fromQueue(changes),
            },
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => runtime.shutdown("application-close"));
          visibility = "hidden";
          yield* Queue.offer(changes, "hidden");
          yield* clock.advance(2 * MINUTE);
          yield* settle;

          visibility = "visible";
          yield* Queue.offer(changes, "visible");
          yield* settle;

          expect((yield* runtime.state).access.status).toBe("verified");
        }),
      ),
  );

  it.effect("never starts the grant of a runtime that shut down first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const registry = AtomRegistry.make();
        const platform = healthy();
        const runtime = yield* makeZeropsDataRuntime({
          scope: scope(),
          adapter: inertAdapter,
          atomRegistry: registry,
          makeOpaqueId: () => "opaque",
        }).pipe(Effect.provideService(Clock.Clock, clock));
        yield* runtime.shutdown("logout");

        yield* runtime.access.start({
          verifier: fakeVerifier(platform, clock, makeNetwork(clock)),
          hidden: false,
          online: true,
        });
        yield* settle;

        expect(registry.get(runtime.access.view).machine.phase.phase).toBe("closed");
        expect(platform.rounds).toEqual([]);
      }),
    ),
  );

  it.effect("starts no round and arms no timer once the runtime shuts down", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* grantedTab(healthy());
        yield* opened.runtime.shutdown("logout");
        yield* opened.pass(30 * MINUTE);

        expect(opened.phase()).toBe("closed");
        expect(opened.platform.rounds).toHaveLength(1);
      }),
    ),
  );
});
