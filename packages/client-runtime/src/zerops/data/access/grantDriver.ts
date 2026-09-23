/**
 * The access grant, interpreted inside the data runtime (DESIGN §4.2, D16(a)).
 *
 * One serialized queue feeds `transitionGrant`, and this driver runs what it asks for: the
 * verification reads through the `AccessVerifier` port, its one timer on the runtime's clock, and
 * the access observations the runtime's own state admits. It is the one owner of access time:
 * nothing else in the runtime expires access.
 *
 * - The runtime takes each grant before the view says it is granted, so a reader woken by the
 *   view finds the runtime holding it; reads and timers start after the view is published.
 * - A project's evidence that changes between rounds — it runs out, its own read verifies it, a
 *   denial closes it, its role is lowered — changes the runtime's grant at once (G2).
 * - Tab signals arrive as events from the account runtime, which owns them. A person's retry is an
 *   `access: renew-now` the grant hears on the account's invalidation bus (§6.2).
 */
import type * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { mateDiagnostics } from "../../diagnostics.ts";
import type { InvalidationBus } from "../../knowledge/invalidation.ts";
import type { ZeropsGrantPolicy } from "../policy.ts";
import {
  organizationKeyOf,
  projectKeyOf,
  type AccessObservation,
  type AccessState,
  type AccountScope,
  type ProjectEffectiveAccess,
  type ProjectRef,
  type VerifiedAccessGrant,
  type ZeropsProjectId,
} from "../types.ts";
import {
  grantRoundInFlight,
  initialGrant,
  transitionGrant,
  type Evidence,
  type GrantEffect,
  type GrantEvent,
  type GrantMachine,
  type Instant,
} from "./grant.ts";
import type { AccessRoundFailure, AccessVerifier } from "./verifier.ts";

/** What the runtime publishes of its grant. */
export interface AccessGrantView {
  readonly machine: GrantMachine;
  /** Why the last round failed, in the platform's words; null once another round starts. */
  readonly failure: string | null;
  /**
   * The epoch's first mount has waited `firstMountPatienceMs` since its round started or ended
   * (G10): its wait offers a way off. Never once the first mount happened.
   */
  readonly overdue: boolean;
}

/** The tab's signals, as the account runtime hands them over. */
export type GrantSignal = Extract<
  GrantEvent,
  { readonly type: "VISIBILITY" | "WAKE" | "ONLINE" | "OFFLINE" }
>;

/** What the grant asks the account's owners of pull-based facts to revalidate. */
export type GrantInvalidation = Extract<
  GrantEffect,
  { readonly kind: "invalidate" }
>["invalidation"];

export interface AccessGrantStart {
  readonly verifier: AccessVerifier;
  readonly hidden: boolean;
  readonly online: boolean;
}

export interface ZeropsAccessGrant {
  /** Starts the epoch's grant, once: its first round runs at once. */
  readonly start: (start: AccessGrantStart) => Effect.Effect<void>;
  readonly signal: (event: GrantSignal) => Effect.Effect<void>;
  /**
   * Hears the account's bus for the caller's scope: each `access: renew-now` is a person's retry,
   * which a round in flight joins (G7).
   */
  readonly listen: (bus: InvalidationBus) => Effect.Effect<void, never, Scope.Scope>;
  readonly view: Atom.Atom<AccessGrantView>;
  /** The view now, then every later one. */
  readonly changes: Stream.Stream<AccessGrantView>;
  /** Each invalidation the grant asks for from the moment of subscribing. */
  readonly invalidations: Stream.Stream<GrantInvalidation>;
  /** The epoch's first mount happened: its wait is over for the epoch. */
  readonly mounted: Effect.Effect<void>;
  /** The clock the grant stamps its evidence and runs its timer on. */
  readonly clock: Clock.Clock;
}

export interface GrantDriverOptions {
  readonly scope: AccountScope;
  readonly policy: ZeropsGrantPolicy;
  readonly clock: Clock.Clock;
  readonly atomRegistry: AtomRegistry.AtomRegistry;
  /** The runtime's access now: the projects a command established are the grant's too. */
  readonly access: Effect.Effect<AccessState>;
  /** Hands the runtime an access observation and waits until its state admitted it. */
  readonly observe: (observation: AccessObservation) => Effect.Effect<void>;
  /** Runs work in the runtime's scope, interrupted when the runtime shuts down. */
  readonly fork: (work: Effect.Effect<void>) => Effect.Effect<Fiber.Fiber<void>>;
}

export interface GrantDriver {
  readonly grant: ZeropsAccessGrant;
  /** Ends the grant with the epoch: no round, read or timer after it. */
  readonly close: Effect.Effect<void>;
}

/** The projects a grant carries from the evidence itself. */
const evidenceGrantProjects = (evidence: Evidence): ReadonlyArray<ProjectEffectiveAccess> =>
  [...evidence.projects.values()]
    .map(({ access }) => access)
    .filter(({ role }) => role !== "NO_ACCESS");

/** What of the evidence the runtime's grant is built from; a change is a new grant. */
const grantKey = (evidence: Evidence): string =>
  JSON.stringify([
    evidence.account.round,
    [...evidence.projects.values()].map(({ access }) => [
      access.project.projectId,
      access.project.organization.organizationId,
      access.role,
      access.mutationsAllowed,
    ]),
  ]);

/** The projects the runtime's access holds, a command's included. */
const establishedProjects = (access: AccessState): ReadonlyArray<ProjectRef> => {
  const held =
    access.status === "verified"
      ? access.projects
      : access.status === "verifying" || access.status === "failed"
        ? (access.previous?.projects ?? [])
        : [];
  return held.filter(({ role }) => role !== "NO_ACCESS").map(({ project }) => project);
};

/** How long `stamp`'s evidence still authorizes, on whichever clock runs out first. */
const remainingMs = (stamp: Instant, now: Instant, policy: ZeropsGrantPolicy): number =>
  Math.min(stamp.wall + policy.windowMs - now.wall, stamp.mono + policy.windowMs - now.mono);

export const makeGrantDriver = Effect.fnUntraced(function* (options: GrantDriverOptions) {
  const { clock, policy } = options;
  const now: Effect.Effect<Instant> = Effect.sync(() => ({
    wall: clock.currentTimeMillisUnsafe(),
    mono: Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000,
  }));
  const lock = yield* Semaphore.make(1);
  let machine = initialGrant({ hidden: false, online: true }, yield* now);
  let failure: string | null = null;
  let overdue = false;
  let verifier: AccessVerifier | null = null;
  let timer: Fiber.Fiber<void> | null = null;
  /** The round the verifier runs for the machine, while the machine holds it in flight. */
  let roundWork: { readonly round: number; readonly fiber: Fiber.Fiber<void> } | null = null;
  /** Each read between rounds the verifier runs, by project id, while its attempt is current. */
  const projectWork = new Map<
    ZeropsProjectId,
    { readonly attempt: number; readonly fiber: Fiber.Fiber<void> }
  >();
  /** Whether the epoch's first mount happened. */
  let mounted = false;
  /** The round the first mount's wait last started over for: the one in flight, or none. */
  let waitRound: number | null = null;
  /** Counts the first mount's waits, so a wait that started over is never overdue. */
  let waits = 0;
  let patience: Fiber.Fiber<void> | null = null;
  /** The evidence the runtime's grant was last built from, by `grantKey`. */
  let grantedKey: string | null = null;
  /** The projects the last grant carried from evidence, by `projectKeyOf`. */
  let fromEvidence: ReadonlySet<string> = new Set();

  const initialView: AccessGrantView = { machine, failure, overdue };
  // Kept for the registry's life, so a closed grant still reads closed.
  const view = Atom.keepAlive(Atom.make(initialView));
  const views = yield* SubscriptionRef.make(initialView);
  const invalidations = yield* PubSub.unbounded<GrantInvalidation>();

  /**
   * The runtime's grant for held evidence: every project whose own evidence
   * is fresh, and those a command established that no evidence has named yet —
   * in an organization the evidence still holds. A project the evidence holds
   * unverified or denied is out of it, and so is one the last grant carried from
   * evidence that no longer names it.
   */
  const runtimeGrant = (
    evidence: Evidence,
    access: AccessState,
    at: Instant,
  ): VerifiedAccessGrant => {
    const named = (project: ProjectRef) =>
      evidence.projects.has(project.projectId) ||
      evidence.unverified.has(project.projectId) ||
      evidence.closedProjects.has(project.projectId);
    const organizations = new Set(
      evidence.account.organizations.map(({ organization }) => organizationKeyOf(organization)),
    );
    const established =
      access.status === "verified"
        ? access.projects.filter(
            ({ project }) =>
              !named(project) &&
              !fromEvidence.has(projectKeyOf(project)) &&
              organizations.has(organizationKeyOf(project.organization)),
          )
        : [];
    return {
      account: options.scope.account,
      accountEpoch: options.scope.epoch,
      verifiedAtMs: evidence.account.startedAt.wall,
      deadlineMs: at.wall + remainingMs(evidence.account.startedAt, at, policy),
      mutationsAllowed: true,
      organizations: evidence.account.organizations,
      projects: [...evidenceGrantProjects(evidence), ...established],
    };
  };

  /** Hands the runtime the held evidence whenever what its grant is built from changed. */
  const syncRuntimeGrant = (at: Instant): Effect.Effect<void> =>
    Effect.gen(function* () {
      const phase = machine.phase;
      if (phase.phase !== "granted") return;
      const key = grantKey(phase.evidence);
      if (key === grantedKey) return;
      grantedKey = key;
      const grant = runtimeGrant(phase.evidence, yield* options.access, at);
      yield* options.observe({ kind: "access-verified", grant });
      fromEvidence = new Set(
        evidenceGrantProjects(phase.evidence).map(({ project }) => projectKeyOf(project)),
      );
    });

  /** The runtime's access follows the grant's phase: verifying, failed, expired. */
  const observeTransition = (
    before: GrantMachine,
    effects: ReadonlyArray<GrantEffect>,
    at: Instant,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const epoch = options.scope.epoch;
      for (const effect of effects) {
        if (effect.kind === "observe" && effect.observation.kind === "access-expired") {
          mateDiagnostics.record({ kind: "access-timer", timer: "expiry" });
          yield* options.observe({
            kind: "access-expired",
            accountEpoch: epoch,
            expiredAtMs: effect.observation.expiredAtMs,
          });
        }
        // A renewal never sends this: it would refuse commands while writes are still open.
        if (
          effect.kind === "run" &&
          effect.op.kind === "verify-round" &&
          machine.phase.phase === "verifying"
        ) {
          yield* options.observe({ kind: "access-verification-started", accountEpoch: epoch });
        }
      }
      if (before.phase.phase === "verifying" && machine.phase.phase === "unverified-failed") {
        yield* options.observe({
          kind: "access-verification-failed",
          accountEpoch: epoch,
          failedAtMs: at.wall,
          retryable: true,
          reason: failure ?? "Zerops didn't answer.",
        });
      }
      yield* syncRuntimeGrant(at);
    });

  const publish = Effect.suspend(() => {
    const next: AccessGrantView = { machine, failure, overdue };
    options.atomRegistry.set(view, next);
    return SubscriptionRef.set(views, next);
  });

  /** Runs one effect after the view that asked for it is published. */
  const interpret = (effect: GrantEffect): Effect.Effect<void> => {
    switch (effect.kind) {
      case "run": {
        const port = verifier!;
        if (effect.op.kind === "verify-round") {
          const round = effect.attempt;
          const carried = effect.op.carried;
          if (machine.phase.phase !== "verifying") {
            mateDiagnostics.record({ kind: "access-timer", timer: "renewal" });
          }
          return Effect.gen(function* () {
            // Projects a command established since are the grant's too: read them.
            const established = establishedProjects(yield* options.access);
            const fiber = yield* options.fork(
              port
                .verifyRound({ round, carried: [...carried, ...established], report: send })
                .pipe(
                  Effect.catch((cause: AccessRoundFailure) =>
                    send({ type: "ROUND_FAILED", round, failure: cause.failure }, cause.message),
                  ),
                ),
            );
            roundWork = { round, fiber };
          });
        }
        const project = effect.op.project;
        const attempt = effect.attempt;
        return options
          .fork(
            port
              .verifyProject(project)
              .pipe(
                Effect.flatMap((outcome) =>
                  send({ type: "PROJECT_RESULT", attempt, project, outcome }),
                ),
              ),
          )
          .pipe(
            Effect.map((fiber) => {
              projectWork.set(project.projectId, { attempt, fiber });
            }),
          );
      }
      case "schedule":
        return Effect.gen(function* () {
          yield* cancelTimer;
          // The timer only wakes the queue: interrupting it never cuts a transition short.
          timer = yield* options.fork(
            untilReached(effect.at).pipe(
              Effect.andThen(options.fork(send({ type: "TICK" }))),
              Effect.asVoid,
            ),
          );
        });
      case "cancel":
        return cancelTimer;
      case "invalidate":
        return PubSub.publish(invalidations, effect.invalidation).pipe(Effect.asVoid);
      case "observe":
      case "withhold":
      case "restore-authority":
      case "log":
        // Observations reach the runtime with the transition; the view carries the authority.
        return Effect.void;
    }
  };

  /**
   * Sleeps until `at` on either clock. A sleep can end short of it on the clock
   * it did not count — a system clock set back, a timer fired a little early —
   * and the machine only re-arms a timer whose instant changed, so the wait
   * goes on until the instant has truly come.
   */
  const untilReached = (at: Instant): Effect.Effect<void> =>
    Effect.flatMap(now, (current) => {
      const waitMs = Math.min(at.wall - current.wall, at.mono - current.mono);
      return waitMs <= 0
        ? Effect.void
        : clock.sleep(Duration.millis(waitMs)).pipe(Effect.andThen(untilReached(at)));
    });

  const cancelTimer = Effect.suspend(() => {
    const running = timer;
    timer = null;
    return running === null ? Effect.void : Fiber.interrupt(running);
  });

  const cancelPatience = Effect.suspend(() => {
    const running = patience;
    patience = null;
    return running === null ? Effect.void : Fiber.interrupt(running);
  });

  /** The first mount's wait starts over: overdue after the patience, unless it starts over again. */
  const waitPatiently = Effect.gen(function* () {
    yield* cancelPatience;
    const wait = waits;
    const at = yield* now;
    const becomeOverdue = lock.withPermit(
      Effect.suspend(() => {
        if (wait !== waits) return Effect.void;
        overdue = true;
        return publish;
      }),
    );
    patience = yield* options.fork(
      untilReached({
        wall: at.wall + policy.firstMountPatienceMs,
        mono: at.mono + policy.firstMountPatienceMs,
      }).pipe(Effect.andThen(options.fork(becomeOverdue)), Effect.asVoid),
    );
  });

  /**
   * The work the machine no longer holds: a round that is no longer in flight, a read whose
   * attempt is no longer current. Work that ended on its own last answer is finishing by itself;
   * a round whose deadline had come is not, whichever answer ended it.
   */
  const abandonedWork = (
    event: GrantEvent,
    before: GrantMachine,
    at: Instant,
  ): ReadonlyArray<Fiber.Fiber<void>> => {
    const abandoned: Array<Fiber.Fiber<void>> = [];
    if (roundWork !== null && grantRoundInFlight(machine)?.id !== roundWork.round) {
      const deadline = grantRoundInFlight(before)?.deadline;
      const ownAnswer =
        (event.type === "ROUND_ACCOUNT" ||
          event.type === "ROUND_PROJECT" ||
          event.type === "ROUND_FAILED") &&
        event.round === roundWork.round;
      const due = deadline === undefined || at.wall >= deadline.wall || at.mono >= deadline.mono;
      if (!ownAnswer || (due && event.type !== "ROUND_FAILED")) abandoned.push(roundWork.fiber);
      roundWork = null;
    }
    for (const [id, work] of projectWork) {
      if (machine.projectAttempts.get(id)?.attempt === work.attempt) continue;
      const ownAnswer =
        event.type === "PROJECT_RESULT" &&
        event.project.projectId === id &&
        event.attempt === work.attempt;
      if (!ownAnswer) abandoned.push(work.fiber);
      projectWork.delete(id);
    }
    return abandoned;
  };

  /**
   * Interrupts abandoned work once the transition that abandoned it is done: under the lock, so
   * no fiber is cut short inside a transition, even one of the abandoned work's own.
   */
  const interruptWork = (fibers: ReadonlyArray<Fiber.Fiber<void>>): Effect.Effect<void> =>
    fibers.length === 0
      ? Effect.void
      : options.fork(lock.withPermit(Fiber.interruptAll(fibers))).pipe(Effect.asVoid);

  /** One event through the machine; `message` is a failed round's reason in the platform's words. */
  function send(event: GrantEvent, message?: string): Effect.Effect<void> {
    return lock.withPermit(
      Effect.gen(function* () {
        if (verifier === null) return;
        const at = yield* now;
        const before = machine;
        const { state, effects } = transitionGrant(machine, event, { now: at, policy });
        machine = state;
        if (
          message !== undefined &&
          event.type === "ROUND_FAILED" &&
          grantRoundInFlight(before)?.id === event.round
        ) {
          failure = message;
        }
        if (effects.some((effect) => effect.kind === "run" && effect.op.kind === "verify-round")) {
          failure = null;
        }
        const abandoned = abandonedWork(event, before, at);
        // The first mount waits afresh whenever a round starts or ends.
        const round = grantRoundInFlight(machine)?.id ?? null;
        const waitAgain =
          !mounted &&
          machine.phase.phase !== "closed" &&
          (event.type === "START" || round !== waitRound);
        if (waitAgain) {
          waitRound = round;
          waits++;
          overdue = false;
        }
        yield* observeTransition(before, effects, at);
        yield* publish;
        for (const effect of effects) yield* interpret(effect);
        yield* interruptWork(abandoned);
        if (waitAgain) yield* waitPatiently;
      }),
    );
  }

  const grant: ZeropsAccessGrant = {
    start: (start) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            // An epoch that ended before its grant started never starts it.
            if (machine.phase.phase === "closed") return false;
            if (verifier !== null) return yield* Effect.die("The access grant started twice.");
            verifier = start.verifier;
            machine = initialGrant({ hidden: start.hidden, online: start.online }, yield* now);
            return true;
          }),
        )
        .pipe(Effect.flatMap((started) => (started ? send({ type: "START" }) : Effect.void))),
    signal: (event) => send(event),
    listen: (bus) =>
      Effect.flatMap(bus.subscribe, (subscription) =>
        Stream.fromSubscription(subscription).pipe(
          Stream.runForEach((invalidation) =>
            invalidation.topic === "access" && invalidation.change === "renew-now"
              ? send({ type: "USER_RETRY" })
              : Effect.void,
          ),
          Effect.forkScoped,
        ),
      ).pipe(Effect.asVoid),
    view,
    changes: SubscriptionRef.changes(views),
    invalidations: Stream.fromPubSub(invalidations),
    mounted: lock
      .withPermit(
        Effect.suspend(() => {
          if (mounted) return Effect.void;
          mounted = true;
          waits++;
          if (!overdue) return Effect.void;
          overdue = false;
          return publish;
        }),
      )
      .pipe(Effect.andThen(cancelPatience)),
    clock,
  };

  return {
    grant,
    close: lock
      .withPermit(
        Effect.gen(function* () {
          const at = yield* now;
          const before = machine;
          const event: GrantEvent = { type: "EPOCH_CLOSED" };
          machine = transitionGrant(machine, event, { now: at, policy }).state;
          const abandoned = abandonedWork(event, before, at);
          waits++;
          overdue = false;
          yield* publish;
          yield* interruptWork(abandoned);
        }),
      )
      .pipe(Effect.andThen(cancelTimer), Effect.andThen(cancelPatience)),
  } satisfies GrantDriver;
});
