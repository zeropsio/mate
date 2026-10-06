/**
 * The account runtime (DESIGN §1.1, §1.2, §5, G11): one composition root per account epoch, with
 * a pre-grant stage — the session's client, the access verifier, the data runtime and its grant —
 * and a post-grant stage built on the epoch's first `granted`.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import { AtomRegistry } from "effect/unstable/reactivity";
import { EnvironmentId } from "@t3tools/contracts";

import { ZeropsApiClient } from "../api.ts";
import { account, organization, project, scope } from "../data/__fixtures__/index.ts";
import { makeRestAccessVerifier, type AccessVerifier } from "../data/access/verifier.ts";
import { grantPlatformWrite, type GrantFailure } from "../data/access/grant.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY, makeZeropsDataPolicy } from "../data/policy.ts";
import { makeZeropsDataRuntime } from "../data/runtime.ts";
import {
  decodeEntityDirectResponse,
  decodeEntityQueryPages,
  decodeRegistrationResponse,
} from "../data/platformProtocol.ts";
import {
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type MembershipQueryDescriptor,
  type ProjectRef,
  type ZeropsDataAdapter,
} from "../data/types.ts";
import type { DescriptorFacts } from "../environments/environmentMachine.ts";
import type { CloseOffWord } from "../environments/closeOff.ts";
import { mateListingsAtom } from "../environments/listings.ts";
import { readServiceMateFlag } from "../environments/mateFlag.ts";
import { rowTarget } from "../environments/mateLink.ts";
import type { ProbeReading } from "../environments/probeStore.ts";
import { REGISTRATION_RECORDS_KEY, type RegistrationRecord } from "../environments/records.ts";
import { heldCandidates } from "../projections/candidates.ts";
import type { ExchangeAnswer } from "../identityExchange.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import { makePlatformSignals, type PageEvent } from "../knowledge/signals.ts";
import { makeDeadlineClock, type DeadlineClock } from "../testing/deadlineClock.ts";
import { makeFakeDatastream } from "../testing/fakeDatastream.ts";
import { makeFakeZeropsRest } from "../testing/fakeZeropsRest.ts";
import {
  makeAccountRuntime,
  type AccountEnvironmentPorts,
  type CatalogListener,
  type DoorCredential,
  type DoorRequest,
} from "./accountRuntime.ts";
import { liveProjects, liveServices } from "../../data/__fixtures__/account.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import { makeAccountStore } from "../../data/store.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const START_WALL_MS = Date.UTC(2026, 8, 23, 10, 0, 0);
const policy = DEFAULT_ZEROPS_GRANT_POLICY;
const organizations = [{ organization, mutationsAllowed: true }];
const A = project("project-a");

/** A datastream that never answers: the account's inventory leases wait on it for good. */
const inertAdapter: ZeropsDataAdapter = {
  openReceiver: () => Effect.never,
  register: () => Effect.never,
  read: () => Effect.never,
  execute: () => Effect.never,
  closeReceiver: () => Effect.void,
};

/** A Mate a platform project serves: its target, its origin and its rows. */
const mate = (id: string) => {
  const projectId = `project-${id}`;
  return {
    key: `${projectId}:service-${id}`,
    origin: `https://zcp-${id}-8080.prg1.zerops.app`,
    projectId,
    project: {
      id: projectId,
      name: `shop ${id}`,
      status: "ACTIVE",
      publicZone: "x.prg1-zerops.zone",
      zeropsSubdomainHost: id,
    },
    service: {
      id: `service-${id}`,
      projectId,
      name: "zcp",
      status: "ACTIVE",
      serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
      subdomainAccess: true,
      ports: [{ port: 8080 }],
    },
  };
};
type Mate = ReturnType<typeof mate>;

/** Project A's Mate: the one most tests reach. */
const A_MATE = mate("a");
const MATE = A_MATE.key;
const MATE_ORIGIN = A_MATE.origin;
const ENV_A = EnvironmentId.make("env-a");

/** The datastream over a platform whose one organization holds these Mates' projects. */
const platformAdapter = (
  mates: ReadonlyArray<Mate>,
  /** The services' variables as the stream answers them; `never`: it never answers. */
  variables: ReadonlyArray<unknown> | "never" = [],
): ZeropsDataAdapter => {
  const rowsOf = (query: MembershipQueryDescriptor): ReadonlyArray<unknown> => {
    switch (query.kind) {
      case "projects-of-organization":
        return mates.map(({ project }) => project);
      case "services-of-project":
        return mates
          .filter(({ projectId }) => projectId === query.project.projectId)
          .map(({ service }) => service);
    }
  };
  return {
    openReceiver: (_scope, receiving, identity) =>
      Effect.succeed({
        identity,
        organization: receiving,
        delivery: "hot-single-consumer-buffered-before-open-resolves",
        events: Stream.never,
      }),
    register: (_receiver, request) =>
      request.descriptor.kind === "table-list" && variables === "never"
        ? Effect.never
        : Effect.sync(() => {
            if (request.descriptor.kind === "table-list") {
              const listed =
                request.descriptor.query.kind === "service-variables-of-services" &&
                variables !== "never"
                  ? variables
                  : [];
              return {
                responseObservations: decodeRegistrationResponse(request, {
                  items: listed,
                  totalHits: listed.length,
                }).observations,
              };
            }
            if (request.descriptor.kind !== "query-membership") return { responseObservations: [] };
            const items = rowsOf(request.descriptor.query);
            return {
              responseObservations: decodeRegistrationResponse(request, {
                items,
                totalHits: items.length,
              }).observations,
            };
          }),
    read: (ticket) =>
      Effect.sync(() => {
        if (ticket.target.kind === "query") {
          const descriptor = ticket.target.descriptor as MembershipQueryDescriptor;
          const rows = rowsOf(descriptor);
          return {
            observations: decodeEntityQueryPages(
              descriptor,
              ticket,
              [{ rows, totalCount: rows.length }],
              "direct-read",
            ).observations,
          };
        }
        const target = ticket.target;
        const listed =
          target.kind === "project"
            ? mates.find(({ projectId }) => projectId === target.ref.projectId)
            : undefined;
        return listed === undefined
          ? { observations: [] }
          : { observations: decodeEntityDirectResponse(ticket, listed.project).observations };
      }),
    execute: () => Effect.succeed({ observations: [] }),
    closeReceiver: () => Effect.void,
  };
};

/** An op a port started: answered by the test, or ended by its signal. */
interface Pending<Input, Answer> {
  readonly input: Input;
  readonly signal: AbortSignal;
  readonly answer: (answer: Answer) => void;
}

const pending = <Input, Answer>(
  started: Array<Pending<Input, Answer>>,
  input: Input,
  signal: AbortSignal,
) =>
  new Promise<Answer>((resolve, reject) => {
    started.push({ input, signal, answer: resolve });
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

/** A door that admits `environmentId`, and a credential the registry takes as `install` says. */
const admitted = (
  environmentId: EnvironmentId,
  install: DoorCredential["install"],
): ExchangeAnswer<DoorCredential> => ({
  ok: true,
  environmentId,
  descriptor: {
    environmentId,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  credential: { install },
});

/** A descriptor that answered as Mate for this environment, stating this project. */
const answering = (environmentId: EnvironmentId, projectId: string): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId,
  initAt: null,
});

/**
 * The Mate environments' ports as a tab hands them over, with no React: every exchange and probe
 * is recorded and left for the test to answer, the records hold what `remembered` names, and the
 * catalog and the records' other tabs are the test's to drive.
 */
const environmentRig = (clock: DeadlineClock, remembered: ReadonlyArray<RegistrationRecord>) => {
  const exchanges: Array<Pending<DoorRequest, ExchangeAnswer<DoorCredential>>> = [];
  const descriptors: Array<Pending<string, DescriptorFacts>> = [];
  const probes: Array<Pending<string, ProbeReading>> = [];
  const removed: Array<EnvironmentId> = [];
  /** Every target whose kept session the stage dropped. */
  const forgotten: Array<string> = [];
  const storage = new Map<string, string>([[REGISTRATION_RECORDS_KEY, JSON.stringify(remembered)]]);
  /** What the stage listens to now, by port. */
  const listening = { records: 0, catalog: 0 };
  /** How many times the records were read from storage. */
  let recordReads = 0;
  /** What the stage hears when another tab writes the records. */
  let recordsChanged: (() => void) | null = null;
  /** The tab's writes of the records do not land: a full or refusing storage, which the port swallows. */
  let writesLand = true;
  let catalog: CatalogListener | null = null;
  /** The environment the tab's route names, as its address bar holds it. */
  let route: EnvironmentId | null = null;
  /** Each environment the stage told the socket admission to open first. */
  const preferred: Array<EnvironmentId | null> = [];
  /** The environments the socket admission holds as down now. */
  const down: Array<EnvironmentId> = [];
  /** Whether each environment is parked, as the stage last told the registry (A9). */
  const parked = new Map<EnvironmentId, boolean>();
  /** Every timer armed and not disarmed: none fires unless the test fires it. */
  const timers = new Set<{ readonly delayMs: number; readonly fire: () => void }>();
  const ports: AccountEnvironmentPorts = {
    clock: {
      now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
      random: () => 0.5,
      setTimer: (delayMs, fire) => {
        const timer = { delayMs, fire };
        timers.add(timer);
        return () => void timers.delete(timer);
      },
    },
    door: {
      exchange: (request) => pending(exchanges, request, request.signal),
      readDescriptor: (origin, signal) => pending(descriptors, origin, signal),
      retryLink: () => undefined,
      remove: (environmentId) => void removed.push(environmentId),
      forgetKept: (key) => void forgotten.push(key),
      park: (environmentId) => void parked.set(environmentId, true),
      unpark: (environmentId) => void parked.set(environmentId, false),
    },
    probe: (origin, signal) => {
      const sentAt = { wall: clock.wallMs(), mono: clock.monoMs() };
      return pending(probes, origin, signal).then((reading) => ({ reading, sentAt }));
    },
    readInitAt: async () => null,
    intents: { read: () => null, write: () => undefined },
    records: {
      getItem: (key) => {
        recordReads += 1;
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (writesLand) storage.set(key, value);
      },
      listen: (changed) => {
        recordsChanged = changed;
        listening.records += 1;
        return () => void (listening.records -= 1);
      },
    },
    catalog: {
      listen: (listener) => {
        catalog = listener;
        listening.catalog += 1;
        return () => void (listening.catalog -= 1);
      },
    },
    route: () => route,
    admission: {
      prefer: (environmentId) => void preferred.push(environmentId),
      down: (environmentId) => {
        down.push(environmentId);
        return () => void down.splice(down.indexOf(environmentId), 1);
      },
    },
    // HQ's word, current: it names no environment's project, holds no Mate online and speaks for
    // no organization. A test that needs another word says it.
    hqIndex: { projectOf: () => null, subscribe: () => () => undefined },
    online: { read: () => new Set(), subscribe: () => () => undefined },
    hqOrganization: { read: () => null, subscribe: () => () => undefined },
    // No word on any close-off, and none pending here: nothing is held.
    closeOff: { read: () => null, subscribe: () => () => undefined },
    closeOffPending: { read: () => new Set(), subscribe: () => () => undefined },
  };
  return {
    ports,
    preferred,
    down,
    /** The environments parked now, as the stage last told the registry. */
    parked: () => [...parked].flatMap(([environmentId, held]) => (held ? [environmentId] : [])),
    /** The environments unparked now, as the stage last told the registry. */
    unparked: () => [...parked].flatMap(([environmentId, held]) => (held ? [] : [environmentId])),
    /** Fires every timer armed for this delay. */
    fire: (delayMs: number) => {
      // Only the timers armed before this fire: one a fire arms waits for the next.
      for (const timer of Array.from(timers)) {
        if (timer.delayMs !== delayMs) continue;
        timers.delete(timer);
        timer.fire();
      }
    },
    /** The tab opens on this environment's route: the stage reads it when it starts. */
    openOn: (environmentId: EnvironmentId | null) => {
      route = environmentId;
    },
    exchanges,
    descriptors,
    probes,
    removed,
    forgotten,
    listening,
    /** The records as they are stored now. */
    records: () =>
      JSON.parse(storage.get(REGISTRATION_RECORDS_KEY) ?? "[]") as Array<RegistrationRecord>,
    recordReads: () => recordReads,
    /**
     * Another tab stores these records; `announce` is whether its storage event has reached this
     * tab yet.
     */
    storeElsewhere: (records: ReadonlyArray<RegistrationRecord>, announce: boolean) => {
      storage.set(REGISTRATION_RECORDS_KEY, JSON.stringify(records));
      if (announce) recordsChanged?.();
    },
    /** The connection catalog as the stage hears it. */
    catalog: () => catalog!,
    /** Whether this tab's writes of the records land from now on. */
    landWrites: (land: boolean) => {
      writesLand = land;
    },
  };
};

/** The ports of a runtime whose Mates these tests never reach. */
const inertEnvironments = (clock: DeadlineClock) => environmentRig(clock, []).ports;

const REMEMBERED_A: RegistrationRecord = {
  targetKey: MATE,
  environmentId: ENV_A,
  origin: MATE_ORIGIN,
  projectRef: { projectId: A_MATE.projectId, orgId: "org-1" },
  name: "shop a",
};

/** Lets every fiber the last step woke run to its next wait, on whichever scheduler it runs. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    yield* Effect.yieldNow;
  }
});

/** A tab's page as the platform reports it, and the signals the account hears of it (§6.4). */
const makePage = Effect.fnUntraced(function* (clock: DeadlineClock) {
  const visibility = yield* PubSub.unbounded<boolean>();
  const hearers = new Set<(event: PageEvent) => void>();
  let hidden = false;
  const signals = makePlatformSignals({
    hidden: () => hidden,
    online: () => true,
    now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
    listen: (hear) => {
      hearers.add(hear);
      return () => hearers.delete(hear);
    },
  });
  return {
    signals,
    hidden: () => hidden,
    /** The runtime's own visibility port over the same page. */
    visibility: {
      current: Effect.sync(() => (hidden ? ("hidden" as const) : ("visible" as const))),
      changes: Stream.fromPubSub(visibility).pipe(
        Stream.map((isHidden) => (isHidden ? ("hidden" as const) : ("visible" as const))),
      ),
    },
    /** How many listeners hear the page now. */
    listening: () => hearers.size,
    emit: (event: PageEvent) =>
      Effect.suspend(() => {
        if (event.type === "visibility") hidden = event.hidden;
        for (const hear of hearers) hear(event);
        return event.type === "visibility" ? PubSub.publish(visibility, event.hidden) : Effect.void;
      }).pipe(Effect.andThen(settle)),
  };
});

/** A grant whose rounds each wait for the test to answer them, then verify `projects`. */
const heldVerifier = (
  projects: ReadonlyArray<ProjectRef> = [A],
  /** Projects the round verifies with no access: listed, and not this person's to know. */
  hidden: ReadonlyArray<ProjectRef> = [],
) => {
  const answers: Array<Deferred.Deferred<GrantFailure | null>> = [];
  const verifier: AccessVerifier = {
    verifyRound: ({ round, report }) =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<GrantFailure | null>();
        answers.push(answer);
        const failure = yield* Deferred.await(answer);
        if (failure !== null) return yield* Effect.fail({ failure, message: "Zerops is down." });
        yield* report({
          type: "ROUND_ACCOUNT",
          round,
          organizations,
          projects: [...projects, ...hidden],
        });
        for (const verified of projects)
          yield* report({
            type: "ROUND_PROJECT",
            round,
            project: verified,
            outcome: {
              kind: "verified",
              access: { project: verified, role: "OWNER", mutationsAllowed: true },
            },
          });
        for (const verified of hidden)
          yield* report({
            type: "ROUND_PROJECT",
            round,
            project: verified,
            outcome: {
              kind: "verified",
              access: { project: verified, role: "NO_ACCESS", mutationsAllowed: false },
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
          const page = yield* makePage(clock);
          const grant = heldVerifier();
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: inertAdapter,
              atomRegistry: registry,
              makeOpaqueId: () => "opaque",
            });
            return yield* makeAccountRuntime({
              data,
              verifier: grant.verifier,
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          const postGrant = yield* Effect.forkChild(built.postGrant);
          yield* settle;

          // The first round is out and unanswered: nothing post-grant exists.
          expect(grant.rounds()).toBe(1);
          expect(postGrant.pollUnsafe()).toBeUndefined();

          yield* grant.answer();

          const stage = yield* Fiber.join(postGrant);
          const heard: Array<Invalidation> = [];
          const subscription = yield* built.invalidations.subscribe;
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((invalidation) => Effect.sync(() => heard.push(invalidation))),
            Effect.forkScoped,
          );

          // Frozen past the deadline: the grant lapses, the stage stays and the bus hears it.
          yield* clock.freeze(20 * MINUTE);
          yield* settle;
          yield* clock.advance(SECOND);
          yield* settle;

          expect(yield* built.postGrant).toBe(stage);
          expect(heard).toEqual([{ topic: "access", change: "lapsed" }]);
        }),
      ),
  );

  it.effect(
    "holds the account's inventory with no view: its organizations from the first round's listing, its projects from the grant (L7)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage(clock);
          const projectAnswered = yield* Deferred.make<void>();
          const verifier: AccessVerifier = {
            verifyRound: ({ round, report }) =>
              Effect.gen(function* () {
                yield* report({ type: "ROUND_ACCOUNT", round, organizations, projects: [A] });
                yield* Deferred.await(projectAnswered);
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
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: platformAdapter([A_MATE]),
              atomRegistry: registry,
              makeOpaqueId: (() => {
                let next = 0;
                return () => `opaque-${++next}`;
              })(),
            });
            return yield* makeAccountRuntime({
              data,
              verifier,
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
          }).pipe(Effect.provideService(Clock.Clock, clock));
          const demanded = () =>
            Effect.map(built.data.state, ({ interests }) =>
              [...interests.values()]
                .filter(({ leases }) => leases > 0)
                .map(({ descriptor }) => descriptor.kind),
            );
          yield* clock.advance(SECOND);
          yield* settle;

          // The round listed the organization; its project is still being read.
          expect(yield* demanded()).toEqual(["organization-inventory"]);

          yield* Deferred.succeed(projectAnswered, undefined);
          yield* clock.advance(SECOND);
          yield* settle;
          expect(yield* demanded()).toEqual(["organization-inventory"]);

          yield* built.close("logout");
          expect(yield* demanded()).toEqual([]);
        }),
      ),
  );

  it.effect(
    "a surface intent and a grant invalidation reach the same subscriber through one bus",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage(clock);
          const grant = heldVerifier();
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: inertAdapter,
              atomRegistry: registry,
              makeOpaqueId: () => "opaque",
            });
            return yield* makeAccountRuntime({
              data,
              verifier: grant.verifier,
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          const heard: Array<Invalidation> = [];
          const subscription = yield* built.invalidations.subscribe;
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((invalidation) => Effect.sync(() => heard.push(invalidation))),
            Effect.forkScoped,
          );
          yield* settle;

          // Before the first grant: a person's "Try again" on the gate is heard.
          yield* built.invalidations
            .invalidate({ topic: "access", change: "renew-now" })
            .pipe(Effect.provideService(Clock.Clock, clock));
          yield* clock.advance(SECOND);
          yield* settle;
          expect(heard).toEqual([{ topic: "access", change: "renew-now" }]);

          yield* grant.answer();
          yield* built.invalidations
            .invalidate({ topic: "container", target: "project-a:service-a" })
            .pipe(Effect.provideService(Clock.Clock, clock));
          yield* clock.freeze(20 * MINUTE);
          yield* settle;
          yield* clock.advance(SECOND);
          yield* settle;

          expect(heard).toEqual([
            { topic: "access", change: "renew-now" },
            { topic: "container", target: "project-a:service-a" },
            { topic: "access", change: "lapsed" },
          ]);
        }),
      ),
  );

  it.effect("renew-now on the bus starts one round with no React mounted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const registry = AtomRegistry.make();
        const page = yield* makePage(clock);
        const grant = heldVerifier();
        const built = yield* Effect.gen(function* () {
          const data = yield* makeZeropsDataRuntime({
            random: () => 0,
            scope: scope(),
            adapter: inertAdapter,
            atomRegistry: registry,
            makeOpaqueId: () => "opaque",
          });
          return yield* makeAccountRuntime({
            data,
            verifier: grant.verifier,
            signals: page.signals,
            atomRegistry: registry,
            environments: inertEnvironments(clock),
          }).pipe(
            Effect.tap((runtime) =>
              Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
            ),
          );
        }).pipe(Effect.provideService(Clock.Clock, clock));
        yield* Effect.addFinalizer(() => built.close("application-close"));
        const renewNow = built.invalidations
          .invalidate({ topic: "access", change: "renew-now" })
          .pipe(Effect.provideService(Clock.Clock, clock));
        yield* settle;
        // The first round failed: the next one waits out the backoff's 2 s.
        yield* grant.answer({ kind: "server", status: 503 });
        expect(grant.rounds()).toBe(1);

        yield* renewNow;
        yield* renewNow;
        yield* clock.advance(250);
        yield* settle;
        expect(grant.rounds()).toBe(2);

        // A retry while that round is out joins it (G7).
        yield* renewNow;
        yield* clock.advance(250);
        yield* settle;
        expect(grant.rounds()).toBe(2);
      }),
    ),
  );

  it.effect("inventory(org) on the bus refreshes that organization's reads only", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const registry = AtomRegistry.make();
        const page = yield* makePage(clock);
        const other = { ...organization, organizationId: ZeropsOrganizationId.make("org-2") };
        const rest = makeFakeZeropsRest();
        rest.addUser({
          user: {
            id: account.accountId,
            email: "person@example.test",
            clientUserList: [
              { id: "cu-1", clientId: organization.organizationId, roleCode: "OWNER" },
              { id: "cu-2", clientId: other.organizationId, roleCode: "OWNER" },
            ],
          },
          password: "secret",
        });
        for (const [id, clientId] of [
          ["project-1", organization.organizationId],
          ["project-2", other.organizationId],
        ] as const)
          rest.addProject({ id, clientId, name: id, status: "ACTIVE" });
        const client = new ZeropsApiClient({ fetch: rest.fetch });
        client.restoreSession(rest.issueSession(account.accountId));
        const datastream = makeFakeDatastream(rest).adapter;
        /** Each organization whose receiver the runtime opened, in order. */
        const opened: Array<string> = [];
        const built = yield* Effect.gen(function* () {
          const data = yield* makeZeropsDataRuntime({
            random: () => 0,
            scope: scope(),
            adapter: {
              ...datastream,
              openReceiver: (at, receiving, identity, context) =>
                Effect.sync(() => opened.push(receiving.organizationId)).pipe(
                  Effect.andThen(datastream.openReceiver(at, receiving, identity, context)),
                ),
            },
            atomRegistry: registry,
            makeOpaqueId: (() => {
              let next = 0;
              return () => `opaque-${++next}`;
            })(),
          });
          return yield* makeAccountRuntime({
            data,
            verifier: makeRestAccessVerifier({
              client,
              account,
              concurrency: policy.roundProjectConcurrency,
              onUser: () => undefined,
            }),
            signals: page.signals,
            atomRegistry: registry,
            environments: inertEnvironments(clock),
          }).pipe(
            Effect.tap((runtime) =>
              Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
            ),
          );
        }).pipe(Effect.provideService(Clock.Clock, clock));
        yield* Effect.addFinalizer(() => built.close("application-close"));
        const data = built.data;
        const statuses = () =>
          Effect.map(data.state, (state) =>
            [...state.interests.values()].map(({ interest }) => interest.status),
          );
        const rounds = () => rest.requests().filter(({ route }) => route === "GET /user/info");
        // The projects' inventories are held a step after the organizations': once the grant names them.
        yield* clock.advance(SECOND);
        yield* settle;
        yield* settle;
        // Only the selected organization holds inventory leases; its projects are the account
        // store's, so its inventory opens no receiver of its own.
        expect(yield* statuses()).toEqual(["observing"]);
        expect(opened).toEqual([]);
        const roundsBefore = rounds().length;

        yield* built.invalidations
          .invalidate({ topic: "inventory", organization })
          .pipe(Effect.provideService(Clock.Clock, clock));
        yield* built.invalidations
          .invalidate({ topic: "inventory", organization })
          .pipe(Effect.provideService(Clock.Clock, clock));
        yield* clock.advance(250);
        yield* settle;

        expect(opened).toEqual([]);
        expect(yield* statuses()).toEqual(["observing"]);
        expect(rounds()).toHaveLength(roundsBefore);
      }),
    ),
  );

  it.effect(
    "reads a Mate flag from the account's streamed variables however often it is asked, registering nothing",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage(clock);
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
            name: "project-1",
            status: "ACTIVE",
            tagList: ["mate"],
          });
          const client = new ZeropsApiClient({ fetch: rest.fetch });
          client.restoreSession(rest.issueSession(account.accountId));
          const datastream = makeFakeDatastream(rest, {
            variables: () => [
              {
                id: "variable-1",
                serviceStackId: "service-1",
                projectId: "project-1",
                key: "ZCP_MATE_ENABLED",
                content: "1",
              },
            ],
          });
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: datastream.adapter,
              atomRegistry: registry,
              makeOpaqueId: (() => {
                let next = 0;
                return () => `opaque-${++next}`;
              })(),
            });
            return yield* makeAccountRuntime({
              data,
              verifier: makeRestAccessVerifier({
                client,
                account,
                concurrency: policy.roundProjectConcurrency,
                onUser: () => undefined,
              }),
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          yield* clock.advance(SECOND);
          yield* settle;
          yield* settle;
          const service = {
            kind: "service" as const,
            project: {
              kind: "project" as const,
              organization,
              projectId: ZeropsProjectId.make("project-1"),
            },
            serviceId: ZeropsServiceId.make("service-1"),
          };

          yield* built.data.acquire({
            kind: "project-variables",
            project: service.project,
            serviceIds: [service.serviceId],
          });
          yield* clock.advance(SECOND);
          yield* settle;
          const registered = datastream.registrations().length;
          for (let asked = 0; asked < 20; asked++) {
            const flag = yield* Effect.promise(() =>
              readServiceMateFlag(built.data, registry, service),
            );
            expect(flag).toBe(true);
            yield* settle;
          }

          expect(datastream.registrations()).toHaveLength(registered);
          expect(
            datastream
              .registrations()
              .filter(
                ({ descriptor }) =>
                  descriptor.kind === "table-list" || descriptor.kind === "table-updates",
              ),
          ).toHaveLength(2);
        }),
      ),
  );

  it.effect(
    "reads a Mate flag the account's variables never stated from the service itself, once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage(clock);
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
            name: "project-1",
            status: "ACTIVE",
            tagList: ["mate"],
          });
          const client = new ZeropsApiClient({ fetch: rest.fetch });
          client.restoreSession(rest.issueSession(account.accountId));
          let ownReads = 0;
          const datastream = makeFakeDatastream(rest, {
            variables: () => [
              {
                id: "variable-1",
                serviceStackId: "service-1",
                projectId: "project-1",
                key: "ZCP_MATE_ENABLED",
                content: "1",
              },
            ],
          });
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: {
                ...datastream.adapter,
                cells: {
                  readProjectPublicAccess: () => Effect.never,
                  readOrganizationLocations: () => Effect.succeed([]),
                  readServiceAuthorizedAgents: () => Effect.succeed([]),
                  readOrganizationIntegrationTokens: () => Effect.succeed([]),
                  readOrganizationMembers: () => Effect.succeed([]),
                  readServiceMateFlag: () =>
                    Effect.sync(() => {
                      ownReads += 1;
                      return { enabled: true };
                    }),
                },
              },
              atomRegistry: registry,
              makeOpaqueId: (() => {
                let next = 0;
                return () => `opaque-${++next}`;
              })(),
            });
            return yield* makeAccountRuntime({
              data,
              verifier: makeRestAccessVerifier({
                client,
                account,
                concurrency: policy.roundProjectConcurrency,
                onUser: () => undefined,
              }),
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          // The account's variables never answer: the flag cannot be stated from them.
          datastream.holdRegistrations();
          yield* clock.advance(SECOND);
          yield* settle;
          yield* settle;
          const service = {
            kind: "service" as const,
            project: {
              kind: "project" as const,
              organization,
              projectId: ZeropsProjectId.make("project-1"),
            },
            serviceId: ZeropsServiceId.make("service-1"),
          };

          yield* built.data.acquire({
            kind: "project-variables",
            project: service.project,
            serviceIds: [service.serviceId],
          });
          yield* clock.advance(SECOND);
          yield* settle;
          const flag = yield* Effect.promise(() =>
            readServiceMateFlag(built.data, registry, service, undefined, 50),
          );

          expect(flag).toBe(true);
          expect(ownReads).toBe(1);
        }),
      ),
  );

  it.effect(
    "navigation discovers a new project without verifying access or reading its services",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const registry = AtomRegistry.make();
          const page = yield* makePage(clock);
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
            name: "project-1",
            status: "ACTIVE",
          });
          const client = new ZeropsApiClient({ fetch: rest.fetch });
          client.restoreSession(rest.issueSession(account.accountId));
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: makeFakeDatastream(rest).adapter,
              atomRegistry: registry,
              makeOpaqueId: (() => {
                let next = 0;
                return () => `opaque-${++next}`;
              })(),
            });
            return yield* makeAccountRuntime({
              data,
              verifier: makeRestAccessVerifier({
                client,
                account,
                concurrency: policy.roundProjectConcurrency,
                onUser: () => undefined,
              }),
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
          }).pipe(Effect.provideService(Clock.Clock, clock));
          yield* Effect.addFinalizer(() => built.close("application-close"));
          const data = built.data;
          const rounds = () => rest.requests().filter(({ route }) => route === "GET /user/info");
          const verifiedProjects = () => {
            const phase = registry.get(data.access.view).machine.phase;
            return phase.phase === "granted" ? [...phase.evidence.projects.keys()].toSorted() : [];
          };
          const observing = () =>
            Effect.map(
              data.state,
              (state) =>
                [...state.interests.values()].filter(
                  ({ interest }) => interest.status === "observing",
                ).length,
            );
          const unsubscribe = registry.subscribe(mateListingsAtom(data), () => undefined);
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
          yield* clock.advance(SECOND);
          yield* settle;
          yield* settle;
          expect(verifiedProjects()).toEqual([]);
          expect(yield* observing()).toBe(1);
          const roundsBefore = rounds().length;

          const streamed = () =>
            Effect.map(data.state, (state) =>
              [...state.interests.values()]
                .filter(({ interest }) => interest.status === "observing")
                .map(({ descriptor }) => descriptor.kind)
                .filter((kind) => kind === "project-variables")
                .toSorted(),
            );
          expect(yield* streamed()).toEqual([]);

          // Someone else adds the organization's first Mate: its project appears in the list.
          const mate = {
            id: "project-2",
            clientId: organization.organizationId,
            name: "project-2",
            status: "ACTIVE",
          } as const;
          rest.addProject({ ...mate, tagList: ["mate"] });
          yield* built.invalidations
            .invalidate({ topic: "inventory", organization })
            .pipe(Effect.provideService(Clock.Clock, clock));
          yield* clock.advance(SECOND);
          yield* settle;
          yield* settle;

          expect(verifiedProjects()).toEqual([]);
          // Its services are read: the organization's inventory and both projects'; and, with a
          // Mate there now, what its services run and their Mate flags are streamed.
          expect(yield* observing()).toBe(1);
          expect(yield* streamed()).toEqual([]);
          expect(rounds()).toHaveLength(roundsBefore);

          // The organization's last Mate stops being one: nothing reads the streams, so they go.
          rest.addProject({ ...mate, tagList: [] });
          yield* built.invalidations
            .invalidate({ topic: "inventory", organization })
            .pipe(Effect.provideService(Clock.Clock, clock));
          yield* clock.advance(SECOND);
          yield* settle;
          yield* settle;
          expect(yield* streamed()).toEqual([]);
          expect(yield* observing()).toBe(1);
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
          const page = yield* makePage(clock);
          const grant = heldVerifier();
          const built = yield* Effect.gen(function* () {
            const data = yield* makeZeropsDataRuntime({
              random: () => 0,
              scope: scope(),
              adapter: inertAdapter,
              atomRegistry: registry,
              makeOpaqueId: () => "opaque",
            });
            return yield* makeAccountRuntime({
              data,
              verifier: grant.verifier,
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
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

  it.effect("an account runtime whose grant cannot start fails and leaves nothing running", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const registry = AtomRegistry.make();
        const page = yield* makePage(clock);
        const grant = heldVerifier();
        const exit = yield* Effect.gen(function* () {
          const data = yield* makeZeropsDataRuntime({
            random: () => 0,
            scope: scope(),
            adapter: inertAdapter,
            atomRegistry: registry,
            makeOpaqueId: () => "opaque",
          });
          yield* Effect.addFinalizer(() => data.shutdown("application-close"));
          // Something else started the epoch's grant first.
          yield* data.access.start({ verifier: grant.verifier, hidden: false, online: true });
          return yield* makeAccountRuntime({
            data,
            verifier: grant.verifier,
            signals: page.signals,
            atomRegistry: registry,
            environments: inertEnvironments(clock),
          })
            .pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            )
            .pipe(Effect.exit);
        }).pipe(Effect.provideService(Clock.Clock, clock));
        yield* settle;

        expect(Exit.isFailure(exit)).toBe(true);
        expect(page.listening()).toBe(0);
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
          const page = yield* makePage(clock);
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
              random: () => 0,
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
              signals: page.signals,
              atomRegistry: registry,
              environments: inertEnvironments(clock),
            }).pipe(
              Effect.tap((runtime) =>
                Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
              ),
            );
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
            return page.hidden() ? Math.ceil(due / MINUTE) * MINUTE : due;
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
          yield* data.acquire({ kind: "project-inventory", project: project() });
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
          expect(yield* interest()).toBe("observing");
          // Renewed on schedule while hidden: at +12, +24 and +36 min.
          expect(rest.requests().filter(({ route }) => route === "GET /user/info").length).toBe(4);
        }),
      ),
  );
});

describe("the post-grant stage's Mate environments", () => {
  /** An account runtime over a platform holding these Mates' projects, with no React mounted. */
  const openAccount = Effect.fnUntraced(function* (
    remembered: ReadonlyArray<RegistrationRecord>,
    mates: ReadonlyArray<Mate> = [A_MATE],
    adapter: ZeropsDataAdapter = platformAdapter(mates),
    /** The Mates the grant admits; the organization may list more. */
    admitted: ReadonlyArray<Mate> = mates,
    /** Ports the case adds to the rig's. */
    extra: Partial<AccountEnvironmentPorts> = {},
    /** The data runtime's budgets the case narrows. */
    policy = makeZeropsDataPolicy(),
    /** The roster is not read until the case releases it. */
    rosterHeld = false,
    /** The services listing does not answer until the case releases it. */
    servicesHeld = false,
  ) {
    const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
    const registry = AtomRegistry.make();
    const page = yield* makePage(clock);
    const grant = heldVerifier(
      admitted.map(({ projectId }) => project(projectId)),
      mates
        .filter((listed) => !admitted.includes(listed))
        .map(({ projectId }) => project(projectId)),
    );
    const rig = environmentRig(clock, remembered);
    const built = yield* Effect.gen(function* () {
      const data = yield* makeZeropsDataRuntime({
        random: () => 0,
        scope: scope(),
        adapter,
        atomRegistry: registry,
        policy,
        makeOpaqueId: (() => {
          let next = 0;
          return () => `opaque-${++next}`;
        })(),
      });
      return yield* makeAccountRuntime({
        data,
        verifier: grant.verifier,
        signals: page.signals,
        atomRegistry: registry,
        environments: { ...rig.ports, ...extra },
      }).pipe(
        Effect.tap((runtime) =>
          Effect.sync(() => runtime.selectOrganization(organization.organizationId)),
        ),
      );
    }).pipe(Effect.provideService(Clock.Clock, clock));
    yield* Effect.addFinalizer(() => built.close("application-close"));
    // The account's store, its organization's roster read: the Mates' projects.
    const store = makeAccountStore(registry);
    let rosterReleased = false;
    let servicesReleased = false;
    /** The organization's services listing answers: after the roster, once the grant answered. */
    const releaseServices = () => {
      if (servicesReleased || !rosterReleased || servicesHeld) return;
      servicesReleased = true;
      liveServices(
        organization.organizationId,
        mates.map(({ service }) => service),
      ).forEach(store.dispatch);
    };
    const releaseRoster = () => {
      rosterReleased = true;
      liveProjects(
        organization.organizationId,
        mates.map(({ project }) => project),
      ).forEach(store.dispatch);
      if (grant.rounds() > 0 && answeredOnce) releaseServices();
    };
    let answeredOnce = false;
    if (!rosterHeld) releaseRoster();
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId: organization.organizationId,
      demandDetail: () => () => undefined,
    });
    // As a page loads: the services listing lands once the account's first grant is in.
    const answered = {
      ...grant,
      answer: (failure: GrantFailure | null = null) =>
        grant.answer(failure).pipe(
          Effect.andThen(
            Effect.sync(() => {
              answeredOnce = true;
              releaseServices();
            }),
          ),
          Effect.andThen(settle),
        ),
    };
    return {
      clock,
      page,
      grant: answered,
      rig,
      built,
      registry,
      store,
      releaseRoster,
      /** The held services listing answers now. */
      releaseHeldServices: () => {
        servicesHeld = false;
        answeredOnce = true;
        releaseServices();
      },
    };
  });

  /** `openAccount` past the epoch's first grant, with its post-grant stage. */
  const granted = Effect.fnUntraced(function* (
    remembered: ReadonlyArray<RegistrationRecord>,
    mates: ReadonlyArray<Mate> = [A_MATE],
    adapter: ZeropsDataAdapter = platformAdapter(mates),
    admitted: ReadonlyArray<Mate> = mates,
    extra: Partial<AccountEnvironmentPorts> = {},
    rosterHeld = false,
    servicesHeld = false,
  ) {
    const opened = yield* openAccount(
      remembered,
      mates,
      adapter,
      admitted,
      extra,
      undefined,
      rosterHeld,
      servicesHeld,
    );
    yield* opened.grant.answer();
    yield* opened.clock.advance(SECOND);
    yield* settle;
    const stage = yield* opened.built.postGrant;
    stage.environments.setActiveOrganization(organization.organizationId);
    // These stage tests start with explicit, already loaded detail; cold demand is covered above.
    for (const mate of mates)
      yield* opened.built.data.acquire({
        kind: "project-inventory",
        project: project(mate.projectId),
      });
    yield* settle;
    return { ...opened, environments: stage.environments };
  });

  it.effect("a refused cold route read ends visibly and waits for manual Again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openAccount(
          [],
          [A_MATE],
          undefined,
          undefined,
          {
            hqIndex: {
              projectOf: (id) => (id === ENV_A ? A_MATE.projectId : null),
              subscribe: () => () => undefined,
            },
          },
          makeZeropsDataPolicy({ activeInterestsPerAccount: 16 }),
        );
        const background = yield* Scope.make();
        yield* opened.built.data.acquire({ kind: "organization-inventory", organization });
        for (let i = 0; i < 15; i++) {
          yield* opened.built.data
            .acquire({ kind: "project-topology", project: project(`background-${i}`) })
            .pipe(Effect.provideService(Scope.Scope, background));
        }
        yield* opened.grant.answer();
        yield* settle;
        const { environments } = yield* opened.built.postGrant;
        environments.setActiveOrganization(organization.organizationId);
        environments.setRoute(ENV_A);
        yield* settle;
        const failure = environments.detailFailure(A_MATE.projectId);
        expect(failure).toMatchObject({ reason: "account-capacity" });
        yield* opened.clock.advance(10 * SECOND);
        yield* settle;
        expect(environments.detailFailure(A_MATE.projectId)).toBe(failure);
        yield* Scope.close(background, Exit.void);
        yield* settle;
        expect(environments.detailFailure(A_MATE.projectId)).toBe(failure);
        environments.retryDetail(A_MATE.projectId);
        yield* settle;
        expect(environments.detailFailure(A_MATE.projectId)).toBeNull();
        expect(
          [...(yield* opened.built.data.state).interests.values()].some(
            ({ descriptor }) =>
              descriptor.kind === "project-inventory" &&
              descriptor.project.projectId === A_MATE.projectId,
          ),
        ).toBe(true);
        environments.setRoute(null);
        yield* settle;
        expect([...environments.detailProjects()]).toEqual([]);
        expect(environments.detailFailure(A_MATE.projectId)).toBeNull();
      }),
    ),
  );

  it.effect.each(["org-other", null])(
    "releases opened detail when active organization becomes %s",
    (organizationId) =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* openAccount([REMEMBERED_A]);
          yield* opened.grant.answer();
          const stage = yield* opened.built.postGrant;
          stage.environments.setActiveOrganization(organization.organizationId);
          stage.environments.setOnScreen(A_MATE.projectId);
          yield* settle;
          const detail = () =>
            [...opened.registry.get(opened.built.data.stateAtom).interests.values()].filter(
              ({ descriptor }) => "project" in descriptor,
            );
          expect(detail().some(({ descriptor }) => descriptor.kind === "project-inventory")).toBe(
            true,
          );
          stage.environments.setActiveOrganization(organizationId);
          yield* settle;
          expect(detail()).toEqual([]);
        }),
      ),
  );

  /** The descriptor a Mate serving this environment answers with. */
  const describing = (environmentId: EnvironmentId): DescriptorFacts => ({
    environmentId,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  });

  /** Answers the one descriptor probe of a remembered Mate still out: it serves `environmentId`. */
  const answerDescriptor = (rig: ReturnType<typeof environmentRig>, environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      const probe = rig.descriptors.at(-1);
      if (probe === undefined) throw new Error("No descriptor probe is in flight.");
      probe.answer(describing(environmentId));
      yield* settle;
    });

  // A9 (krok-a-hub §3): a Mate is connected while it holds a lease — the route's, the one left last,
  // an action's, a Connect's. A load connected every Mate this browser remembered and every ready
  // Mate of the open organization: the 20+-Mate account opened twenty-odd sockets per tab.
  const B_MATE = mate("b");
  const ENV_B = EnvironmentId.make("env-b");
  const REMEMBERED_B: RegistrationRecord = {
    targetKey: B_MATE.key,
    environmentId: ENV_B,
    origin: B_MATE.origin,
    projectRef: { projectId: B_MATE.projectId, orgId: "org-1" },
    name: "shop b",
  };
  const registered = (...environmentIds: ReadonlyArray<EnvironmentId>) =>
    environmentIds.map((environmentId) => ({ environmentId, origin: null }));

  it.effect("a load connects only the route's Mate", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, grant, rig, built } = yield* openAccount(
          [REMEMBERED_A, REMEMBERED_B],
          [A_MATE, B_MATE],
        );
        // A reload on B's conversation: the route is the address, before a React effect names it.
        rig.openOn(ENV_B);
        yield* grant.answer();
        yield* clock.advance(SECOND);
        yield* settle;
        yield* built.postGrant;
        rig.catalog().environments(registered(ENV_A, ENV_B));
        yield* settle;

        expect(rig.descriptors.map(({ input }) => input)).toEqual([B_MATE.origin]);
        yield* answerDescriptor(rig, ENV_B);
        expect(rig.exchanges.map(({ input }) => input.key)).toEqual([B_MATE.key]);
        expect(rig.parked()).toEqual([ENV_A]);
        expect(rig.unparked()).toEqual([ENV_B]);
        expect(rig.preferred).toEqual([ENV_B]);
      }),
    ),
  );

  it.effect("a remembered Mate stays parked until it is opened", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([REMEMBERED_A]);
        rig.catalog().environments(registered(ENV_A));
        yield* settle;
        expect(rig.descriptors).toEqual([]);
        expect(rig.exchanges).toEqual([]);
        expect(rig.parked()).toEqual([ENV_A]);

        environments.setRoute(ENV_A);
        yield* settle;
        expect(rig.exchanges.map(({ input }) => input.key)).toEqual([MATE]);
        expect(rig.unparked()).toEqual([ENV_A]);
      }),
    ),
  );

  it.effect("the Mate left last stays connected for five minutes, then is parked", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted(
          [REMEMBERED_A, REMEMBERED_B],
          [A_MATE, B_MATE],
        );
        rig.catalog().environments(registered(ENV_A, ENV_B));
        environments.setRoute(ENV_A);
        yield* settle;
        environments.setRoute(ENV_B);
        yield* settle;
        expect(rig.unparked()).toEqual([ENV_A, ENV_B]);

        rig.fire(5 * MINUTE);
        yield* settle;
        expect(rig.parked()).toEqual([ENV_A]);
        expect(rig.unparked()).toEqual([ENV_B]);
      }),
    ),
  );

  // A park closes a link nothing holds: it is no drop, so the platform is asked nothing.
  it.effect("a park of a connected Mate reads no inventory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, rig, built, environments } = yield* granted([REMEMBERED_A]);
        rig.catalog().environments(registered(ENV_A));
        environments.setRoute(ENV_A);
        yield* settle;
        rig.exchanges[0]!.answer(admitted(ENV_A, async () => ({ ok: true })));
        yield* settle;
        rig.catalog().link(ENV_A, { phase: "connected" });
        yield* settle;
        const heard: Array<Invalidation> = [];
        const subscription = yield* built.invalidations.subscribe;
        yield* Stream.fromSubscription(subscription).pipe(
          Stream.runForEach((invalidation) => Effect.sync(() => heard.push(invalidation))),
          Effect.forkScoped,
        );

        environments.setRoute(null);
        yield* settle;
        rig.fire(5 * MINUTE);
        yield* settle;
        expect(rig.parked()).toEqual([ENV_A]);
        // The registry closes the parked link: its supervisor publishes it as idle.
        rig.catalog().link(ENV_A, { phase: "idle" });
        yield* settle;
        yield* clock.advance(250);
        yield* settle;

        expect(heard).toEqual([]);
        expect(environments.machines().get(MATE)?.linkLostAt).toBeNull();
      }),
    ),
  );

  // A coming page left open on a Mate whose door fails minted a throwaway a minute as the route
  // (review, 2026-10-03): the Mate on screen is one the person asked for, capped as no route is.
  // B6: whether a Mate's address is being turned on is its project's processes' word, so its
  // history is held for as long as its container is ACTIVE without one — not for one that has one.
  it.effect.each([
    { case: "its address off: its project's history is held", address: false, read: true },
    { case: "its address on: nothing more is read", address: true, read: false },
  ])("a Mate ACTIVE, $case", ({ address, read }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const lacking = { ...A_MATE, service: { ...A_MATE.service, subdomainAccess: address } };
        const opened = yield* granted([], [lacking]);
        // The account's store, as far as the wiring holds it: whose newest history it holds.
        const held = new Set<string>();
        opened.registry.set(accountReadsAtom, {
          data: opened.store.data,
          orgId: organization.organizationId,
          demandDetail: ({ ownerId }) => {
            held.add(ownerId);
            return () => void held.delete(ownerId);
          },
        });
        yield* settle;
        expect(held.has(A_MATE.projectId)).toBe(read);
        // Only the organization in view is read for.
        opened.environments.setActiveOrganization("org-other");
        yield* settle;
        expect(held.has(A_MATE.projectId)).toBe(false);
      }),
    ),
  );

  it.effect("the Mate on screen is asked for, and capped as no route is", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([]);
        environments.setOnScreen(A_MATE.projectId);
        yield* settle;

        expect(rig.exchanges.map(({ input: { key, asked } }) => ({ key, asked }))).toEqual([
          { key: MATE, asked: true },
        ]);
        expect(environments.machines().get(MATE)?.guards).toMatchObject({
          want: true,
          routeTarget: false,
        });
      }),
    ),
  );

  // The close-off gate (restores 0.12.3's closeOffGate inside the lease model): a Mate whose
  // container carries the press's marker is let in only once HQ says its project is closed off.
  describe("the close-off gate", () => {
    /** The press's marker on Mate A's container, as the account's streamed variables say it. */
    const MARKER = [
      {
        id: "variable-marker",
        serviceStackId: A_MATE.service.id,
        projectId: A_MATE.projectId,
        key: "MATE_SETUP_RUNTIMES",
        content: "services: []",
      },
    ];
    /** HQ's close-off word, as a test moves it. */
    const hqWord = (initial: CloseOffWord | null) => {
      let word = initial;
      const heard = new Set<() => void>();
      return {
        port: {
          read: () => word,
          subscribe: (listener: () => void) => {
            heard.add(listener);
            return () => heard.delete(listener);
          },
        },
        say: (next: CloseOffWord | null) => {
          word = next;
          for (const listener of heard) listener();
        },
      };
    };
    /** HQ's record of Mate A: closed off, or not. */
    const said = (closed: ReadonlyArray<string>, current = true): CloseOffWord => ({
      organizationId: organization.organizationId,
      current,
      closed: new Set(closed),
      open: new Set(closed.includes(A_MATE.projectId) ? [] : [A_MATE.projectId]),
    });
    /** This browser's own knowledge of projects whose close-off has not happened. */
    const pendingHere = (projectIds: ReadonlyArray<string>) => ({
      read: () => new Set(projectIds),
      subscribe: () => () => undefined,
    });
    const madeAt = (created: string) => ({
      ...A_MATE,
      service: { ...A_MATE.service, created },
    });
    const exchangesOf = (rig: {
      readonly exchanges: ReadonlyArray<{ readonly input: { readonly key: string } }>;
    }) => rig.exchanges.filter(({ input }) => input.key === MATE).length;

    it.effect(
      "holds a marked Mate HQ says is not closed off, on screen too, and lets it in once it is",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const word = hqWord(said([]));
            const { rig, environments } = yield* granted(
              [],
              [A_MATE],
              platformAdapter([A_MATE], MARKER),
              [A_MATE],
              { closeOff: word.port },
            );
            environments.setOnScreen(A_MATE.projectId);
            yield* settle;
            expect(environments.closeOffHolds().get(A_MATE.projectId)).toBe("open");
            expect(environments.machines().get(MATE)?.guards.want).toBe(false);
            expect(exchangesOf(rig)).toBe(0);

            word.say(said([A_MATE.projectId]));
            yield* settle;
            expect(environments.closeOffHolds().size).toBe(0);
            expect(environments.machines().get(MATE)?.guards.want).toBe(true);
            expect(exchangesOf(rig)).toBe(1);
          }),
        ),
    );

    it.effect("lets in a Mate whose container carries no press marker", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const word = hqWord(said([]));
          const { rig, environments } = yield* granted(
            [],
            [A_MATE],
            platformAdapter([A_MATE]),
            [A_MATE],
            {
              closeOff: word.port,
            },
          );
          environments.setOnScreen(A_MATE.projectId);
          yield* settle;
          expect(environments.closeOffHolds().size).toBe(0);
          expect(exchangesOf(rig)).toBe(1);
        }),
      ),
    );

    // Security review 4: HQ saying nothing is no reason to hold — only this browser's own
    // knowledge that its close-off has not happened is, and then it says why.
    it.effect(
      "where HQ says nothing, holds a marked Mate only on this browser's own evidence",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fresh = madeAt("2026-09-23T09:50:00.000Z");
            const unheld = yield* granted([], [fresh], platformAdapter([fresh], MARKER), [fresh], {
              closeOff: hqWord(null).port,
            });
            unheld.environments.setOnScreen(fresh.projectId);
            yield* settle;
            expect(unheld.environments.closeOffHolds().size).toBe(0);
            expect(exchangesOf(unheld.rig)).toBe(1);
          }),
        ),
    );

    it.effect(
      "holds a Mate whose press here stopped before its close-off, saying it waits on HQ",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { rig, environments } = yield* granted(
              [],
              [A_MATE],
              platformAdapter([A_MATE], MARKER),
              [A_MATE],
              { closeOff: hqWord(null).port, closeOffPending: pendingHere([A_MATE.projectId]) },
            );
            environments.setOnScreen(A_MATE.projectId);
            yield* settle;
            expect(environments.closeOffHolds().get(A_MATE.projectId)).toBe("awaiting-hq");
            expect(exchangesOf(rig)).toBe(0);
          }),
        ),
    );

    // Security review 10: HQ's record saying it is not closed off holds the Mate while its marker
    // is read, before it could connect for a moment.
    it.effect("holds a Mate HQ says is not closed off while its marker is read", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const old = madeAt("2026-09-23T07:00:00.000Z");
          const { rig, environments } = yield* granted(
            [],
            [old],
            platformAdapter([old], "never"),
            [old],
            { closeOff: hqWord(said([])).port },
          );
          environments.setOnScreen(old.projectId);
          yield* settle;
          expect(environments.closeOffHolds().get(old.projectId)).toBe("checking");
          expect(exchangesOf(rig)).toBe(0);
        }),
      ),
    );

    // HQ's word alone says closed off (ADR 0002): 0.12.3's close-off tag on the project is no word.
    it.effect("holds a Mate HQ says is not closed off, whatever tag its project carries", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const tagged = {
            ...A_MATE,
            project: { ...A_MATE.project, tagList: ["mate", "mate:closed-off"] },
          };
          const { rig, environments } = yield* granted(
            [],
            [tagged],
            platformAdapter([tagged], MARKER),
            [tagged],
            { closeOff: hqWord(said([])).port },
          );
          environments.setOnScreen(tagged.projectId);
          yield* settle;
          expect(environments.closeOffHolds().get(tagged.projectId)).toBe("open");
          expect(exchangesOf(rig)).toBe(0);
        }),
      ),
    );
  });

  it.effect(
    "deleting a Mate overrides every lease, parks its socket, and restores demand on failure",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { rig, environments } = yield* granted(
            [REMEMBERED_A, REMEMBERED_B],
            [A_MATE, B_MATE],
          );
          rig.catalog().environments(registered(ENV_A, ENV_B));
          environments.setRoute(ENV_A);
          environments.setOnScreen(A_MATE.projectId);
          const release = environments.hold(ENV_A);
          yield* settle;
          rig.exchanges[0]!.answer(admitted(ENV_A, async () => ({ ok: true })));
          yield* settle;
          rig.catalog().link(ENV_A, { phase: "connected" });
          yield* settle;

          environments.setDeleting(A_MATE.projectId, true);
          yield* settle;
          expect(environments.machines().get(MATE)?.guards.want).toBe(false);
          expect(rig.parked()).toContain(ENV_A);
          expect(rig.records()).toContainEqual(REMEMBERED_A);
          expect(rig.removed).toEqual([]);
          const before = {
            exchanges: rig.exchanges.filter(({ input }) => input.key === MATE).length,
            descriptors: rig.descriptors.length,
            probes: rig.probes.filter(({ input }) => input === MATE_ORIGIN).length,
          };
          rig.catalog().link(ENV_A, { phase: "blocked", reason: "configuration" });
          environments.setRoute(ENV_B);
          environments.setRoute(ENV_A);
          environments.setOnScreen(A_MATE.projectId);
          yield* settle;
          rig.fire(5_000);
          rig.fire(11_000);
          yield* settle;
          expect(rig.exchanges.filter(({ input }) => input.key === MATE)).toHaveLength(
            before.exchanges,
          );
          expect(rig.descriptors).toHaveLength(before.descriptors);
          expect(rig.probes.filter(({ input }) => input === MATE_ORIGIN)).toHaveLength(
            before.probes,
          );
          expect(environments.machines().get(MATE)?.guards.want).toBe(false);

          environments.setDeleting(A_MATE.projectId, false);
          yield* settle;
          expect(environments.machines().get(MATE)?.guards.want).toBe(true);
          expect(rig.unparked()).toContain(ENV_A);
          expect(rig.descriptors.length).toBeGreaterThan(before.descriptors);
          release();
        }),
      ),
  );

  it.effect(
    "deleting a Mate cancels its pending exchange and leaves another Mate's demand alone",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { rig, environments } = yield* granted(
            [REMEMBERED_A, REMEMBERED_B],
            [A_MATE, B_MATE],
          );
          environments.setRoute(ENV_A);
          yield* settle;
          environments.setDeleting(A_MATE.projectId, true);
          yield* settle;
          expect(rig.exchanges[0]!.signal.aborted).toBe(true);
          expect(environments.machines().get(MATE)?.guards.want).toBe(false);
          environments.setOnScreen(B_MATE.projectId);
          yield* settle;
          expect(environments.machines().get(B_MATE.key)?.guards.want).toBe(true);
          expect(rig.exchanges.map(({ input }) => input.key)).toEqual([MATE, B_MATE.key]);
          environments.setDeleting(A_MATE.projectId, false);
          yield* settle;
          expect(rig.exchanges.map(({ input }) => input.key)).toEqual([MATE, B_MATE.key, MATE]);
        }),
      ),
  );

  it.effect("an action holds a parked Mate connected until it answers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([REMEMBERED_A]);
        rig.catalog().environments(registered(ENV_A));
        yield* settle;
        expect(rig.parked()).toEqual([ENV_A]);

        const release = environments.hold(ENV_A);
        yield* settle;
        expect(rig.exchanges.map(({ input: { key, reason } }) => ({ key, reason }))).toEqual([
          { key: MATE, reason: "user" },
        ]);
        expect(rig.unparked()).toEqual([ENV_A]);

        release();
        release();
        yield* settle;
        expect(rig.parked()).toEqual([ENV_A]);
      }),
    ),
  );

  it.effect("no exchange before the first grant (I10, AL-04), with no React", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, grant, rig, built } = yield* openAccount([REMEMBERED_A]);
        rig.openOn(ENV_A);
        const postGrant = yield* Effect.forkChild(built.postGrant);
        yield* clock.advance(SECOND);
        yield* settle;

        // The remembered Mate on the route is present on the platform, and the first round is
        // still out.
        expect(grant.rounds()).toBe(1);
        expect(postGrant.pollUnsafe()).toBeUndefined();
        expect(rig.exchanges).toEqual([]);

        yield* grant.answer();
        yield* clock.advance(SECOND);
        yield* settle;

        const stage = yield* Fiber.join(postGrant);
        // Remembered, it is looked for where its record kept it before anything else (A16).
        expect(rig.descriptors.map(({ input }) => input)).toEqual([MATE_ORIGIN]);
        yield* answerDescriptor(rig, ENV_A);
        expect(
          rig.exchanges.map(({ input: { key, origin, projectId, organizationId } }) => ({
            key,
            origin,
            projectId,
            organizationId,
          })),
        ).toEqual([
          { key: MATE, origin: MATE_ORIGIN, projectId: "project-a", organizationId: "org-1" },
        ]);
        expect(stage.environments.machines().get(MATE)?.credential.kind).toBe("exchanging");
      }),
    ),
  );

  it.effect("a stop's services follow its listing, and opened detail adds its topology", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, built, registry } = yield* granted([]);
        const stage = yield* built.postGrant;
        const { stops } = stage;
        /** Whether a lease holds project A's services and running processes: opened detail only. */
        const followsTopology = built.data.state.pipe(
          Effect.map((state) =>
            [...state.interests.values()].some(
              ({ leases, descriptor }) =>
                leases > 0 &&
                descriptor.kind === "project-topology" &&
                descriptor.project.projectId === A_MATE.projectId,
            ),
          ),
        );
        // The Mate's own container is the one service there: a stop that runs nothing.
        const projectA = project(A_MATE.projectId);
        const release = stops.demand(projectA);
        yield* clock.advance(SECOND);
        yield* settle;
        expect(registry.get(stops.services(projectA))).toMatchObject({
          state: "known",
          value: [],
        });
        // The account builds no Gitea sessions: the stage holds no forge on any host.
        expect(stage).not.toHaveProperty("forge");
        // A shown (summary) stop demands services alone; processes wait for opened detail (R7).
        expect(yield* followsTopology).toBe(false);
        const releaseDetail = stops.demand(projectA, "detail");
        yield* clock.advance(SECOND);
        yield* settle;
        expect(yield* followsTopology).toBe(true);

        releaseDetail();
        yield* clock.advance(SECOND);
        yield* settle;
        expect(yield* followsTopology).toBe(false);
        release();
      }),
    ),
  );

  it.effect("a sign-out disposes every environment machine", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, page, rig, built, environments } = yield* granted([REMEMBERED_A]);
        const connect = environments.connect(MATE, "user");
        yield* settle;
        expect(rig.exchanges).toHaveLength(1);
        expect(rig.probes.length).toBeGreaterThan(0);
        expect(rig.listening).toEqual({ records: 1, catalog: 1 });
        let heard = 0;
        environments.subscribe(() => {
          heard += 1;
        });

        yield* built.close("logout");

        // Every exchange and probe in flight is aborted, and a waiting Connect answers Closed.
        expect(rig.exchanges.map(({ signal }) => signal.aborted)).toEqual([true]);
        expect(rig.probes.every(({ signal }) => signal.aborted)).toBe(true);
        expect(yield* Effect.promise(() => connect)).toEqual({ _tag: "Closed" });
        // The stage hears nothing more: no port, and nothing the tab does, reaches a machine.
        expect(rig.listening).toEqual({ records: 0, catalog: 0 });
        yield* page.emit({ type: "visibility", hidden: true });
        yield* clock.advance(MINUTE);
        yield* page.emit({ type: "visibility", hidden: false });
        yield* settle;
        expect(rig.exchanges).toHaveLength(1);
        expect(heard).toBe(0);
      }),
    ),
  );

  it.effect.each([
    {
      name: "the registry takes it: its target is remembered",
      installed: true,
      records: [REMEMBERED_A],
    },
    {
      name: "the registry refuses it: nothing is written",
      installed: false,
      records: [],
    },
  ])("an installed credential writes its target's record (H12): $name", (row) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([]);
        const connect = environments.connect(MATE, "user");
        yield* settle;

        rig.exchanges[0]!.answer(admitted(ENV_A, async () => ({ ok: row.installed })));
        yield* settle;

        expect(rig.records()).toEqual(row.records);
        if (row.installed) {
          expect(yield* Effect.promise(() => connect)).toEqual({
            _tag: "Connected",
            environmentId: ENV_A,
          });
        }
      }),
    ),
  );

  const ELSEWHERE = EnvironmentId.make("env-elsewhere");
  it.effect.each([
    {
      name: "one nothing remembers is released",
      remembered: [],
      install: null,
      registered: [{ environmentId: ELSEWHERE, origin: "https://zcp-z-8080.prg1.zerops.app" }],
      whileInstalling: [ELSEWHERE],
      removed: [ELSEWHERE],
    },
    {
      name: "one published while its install writes the record is kept",
      remembered: [],
      install: { environmentId: ENV_A, ok: true },
      registered: [{ environmentId: ENV_A, origin: MATE_ORIGIN }],
      whileInstalling: [],
      removed: [],
    },
    {
      name: "one whose install fails is released when it ends",
      remembered: [],
      install: { environmentId: ENV_A, ok: false },
      registered: [{ environmentId: ENV_A, origin: MATE_ORIGIN }],
      whileInstalling: [],
      removed: [ENV_A],
    },
    {
      name: "an older one at the same Mate is released once its replacement is remembered",
      remembered: [REMEMBERED_A],
      install: { environmentId: ENV_B, ok: true },
      registered: [
        { environmentId: ENV_A, origin: MATE_ORIGIN },
        { environmentId: ENV_B, origin: MATE_ORIGIN },
      ],
      whileInstalling: [],
      removed: [ENV_A],
    },
  ])("a registration: $name", (row) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted(row.remembered);
        let finish: (ok: boolean) => void = () => undefined;
        if (row.install !== null) {
          void environments.connect(MATE, "user");
          yield* settle;
          rig.exchanges[0]!.answer(
            admitted(
              row.install.environmentId,
              () =>
                new Promise((resolve) => {
                  finish = (ok) => resolve({ ok });
                }),
            ),
          );
          yield* settle;
        }

        // The catalog publishes a registration before its install writes the record.
        rig.catalog().environments(row.registered);
        yield* settle;
        expect(rig.removed).toEqual(row.whileInstalling);

        if (row.install !== null) finish(row.install.ok);
        yield* settle;
        expect([...new Set(rig.removed)]).toEqual(row.removed);
      }),
    ),
  );

  // A registration a machine holds is the Mate's live link. Records are personal context: a write
  // that does not land — a full storage, which the web's port swallows — or another tab's write
  // made without it says nothing about the link, and releasing it left a Mate this tab still held
  // unregistered, so no door could open it, with nothing to exchange it again.
  it.effect.each([
    { name: "its record's write did not land", lands: false, elsewhere: null },
    { name: "another tab stored the records without it", lands: true, elsewhere: [] },
  ])("a registration its machine holds is kept though the records lack it: $name", (row) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([]);
        rig.landWrites(row.lands);
        void environments.connect(MATE, "user");
        yield* settle;
        rig.exchanges[0]!.answer(
          admitted(ENV_A, async () => {
            // The registry takes it: the catalog publishes it before the record is written.
            rig.catalog().environments([{ environmentId: ENV_A, origin: MATE_ORIGIN }]);
            return { ok: true };
          }),
        );
        yield* settle;
        if (row.elsewhere !== null) rig.storeElsewhere(row.elsewhere, true);
        yield* settle;

        expect(environments.machines().get(MATE)?.credential).toMatchObject({
          kind: "held",
          environmentId: ENV_A,
          installed: true,
        });
        expect(rig.records()).toEqual([]);
        expect(rig.removed).toEqual([]);
      }),
    ),
  );

  // Until a project's services are read — at every load, and again whenever its inventory lease is
  // released, which drops its services query — the listing's row for its Mate stands for the whole
  // project (`projectCandidates`): its key is the project's id, and the target that key names is
  // nobody's. The Mate is still there, and its machine still holds it.
  it.effect(
    "a Mate's row read before its project's services names the target its machine holds",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { rig, built, registry, environments } = yield* granted(
            [REMEMBERED_A],
            [A_MATE],
            undefined,
            undefined,
            undefined,
            false,
            true,
          );
          // Opened, a remembered Mate is exchanged where its record kept it (A16).
          environments.setRoute(ENV_A);
          yield* settle;
          yield* answerDescriptor(rig, ENV_A);
          rig.exchanges[0]!.answer(admitted(ENV_A, async () => ({ ok: true })));
          yield* settle;

          const rows = registry
            .get(mateListingsAtom(built.data))
            .flatMap(({ listing }) => heldCandidates(listing).rows);
          const listed = rows.find(({ project }) => project.id === A_MATE.projectId);
          expect(listed).toMatchObject({ key: A_MATE.projectId, presence: "unknown" });
          const machines = environments.machines();
          // What the row's own key names holds nothing.
          expect(machines.get(listed!.key)?.credential.kind).not.toBe("held");
          const key = rowTarget({
            key: listed!.key,
            projectId: listed!.project.id,
            machines,
            records: environments.records(),
          });
          expect(key).toBe(MATE);
          expect(machines.get(MATE)?.credential).toMatchObject({
            kind: "held",
            environmentId: ENV_A,
            installed: true,
          });
        }),
      ),
  );

  /** Answers the oldest probe of this origin still in flight. */
  const answerProbe = (
    rig: ReturnType<typeof environmentRig>,
    origin: string,
    reading: ProbeReading,
  ) =>
    Effect.gen(function* () {
      const probe = rig.probes.find(
        (entry) => entry.input === origin && !answeredProbes.has(entry),
      );
      if (probe === undefined) throw new Error(`No probe of ${origin} is in flight.`);
      answeredProbes.add(probe);
      probe.answer(reading);
      yield* settle;
    });
  const answeredProbes = new WeakSet<object>();

  it.effect(
    "a deep link on a device with no record exchanges the Mate its descriptor names first",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { rig, environments } = yield* granted([]);
          environments.setRoute(ENV_A);
          yield* settle;
          expect(rig.exchanges).toEqual([]);

          yield* answerProbe(rig, MATE_ORIGIN, answering(ENV_A, A_MATE.projectId));

          expect(
            rig.exchanges.map(({ input: { key, expected, reason } }) => ({
              key,
              expected,
              reason,
            })),
          ).toEqual([{ key: MATE, expected: null, reason: "restore" }]);
        }),
      ),
  );

  // A9 (krok-a-hub §3): HQ's index names the project of every Mate the reader observes, so a
  // notification's click never reads every candidate's descriptor first.
  it.effect("a route HQ's index names is exchanged with no descriptor sweep", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const [named, down, coming] = [mate("1"), mate("2"), mate("3")];
        const { clock, rig, environments } = yield* granted(
          [],
          [named, down, coming],
          undefined,
          undefined,
          {
            hqIndex: {
              projectOf: (environmentId) => (environmentId === ENV_A ? named.projectId : null),
              subscribe: () => () => undefined,
            },
          },
        );
        // No descriptor names the route's environment: the named Mate's read is still out.
        yield* answerProbe(rig, down.origin, { kind: "unreachable" });
        yield* answerProbe(rig, coming.origin, { kind: "initializing", initAt: null });

        environments.setRoute(ENV_A);
        yield* settle;
        expect(rig.exchanges.map(({ input: { key, expected } }) => ({ key, expected }))).toEqual([
          { key: named.key, expected: null },
        ]);

        // Neither is read again for the route: the one coming up only on its poll, the one only a
        // failed read says is coming up not at all, as nobody waits on it. Each stays unanswered.
        yield* clock.advance(10 * SECOND);
        yield* answerProbe(rig, coming.origin, { kind: "initializing", initAt: null });
        expect(rig.probes.filter(({ input }) => input === down.origin)).toHaveLength(1);
        expect(environments.index().reported.has(down.key)).toBe(false);
        expect(environments.index().reported.has(coming.key)).toBe(false);
      }),
    ),
  );

  it.effect("an action on a Mate only HQ's index names holds it once HQ names it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let known = false;
        const heard = { listener: (): void => undefined };
        const { rig, environments } = yield* granted([], [A_MATE], undefined, undefined, {
          hqIndex: {
            projectOf: (environmentId) =>
              known && environmentId === ENV_A ? A_MATE.projectId : null,
            subscribe: (listener) => {
              heard.listener = listener;
              return () => undefined;
            },
          },
        });

        const release = environments.hold(ENV_A);
        yield* settle;
        expect(rig.exchanges).toEqual([]);

        // HQ's structure lands after the stage stood.
        known = true;
        heard.listener();
        yield* settle;
        expect(rig.exchanges.map(({ input: { key } }) => key)).toEqual([MATE]);
        release();
      }),
    ),
  );

  // Usage draws every Mate of the organization (E2E 0.13.3: a cold /usage load connected none):
  // on a cold load no project is opened, no environment was ever connected and nothing is kept, so
  // each Mate HQ names is found as the route's is, through its project, and wanted in the
  // background — at most three exchanges at once — until the page lets go.
  it.effect(
    "a cold page that draws every Mate exchanges each in the background, three at once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const drawn = ["1", "2", "3", "4"].map((id) => ({
            mate: mate(id),
            environmentId: EnvironmentId.make(`env-${id}`),
          }));
          const opened = yield* openAccount(
            [],
            drawn.map(({ mate }) => mate),
            undefined,
            undefined,
            {
              hqIndex: {
                projectOf: (environmentId) =>
                  drawn.find((entry) => entry.environmentId === environmentId)?.mate.projectId ??
                  null,
                subscribe: () => () => undefined,
              },
            },
          );
          yield* opened.grant.answer();
          yield* settle;
          const { environments } = yield* opened.built.postGrant;
          environments.setActiveOrganization(organization.organizationId);
          yield* settle;
          expect(opened.rig.exchanges).toEqual([]);

          environments.setDrawn(drawn.map(({ environmentId }) => environmentId));
          yield* opened.clock.advance(SECOND);
          yield* settle;
          expect(opened.rig.exchanges.map(({ input: { key, asked } }) => ({ key, asked }))).toEqual(
            drawn.slice(0, 3).map(({ mate }) => ({ key: mate.key, asked: false })),
          );

          opened.rig.exchanges[0]!.answer(
            admitted(drawn[0]!.environmentId, async () => ({ ok: true })),
          );
          yield* opened.clock.advance(SECOND);
          yield* settle;
          expect(opened.rig.exchanges.map(({ input: { key } }) => key)).toEqual(
            drawn.map(({ mate }) => mate.key),
          );

          const leased = () =>
            [...opened.registry.get(opened.built.data.stateAtom).interests.values()]
              .filter(
                ({ descriptor, leases }) => leases > 0 && descriptor.kind === "project-inventory",
              )
              .map(({ descriptor }) =>
                "project" in descriptor ? descriptor.project.projectId : "",
              )
              .toSorted();
          expect(leased()).toEqual(drawn.map(({ mate }) => mate.projectId));

          environments.setDrawn([]);
          yield* settle;
          for (const { mate } of drawn) {
            expect(environments.machines().get(mate.key)?.guards.want).toBe(false);
          }
          expect(leased()).toEqual([]);
        }),
      ),
  );

  // E2E 0.13.5: the owner's own browser — Mates remembered from earlier visits, registered and
  // parked — stayed on the skeleton: a warm load must take each drawn project's lease and connect
  // every remembered Mate as a cold one does.
  it.effect(
    "a warm page that draws every remembered Mate leases each project and connects it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const drawn = ["1", "2", "3"].map((id) => {
            const listed = mate(id);
            const environmentId = EnvironmentId.make(`env-${id}`);
            const record: RegistrationRecord = {
              targetKey: listed.key,
              environmentId,
              origin: listed.origin,
              projectRef: { projectId: listed.projectId, orgId: organization.organizationId },
              name: listed.project.name,
            };
            return { mate: listed, environmentId, record };
          });
          const opened = yield* openAccount(
            drawn.map(({ record }) => record),
            drawn.map(({ mate }) => mate),
            undefined,
            undefined,
            {
              hqIndex: {
                projectOf: (environmentId) =>
                  drawn.find((entry) => entry.environmentId === environmentId)?.mate.projectId ??
                  null,
                subscribe: () => () => undefined,
              },
            },
            undefined,
            false,
            // Their services not listed yet: each is looked for where its record kept it (A16).
            true,
          );
          yield* opened.grant.answer();
          yield* settle;
          const { environments } = yield* opened.built.postGrant;
          opened.rig.catalog().environments(registered(...drawn.map((e) => e.environmentId)));
          environments.setActiveOrganization(organization.organizationId);
          yield* settle;
          expect(opened.rig.unparked()).toEqual([]);

          environments.setDrawn(drawn.map(({ environmentId }) => environmentId));
          yield* opened.clock.advance(SECOND);
          yield* settle;
          const leased = [...opened.registry.get(opened.built.data.stateAtom).interests.values()]
            .filter(
              ({ descriptor, leases }) => leases > 0 && descriptor.kind === "project-inventory",
            )
            .map(({ descriptor }) => ("project" in descriptor ? descriptor.project.projectId : ""))
            .toSorted();
          expect(leased).toEqual(drawn.map(({ mate }) => mate.projectId));
          for (const { mate } of drawn) {
            expect(environments.machines().get(mate.key)?.guards.want).toBe(true);
          }
          // Remembered, each is first looked for where its record kept it (A16), then exchanged.
          expect(opened.rig.unparked().toSorted()).toEqual(drawn.map((e) => e.environmentId));
          expect(opened.rig.descriptors.map(({ input }) => input)).toEqual(
            drawn.map(({ mate }) => mate.origin),
          );
          expect(opened.rig.exchanges).toEqual([]);
          drawn.forEach(({ environmentId }, at) =>
            opened.rig.descriptors[at]!.answer(describing(environmentId)),
          );
          yield* settle;
          expect(opened.rig.exchanges.map(({ input: { key, asked } }) => ({ key, asked }))).toEqual(
            drawn.map(({ mate }) => ({ key: mate.key, asked: false })),
          );
        }),
      ),
  );
  // E2E 0.13.6, a warm profile: Usage loaded in a tab that was not in front stayed on its skeleton
  // with no exchange, while the route's Mate connected. A drawn Mate is background demand: it
  // waits for the tab to be shown, as the Mate left last does, and goes on the moment it is.
  it.effect("a hidden tab's drawn Mates wait unread and go on once the tab is shown", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drawn = ["1", "2"].map((id) => {
          const listed = mate(id);
          const environmentId = EnvironmentId.make(`env-${id}`);
          const record: RegistrationRecord = {
            targetKey: listed.key,
            environmentId,
            origin: listed.origin,
            projectRef: { projectId: listed.projectId, orgId: organization.organizationId },
            name: listed.project.name,
          };
          return { mate: listed, environmentId, record };
        });
        const opened = yield* openAccount(
          drawn.map(({ record }) => record),
          drawn.map(({ mate }) => mate),
          undefined,
          undefined,
          {
            hqIndex: {
              projectOf: (environmentId) =>
                drawn.find((entry) => entry.environmentId === environmentId)?.mate.projectId ??
                null,
              subscribe: () => () => undefined,
            },
          },
        );
        yield* opened.grant.answer();
        yield* settle;
        const { environments } = yield* opened.built.postGrant;
        opened.rig.catalog().environments(registered(...drawn.map((e) => e.environmentId)));
        environments.setActiveOrganization(organization.organizationId);
        yield* opened.page.emit({ type: "visibility", hidden: true });
        yield* settle;

        environments.setDrawn(drawn.map(({ environmentId }) => environmentId));
        yield* opened.clock.advance(SECOND);
        yield* settle;
        expect(opened.rig.descriptors).toEqual([]);
        expect(opened.rig.exchanges).toEqual([]);
        for (const { mate } of drawn) {
          expect(environments.machines().get(mate.key)?.credential).toMatchObject({
            kind: "waiting",
            on: "visible",
          });
        }

        yield* opened.page.emit({ type: "visibility", hidden: false });
        yield* settle;
        for (const { mate } of drawn) {
          expect(environments.machines().get(mate.key)?.credential.kind).toBe("exchanging");
        }
      }),
    ),
  );

  // A drawn project's lease the data runtime refuses is not held as taken: the page's next demand
  // asks for it again, as the inventory demand does, with no timer of its own.
  it.effect("a drawn project whose lease was refused is asked for again on the next demand", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* openAccount(
          [],
          [A_MATE],
          undefined,
          undefined,
          {
            hqIndex: {
              projectOf: (id) => (id === ENV_A ? A_MATE.projectId : null),
              subscribe: () => () => undefined,
            },
          },
          makeZeropsDataPolicy({ activeInterestsPerAccount: 16 }),
        );
        const background = yield* Scope.make();
        yield* opened.built.data.acquire({ kind: "organization-inventory", organization });
        for (let i = 0; i < 15; i++) {
          yield* opened.built.data
            .acquire({ kind: "project-topology", project: project(`background-${i}`) })
            .pipe(Effect.provideService(Scope.Scope, background));
        }
        yield* opened.grant.answer();
        yield* settle;
        const { environments } = yield* opened.built.postGrant;
        environments.setActiveOrganization(organization.organizationId);
        const leased = () =>
          [...opened.registry.get(opened.built.data.stateAtom).interests.values()].filter(
            ({ descriptor, leases }) => leases > 0 && descriptor.kind === "project-inventory",
          ).length;

        environments.setDrawn([ENV_A]);
        yield* settle;
        expect(leased()).toBe(0);

        yield* Scope.close(background, Exit.void);
        yield* settle;
        environments.setDrawn([ENV_A]);
        yield* settle;
        expect(leased()).toBe(1);
      }),
    ),
  );

  it.effect("an unknown route does not sweep other projects for descriptors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([]);
        environments.setRoute(EnvironmentId.make("unknown-environment"));
        yield* settle;
        expect(rig.probes.map(({ input }) => input)).not.toContain("unknown-environment");
        expect(rig.exchanges).toEqual([]);
      }),
    ),
  );

  // E2E 2026-10-03: the first write after a fresh load failed while the background minted and
  // deleted throwaways on the token list the press reads. A press in flight holds the background.
  it.effect(
    "the Mate left last mints nothing while a press is in flight, and goes on once it ends",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let pressing = true;
          const heard = { listener: (): void => undefined };
          const { rig, environments } = yield* granted(
            [],
            [A_MATE],
            platformAdapter([A_MATE]),
            [A_MATE],
            {
              pressInFlight: {
                read: () => pressing,
                subscribe: (listener) => {
                  heard.listener = listener;
                  return () => undefined;
                },
              },
            },
          );
          yield* answerProbe(rig, MATE_ORIGIN, answering(ENV_A, A_MATE.projectId));
          // Left in the same turn it was opened: only the Mate left last wants it.
          environments.setRoute(ENV_A);
          environments.setRoute(null);
          yield* settle;
          expect(rig.exchanges).toEqual([]);

          pressing = false;
          heard.listener();
          yield* settle;
          expect(rig.exchanges.map(({ input: { key, reason } }) => ({ key, reason }))).toEqual([
            { key: MATE, reason: "restore" },
          ]);
        }),
      ),
  );

  it.effect(
    "a Mate whose door names another project refreshes presence without inventory invalidation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { clock, rig, built, environments } = yield* granted([REMEMBERED_A]);
          environments.setRoute(ENV_A);
          yield* settle;
          const heard: Array<Invalidation> = [];
          const subscription = yield* built.invalidations.subscribe;
          yield* Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((invalidation) => Effect.sync(() => heard.push(invalidation))),
            Effect.forkScoped,
          );

          rig.exchanges[0]!.answer({
            ok: false,
            failure: { class: "refusal", reason: { kind: "project-mismatch" } },
            descriptor: null,
          });
          yield* settle;
          yield* clock.advance(250);
          yield* settle;

          expect(heard).toEqual([]);
        }),
      ),
  );

  it.effect(
    "a ready Mate in a project the person has no access to is never a target: no address, no probe",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const outside = mate("b");
          const { clock, rig, environments } = yield* granted(
            [],
            [A_MATE, outside],
            platformAdapter([A_MATE, outside]),
            [A_MATE],
          );
          yield* clock.advance(MINUTE);
          yield* settle;

          expect([...environments.machines().keys()]).not.toContain(outside.key);
          expect(rig.probes.map(({ input }) => input)).not.toContain(outside.origin);
          expect([...environments.machines().keys()]).toContain(MATE);
        }),
      ),
  );

  it.effect(
    "a Mate HQ holds online is not probed as the stage starts, and is once HQ lets it go",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let online: ReadonlySet<string> = new Set([A_MATE.projectId]);
          const heard = { listener: (): void => undefined };
          const { clock, rig, environments } = yield* granted(
            [],
            [A_MATE],
            platformAdapter([A_MATE]),
            [A_MATE],
            {
              online: {
                read: () => online,
                subscribe: (listener) => {
                  heard.listener = listener;
                  return () => undefined;
                },
              },
            },
          );
          yield* clock.advance(MINUTE);
          yield* settle;
          expect([...environments.machines().keys()]).toContain(MATE);
          expect(rig.probes.map(({ input }) => input)).not.toContain(MATE_ORIGIN);

          online = new Set();
          heard.listener();
          yield* settle;
          expect(rig.probes.map(({ input }) => input)).toContain(MATE_ORIGIN);
        }),
      ),
  );

  // t10, 2026-10-03: under KRLS's official HQ, every listed zcp project — Mate or not, up or not —
  // was read at load. A project HQ's current word speaks for and does not hold online waits for a
  // lease.
  it.effect(
    "a project an official HQ's current word does not hold online is read only once a lease holds it",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { clock, rig, environments } = yield* granted(
            [],
            [A_MATE],
            platformAdapter([A_MATE]),
            [A_MATE],
            {
              online: { read: () => new Set(), subscribe: () => () => undefined },
              hqOrganization: {
                read: () => organization.organizationId,
                subscribe: () => () => undefined,
              },
            },
          );
          yield* clock.advance(MINUTE);
          yield* settle;
          expect([...environments.machines().keys()]).toContain(MATE);
          expect(rig.probes.map(({ input }) => input)).not.toContain(MATE_ORIGIN);

          environments.setOnScreen(A_MATE.projectId);
          yield* settle;
          expect(rig.probes.map(({ input }) => input)).toContain(MATE_ORIGIN);
        }),
      ),
  );

  it.effect("a Mate listed where no HQ will answer is read at once, never waiting for HQ", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted(
          [],
          [A_MATE],
          platformAdapter([A_MATE]),
          [A_MATE],
          {
            online: { read: () => "absent", subscribe: () => () => undefined },
          },
        );
        yield* settle;
        expect([...environments.machines().keys()]).toContain(MATE);
        expect(rig.probes.map(({ input }) => input)).toContain(MATE_ORIGIN);
      }),
    ),
  );

  it.effect(
    "a Mate listed before HQ answers waits for its word, and HQ holding it online keeps it unread",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let online: ReadonlySet<string> | null = null;
          const heard = { listener: (): void => undefined };
          const { clock, rig, environments } = yield* granted(
            [],
            [A_MATE],
            platformAdapter([A_MATE]),
            [A_MATE],
            {
              online: {
                read: () => online,
                subscribe: (listener) => {
                  heard.listener = listener;
                  return () => undefined;
                },
              },
            },
          );
          yield* settle;
          expect([...environments.machines().keys()]).toContain(MATE);
          expect(rig.probes.map(({ input }) => input)).not.toContain(MATE_ORIGIN);

          online = new Set([A_MATE.projectId]);
          heard.listener();
          yield* clock.advance(MINUTE);
          yield* settle;
          expect(rig.probes.map(({ input }) => input)).not.toContain(MATE_ORIGIN);
        }),
      ),
  );

  it.effect(
    "a remembered route target is probed and exchanged at the grant, before its project's services are read",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { rig, environments } = yield* granted(
            [REMEMBERED_A],
            [A_MATE],
            undefined,
            undefined,
            undefined,
            false,
            true,
          );
          environments.setRoute(ENV_A);
          yield* settle;

          // Nothing has read the project's services: the Mate is looked for where the record kept it.
          expect(environments.machines().get(MATE)?.presence).toEqual({
            kind: "remembered",
            origin: MATE_ORIGIN,
          });
          expect(rig.descriptors.map(({ input }) => input)).toEqual([MATE_ORIGIN]);
          expect(rig.exchanges).toEqual([]);

          rig.descriptors[0]!.answer(describing(ENV_A));
          yield* settle;

          expect(
            rig.exchanges.map(
              ({ input: { key, origin, expected, projectId, organizationId } }) => ({
                key,
                origin,
                expected,
                projectId,
                organizationId,
              }),
            ),
          ).toEqual([
            {
              key: MATE,
              origin: MATE_ORIGIN,
              expected: ENV_A,
              projectId: A_MATE.projectId,
              organizationId: "org-1",
            },
          ]);
          expect(environments.machines().get(MATE)?.presence.kind).toBe("remembered");
        }),
      ),
  );

  /** Three Mates, each remembered, the third the route's. */
  const routeScene = () => {
    const mates = [mate("1"), mate("2"), mate("3")];
    const route = mates[2]!;
    const environment = EnvironmentId.make("env-3");
    const records = mates.map((listed, index): RegistrationRecord => ({
      targetKey: listed.key,
      environmentId: listed === route ? environment : EnvironmentId.make(`env-${index}`),
      origin: listed.origin,
      projectRef: { projectId: listed.projectId, orgId: "org-1" },
      name: listed.project.name,
    }));
    return { mates, route, environment, records };
  };

  it.effect("the route is set before the first probe of a listing change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { mates, route, environment, records } = routeScene();
        const { rig, environments, releaseRoster } = yield* granted(
          records.filter(({ environmentId }) => environmentId !== environment),
          mates,
          undefined,
          undefined,
          undefined,
          true,
          true,
        );
        environments.setRoute(environment);
        yield* settle;
        expect(rig.probes.map(({ input }) => input)).not.toContain("unknown-environment");

        // Another tab stores the route's record; its storage event has not reached this tab yet.
        rig.storeElsewhere(records, false);
        // The organization's projects are read: every remembered Mate's container is read at
        // once, the route's first.
        releaseRoster();
        yield* settle;
        expect(rig.probes.map(({ input }) => input)[0]).toBe(route.origin);
        expect(rig.probes.map(({ input }) => input).toSorted()).toEqual(
          mates.map(({ origin }) => origin).toSorted(),
        );
      }),
    ),
  );

  it.effect("a record naming the route has the route's origin probed first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { mates, route, environment, records } = routeScene();
        const { rig, environments } = yield* granted(
          [],
          mates,
          undefined,
          undefined,
          undefined,
          false,
          true,
        );
        environments.setRoute(environment);
        yield* settle;
        expect(rig.probes.map(({ input }) => input)).not.toContain("unknown-environment");

        // The organization's projects are listed already; another tab remembers every Mate.
        rig.storeElsewhere(records, true);
        yield* settle;
        expect(rig.probes.map(({ input }) => input)[0]).toBe(route.origin);
        expect(rig.probes.map(({ input }) => input).toSorted()).toEqual(
          mates.map(({ origin }) => origin).toSorted(),
        );
      }),
    ),
  );

  it.effect("the socket admission follows the route, and lets go when the account closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments, built } = yield* granted([REMEMBERED_A]);
        environments.setRoute(ENV_A);
        environments.setRoute(null);
        environments.setRoute(ENV_A);
        yield* built.close("application-close");
        expect(rig.preferred).toEqual([ENV_A, null, ENV_A, null]);
      }),
    ),
  );

  it.effect.each([
    { status: "RESTARTING", down: [ENV_A] },
    { status: "STOPPED", down: [ENV_A] },
    { status: "ACTIVE", down: [] },
  ])("a Mate whose service is $status: its sockets wait on the platform", ({ status, down }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const restarting = { ...A_MATE, service: { ...A_MATE.service, status } };
        const { rig, built } = yield* granted([REMEMBERED_A], [restarting]);
        expect(rig.down).toEqual(down);
        yield* built.close("application-close");
        expect(rig.down).toEqual([]);
      }),
    ),
  );

  it.effect("an unchanged listing publishes no target change", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, grant, rig, environments } = yield* granted([REMEMBERED_A]);
        yield* clock.advance(SECOND);
        yield* settle;
        const machines = environments.machines();
        const probes = rig.probes.length;
        const reads = rig.recordReads();

        // A renewal admits the same evidence: the listings are derived again, and none changed.
        while (grant.rounds() < 2) {
          yield* clock.advance(MINUTE);
          yield* settle;
        }
        yield* grant.answer();

        expect(rig.recordReads()).toBe(reads);
        expect(rig.probes).toHaveLength(probes);
        expect(environments.machines()).toBe(machines);
      }),
    ),
  );
});
