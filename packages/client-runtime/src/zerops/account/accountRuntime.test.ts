/**
 * The account runtime (DESIGN §1.1, §1.2, §5, G11): one composition root per account epoch, with
 * a pre-grant stage — the session's client, the access verifier, the data runtime and its grant —
 * and a post-grant stage built on the epoch's first `granted`.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";

import { ZeropsApiClient } from "../api.ts";
import { account, organization, project, scope } from "../data/__fixtures__/index.ts";
import { makeRestAccessVerifier, type AccessVerifier } from "../data/access/verifier.ts";
import { grantPlatformWrite, type GrantFailure } from "../data/access/grant.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../data/policy.ts";
import { makeZeropsDataRuntime } from "../data/runtime.ts";
import type { ZeropsDataAdapter } from "../data/types.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import { makeDeadlineClock, type DeadlineClock } from "../testing/deadlineClock.ts";
import { makeFakeDatastream } from "../testing/fakeDatastream.ts";
import { makeFakeZeropsRest } from "../testing/fakeZeropsRest.ts";
import { makeAccountRuntime, type PageSignal } from "./accountRuntime.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const WINDOW = 15 * MINUTE;
const START_WALL_MS = Date.UTC(2026, 8, 23, 10, 0, 0);
const policy = DEFAULT_ZEROPS_GRANT_POLICY;
const organizations = [{ organization, mutationsAllowed: true }];
const A = project("project-a");

const unused = Effect.die("these tests lease no interest on this adapter");
const inertAdapter: ZeropsDataAdapter = {
  openReceiver: () => unused,
  register: () => unused,
  read: () => unused,
  execute: () => unused,
  closeReceiver: () => Effect.void,
};

/** Lets every fiber the last step woke run to its next wait, on whichever scheduler it runs. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    yield* Effect.yieldNow;
  }
});

/** A tab's page as the platform reports it: its visibility, its network, its lifecycle. */
const makePage = Effect.fnUntraced(function* () {
  const signals = yield* PubSub.unbounded<PageSignal>();
  const listeners = new Set<(signal: PageSignal) => void>();
  let hidden = false;
  return {
    port: {
      hidden: () => hidden,
      online: () => true,
      listen: (hear: (signal: PageSignal) => void) => {
        listeners.add(hear);
        return () => listeners.delete(hear);
      },
    },
    /** The runtime's own visibility port over the same page. */
    visibility: {
      current: Effect.sync(() => (hidden ? ("hidden" as const) : ("visible" as const))),
      changes: Stream.fromPubSub(signals).pipe(
        Stream.filter((signal) => signal.type === "visibility"),
        Stream.map((signal) =>
          signal.type === "visibility" && signal.hidden
            ? ("hidden" as const)
            : ("visible" as const),
        ),
      ),
    },
    emit: (signal: PageSignal) =>
      Effect.suspend(() => {
        if (signal.type === "visibility") hidden = signal.hidden;
        for (const hear of listeners) hear(signal);
        return PubSub.publish(signals, signal);
      }).pipe(Effect.andThen(settle)),
  };
});

/** Every window the account opened for writes, and every close. */
const makeWrites = () => {
  const calls: Array<{ readonly open: number } | "close"> = [];
  return {
    calls,
    port: {
      open: (forMs: number) => calls.push({ open: forMs }),
      close: () => calls.push("close"),
    },
  };
};

/** A grant whose rounds each wait for the test to answer them, then verify `A`. */
const heldVerifier = () => {
  const answers: Array<Deferred.Deferred<GrantFailure | null>> = [];
  const verifier: AccessVerifier = {
    verifyRound: ({ round, report }) =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<GrantFailure | null>();
        answers.push(answer);
        const failure = yield* Deferred.await(answer);
        if (failure !== null) return yield* Effect.fail({ failure, message: "Zerops is down." });
        yield* report({ type: "ROUND_ACCOUNT", round, organizations, projects: [A] });
        yield* report({
          type: "ROUND_PROJECT",
          round,
          project: A,
          outcome: {
            kind: "verified",
            access: { project: A, role: "OWNER", mutationsAllowed: true },
          },
        });
      }),
    verifyProject: () => Effect.never,
  };
  return {
    verifier,
    rounds: () => answers.length,
    /** Answers the latest round: verified, or failed with `failure`. */
    answer: (failure: GrantFailure | null = null) =>
      Deferred.succeed(answers.at(-1)!, failure).pipe(Effect.andThen(settle)),
  };
};

/** Moves time a step at a time — at most a minute, and to each timer of the grant. */
const passWith = (clock: DeadlineClock, nextTimer: () => number) =>
  Effect.fnUntraced(function* (ms: number) {
    const until = clock.monoMs() + ms;
    for (;;) {
      const next = Math.min(nextTimer(), clock.monoMs() + MINUTE);
      if (next > until) break;
      yield* clock.advance(Math.max(1, next - clock.monoMs()));
      yield* settle;
    }
    yield* clock.advance(Math.max(0, until - clock.monoMs()));
    yield* settle;
  });

describe("the account runtime", () => {
  it.effect(
    "builds nothing post-grant before the epoch's first grant, and keeps it through a lapse (I10, AL-04, G11)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage();
          const writes = makeWrites();
          const grant = heldVerifier();
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              scope: scope(),
              adapter: inertAdapter,
              atomRegistry: registry,
              makeOpaqueId: () => "opaque",
            });
            return yield* makeAccountRuntime({
              data,
              verifier: grant.verifier,
              page: page.port,
              writes: writes.port,
              atomRegistry: registry,
            });
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          const postGrant = yield* Effect.forkChild(built.postGrant);
          yield* settle;

          // The first round is out and unanswered: nothing post-grant exists, no write is open.
          expect(grant.rounds()).toBe(1);
          expect(postGrant.pollUnsafe()).toBeUndefined();
          expect(writes.calls).toEqual([]);

          yield* grant.answer();

          const stage = yield* Fiber.join(postGrant);
          expect(writes.calls).toEqual([{ open: WINDOW }]);
          const heard: Array<Invalidation> = [];
          const subscription = yield* stage.invalidations.subscribe;
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((invalidation) => Effect.sync(() => heard.push(invalidation))),
            Effect.forkScoped,
          );

          // Frozen past the deadline: the grant lapses, the stage stays and hears it.
          yield* clock.freeze(20 * MINUTE);
          yield* settle;
          yield* clock.advance(SECOND);
          yield* settle;

          expect(writes.calls.at(-1)).toBe("close");
          expect(yield* built.postGrant).toBe(stage);
          expect(heard).toEqual([{ topic: "access", change: "lapsed" }]);
        }),
      ),
  );

  it.effect(
    "a visible wake after 30 s hidden retries the grant at once; a quick switch does not (§6.4)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage();
          const grant = heldVerifier();
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              scope: scope(),
              adapter: inertAdapter,
              atomRegistry: registry,
              makeOpaqueId: () => "opaque",
            });
            return yield* makeAccountRuntime({
              data,
              verifier: grant.verifier,
              page: page.port,
              writes: makeWrites().port,
              atomRegistry: registry,
            });
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          yield* settle;
          // Rounds fail up the session backoff until the next one waits 60 s.
          for (const rung of [2, 4, 8, 15, 30]) {
            yield* grant.answer({ kind: "server", status: 503 });
            yield* clock.advance(rung * SECOND);
            yield* settle;
          }
          yield* grant.answer({ kind: "server", status: 503 });
          expect(grant.rounds()).toBe(6);

          yield* page.emit({ type: "visibility", hidden: true });
          yield* page.emit({ type: "visibility", hidden: false });
          expect(grant.rounds()).toBe(6);

          yield* page.emit({ type: "visibility", hidden: true });
          yield* clock.advance(31 * SECOND);
          yield* settle;
          expect(grant.rounds()).toBe(6);
          // Back before the backoff's 60 s: the wake alone starts the round.
          yield* page.emit({ type: "visibility", hidden: false });
          expect(grant.rounds()).toBe(7);
        }),
      ),
  );

  it.effect(
    "a tab hidden across the renewal is granted on return, its push half paused and back (T-L1)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage();
          const writes = makeWrites();
          const rest = makeFakeZeropsRest();
          rest.addUser({
            user: {
              id: account.accountId,
              email: "person@example.test",
              clientUserList: [
                { id: "cu-1", clientId: organization.organizationId, roleCode: "OWNER" },
              ],
            },
            password: "secret",
          });
          rest.addProject({
            id: "project-1",
            clientId: organization.organizationId,
            name: "One",
            status: "ACTIVE",
          });
          const client = new ZeropsApiClient({ fetch: rest.fetch });
          client.restoreSession(rest.issueSession(account.accountId));
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              scope: scope(),
              adapter: makeFakeDatastream(rest).adapter,
              atomRegistry: registry,
              makeOpaqueId: (() => {
                let next = 0;
                return () => `opaque-${++next}`;
              })(),
              visibility: page.visibility,
            });
            return yield* makeAccountRuntime({
              data,
              verifier: makeRestAccessVerifier({
                client,
                account,
                concurrency: policy.roundProjectConcurrency,
                onUser: () => undefined,
              }),
              page: page.port,
              writes: writes.port,
              atomRegistry: registry,
            });
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          const data = built.data;
          yield* data
            .acquire({ kind: "organization-inventory", organization })
            .pipe(Effect.provideService(Clock.Clock, clock));
          const view = () => registry.get(data.access.view);
          const nextTimer = () => {
            const at = view().machine.timer;
            if (at === null) return Number.POSITIVE_INFINITY;
            const due =
              clock.monoMs() +
              Math.max(0, Math.min(at.wall - clock.wallMs(), at.mono - clock.monoMs()));
            return page.port.hidden() ? Math.ceil(due / MINUTE) * MINUTE : due;
          };
          const pass = passWith(clock, nextTimer);
          const interest = () =>
            Effect.map(data.state, (state) => [...state.interests.values()][0]?.interest.status);
          const statuses = new Set<string>();
          const writable = () =>
            grantPlatformWrite(view().machine, project().projectId, {
              now: { wall: clock.wallMs(), mono: clock.monoMs() },
              policy,
            }).allowed;
          yield* pass(SECOND);
          expect(view().machine.phase.phase).toBe("granted");
          expect(yield* interest()).toBe("observing");

          yield* pass(MINUTE);
          yield* page.emit({ type: "visibility", hidden: true });
          clock.alignHiddenTimers(true);
          for (let minute = 0; minute < 39; minute++) {
            yield* pass(MINUTE);
            expect(writable()).toBe(true);
            statuses.add((yield* data.state).access.status);
          }
          expect(yield* interest()).toBe("paused");
          clock.alignHiddenTimers(false);
          yield* page.emit({ type: "visibility", hidden: false });
          yield* pass(SECOND);

          expect(view().machine.phase.phase).toBe("granted");
          expect(writable()).toBe(true);
          expect([...statuses]).toEqual(["verified"]);
          expect(writes.calls).not.toContain("close");
          expect(yield* interest()).toBe("observing");
          // Renewed on schedule while hidden: at +12, +24 and +36 min.
          expect(rest.requests().filter(({ route }) => route === "GET /user/info").length).toBe(4);
        }),
      ),
  );
});
