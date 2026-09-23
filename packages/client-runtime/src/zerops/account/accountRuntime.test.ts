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
import { AtomRegistry } from "effect/unstable/reactivity";
import { EnvironmentId } from "@t3tools/contracts";

import { ZeropsApiClient } from "../api.ts";
import { account, organization, project, scope } from "../data/__fixtures__/index.ts";
import { makeRestAccessVerifier, type AccessVerifier } from "../data/access/verifier.ts";
import { grantPlatformWrite, type GrantFailure } from "../data/access/grant.ts";
import { DEFAULT_ZEROPS_GRANT_POLICY } from "../data/policy.ts";
import { makeZeropsDataRuntime } from "../data/runtime.ts";
import {
  decodeEntityDirectResponse,
  decodeEntityQueryPages,
  decodeRegistrationResponse,
} from "../data/platformProtocol.ts";
import {
  ZeropsOrganizationId,
  type EntityQueryDescriptor,
  type ProjectRef,
  type ZeropsDataAdapter,
} from "../data/types.ts";
import type { ProbeReading } from "../environments/probeStore.ts";
import { REGISTRATION_RECORDS_KEY, type RegistrationRecord } from "../environments/records.ts";
import type { ExchangeAnswer } from "../identityExchange.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import { makePlatformSignals, type PageEvent } from "../knowledge/signals.ts";
import { makeDeadlineClock, type DeadlineClock } from "../testing/deadlineClock.ts";
import { makeFakeDatastream } from "../testing/fakeDatastream.ts";
import { makeFakeZeropsRest } from "../testing/fakeZeropsRest.ts";
import {
  fetchAcross,
  HARNESS_BROKER_ORIGIN,
  HARNESS_GITEA_ORIGIN,
  makeAccountHarness,
} from "../testing/accountHarness.ts";
import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import type { ForgeFact } from "../forge/forgeStore.ts";
import {
  makeAccountRuntime,
  type AccountEnvironmentPorts,
  type AccountForgePorts,
  type CatalogListener,
  type DoorCredential,
  type DoorRequest,
} from "./accountRuntime.ts";

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
const platformAdapter = (mates: ReadonlyArray<Mate>): ZeropsDataAdapter => {
  const rowsOf = (query: EntityQueryDescriptor): ReadonlyArray<unknown> => {
    switch (query.kind) {
      case "projects-of-organization":
        return mates.map(({ project }) => project);
      case "services-of-project":
        return mates
          .filter(({ projectId }) => projectId === query.project.projectId)
          .map(({ service }) => service);
      default:
        return [];
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
      Effect.sync(() => {
        if (request.descriptor.kind !== "query-membership") return { responseObservations: [] };
        const items = rowsOf(request.descriptor.query);
        return {
          responseObservations: decodeRegistrationResponse(request, {
            items,
            total: items.length,
          }).observations,
        };
      }),
    read: (ticket) =>
      Effect.sync(() => {
        if (ticket.target.kind === "query") {
          const descriptor = ticket.target.descriptor as EntityQueryDescriptor;
          const rows = rowsOf(descriptor);
          return {
            observations: decodeEntityQueryPages(descriptor, ticket, [
              { rows, totalCount: rows.length },
            ]).observations,
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
    execute: () => Effect.succeed({ processRefs: [], observations: [] }),
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
 * catalog, the births and the records' other tabs are the test's to drive.
 */
const environmentRig = (clock: DeadlineClock, remembered: ReadonlyArray<RegistrationRecord>) => {
  const exchanges: Array<Pending<DoorRequest, ExchangeAnswer<DoorCredential>>> = [];
  const probes: Array<Pending<string, ProbeReading>> = [];
  const removed: Array<EnvironmentId> = [];
  const promoted: Array<readonly [string, EnvironmentId]> = [];
  const storage = new Map<string, string>([[REGISTRATION_RECORDS_KEY, JSON.stringify(remembered)]]);
  /** What the stage listens to now, by port. */
  const listening = { records: 0, catalog: 0, births: 0 };
  let catalog: CatalogListener | null = null;
  let unhardened: ReadonlySet<string> = new Set();
  const ports: AccountEnvironmentPorts = {
    clock: {
      now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
      random: () => 0.5,
      setTimer: () => () => undefined,
    },
    door: {
      exchange: (request) => pending(exchanges, request, request.signal),
      readDescriptor: (_origin, signal) => pending([], null, signal),
      retryLink: () => undefined,
      remove: (environmentId) => void removed.push(environmentId),
    },
    probe: (origin, signal) => pending(probes, origin, signal),
    intents: { read: () => null, write: () => undefined },
    records: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      listen: () => {
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
    births: {
      unhardened: () => unhardened,
      subscribe: () => {
        listening.births += 1;
        return () => void (listening.births -= 1);
      },
      promote: (projectId, environmentId) => void promoted.push([projectId, environmentId]),
    },
  };
  return {
    ports,
    exchanges,
    probes,
    removed,
    promoted,
    listening,
    /** The records as they are stored now. */
    records: () =>
      JSON.parse(storage.get(REGISTRATION_RECORDS_KEY) ?? "[]") as Array<RegistrationRecord>,
    /** The connection catalog as the stage hears it. */
    catalog: () => catalog!,
    setUnhardened: (next: ReadonlySet<string>) => {
      unhardened = next;
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
const heldVerifier = (projects: ReadonlyArray<ProjectRef> = [A]) => {
  const answers: Array<Deferred.Deferred<GrantFailure | null>> = [];
  const verifier: AccessVerifier = {
    verifyRound: ({ round, report }) =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<GrantFailure | null>();
        answers.push(answer);
        const failure = yield* Deferred.await(answer);
        if (failure !== null) return yield* Effect.fail({ failure, message: "Zerops is down." });
        yield* report({ type: "ROUND_ACCOUNT", round, organizations, projects });
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
            });
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
          expect(yield* demanded()).toEqual(["organization-inventory", "project-inventory"]);

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
          });
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
        // The account holds both organizations' inventories and their projects'.
        expect(yield* statuses()).toEqual(["observing", "observing", "observing", "observing"]);
        expect(opened.toSorted()).toEqual(["org-1", "org-2"]);
        const roundsBefore = rounds().length;

        yield* built.invalidations
          .invalidate({ topic: "inventory", organization })
          .pipe(Effect.provideService(Clock.Clock, clock));
        yield* built.invalidations
          .invalidate({ topic: "inventory", organization })
          .pipe(Effect.provideService(Clock.Clock, clock));
        yield* clock.advance(250);
        yield* settle;

        expect(opened.slice(2)).toEqual(["org-1"]);
        expect(yield* statuses()).toEqual(["observing", "observing", "observing", "observing"]);
        expect(rounds()).toHaveLength(roundsBefore);
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
          }).pipe(Effect.exit);
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
  ) {
    const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
    const registry = AtomRegistry.make();
    const page = yield* makePage(clock);
    const grant = heldVerifier(mates.map(({ projectId }) => project(projectId)));
    const rig = environmentRig(clock, remembered);
    const built = yield* Effect.gen(function* () {
      const data = yield* makeZeropsDataRuntime({
        scope: scope(),
        adapter,
        atomRegistry: registry,
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
        environments: rig.ports,
      });
    }).pipe(Effect.provideService(Clock.Clock, clock));
    yield* Effect.addFinalizer(() => built.close("application-close"));
    return { clock, page, grant, rig, built };
  });

  /** `openAccount` past the epoch's first grant, with its post-grant stage. */
  const granted = Effect.fnUntraced(function* (
    remembered: ReadonlyArray<RegistrationRecord>,
    mates: ReadonlyArray<Mate> = [A_MATE],
    adapter: ZeropsDataAdapter = platformAdapter(mates),
  ) {
    const opened = yield* openAccount(remembered, mates, adapter);
    yield* opened.grant.answer();
    yield* opened.clock.advance(SECOND);
    yield* settle;
    const stage = yield* opened.built.postGrant;
    return { ...opened, environments: stage.environments };
  });

  it.effect("no exchange before the first grant (I10, AL-04), with no React", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, grant, rig, built } = yield* openAccount([REMEMBERED_A]);
        const postGrant = yield* Effect.forkChild(built.postGrant);
        yield* clock.advance(SECOND);
        yield* settle;

        // The remembered Mate is present on the platform, and the first round is still out.
        expect(grant.rounds()).toBe(1);
        expect(postGrant.pollUnsafe()).toBeUndefined();
        expect(rig.exchanges).toEqual([]);

        yield* grant.answer();
        yield* clock.advance(SECOND);
        yield* settle;

        const stage = yield* Fiber.join(postGrant);
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

  it.effect(
    "the deployment store follows a stop's listing and hears deployment invalidations",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { clock, built } = yield* granted([]);
          const { deployments, forge, services } = yield* built.postGrant;
          /** Whether a lease holds project A's running processes. */
          const followsActivity = built.data.state.pipe(
            Effect.map((state) =>
              [...state.interests.values()].some(
                ({ leases, descriptor }) =>
                  leases > 0 &&
                  descriptor.kind === "project-activity" &&
                  descriptor.project.projectId === A_MATE.projectId,
              ),
            ),
          );
          // The Mate's own container is the one service there: a stop that runs nothing.
          const projectA = project(A_MATE.projectId);
          const release = deployments.demand(projectA);
          yield* clock.advance(SECOND);
          yield* settle;
          expect(deployments.stop(projectA)).toMatchObject({ state: "known", value: [] });
          expect(forge).toBeNull();
          // A shown stop reads what builds run in its project, and only while it is shown.
          expect(yield* followsActivity).toBe(true);

          const zcp = services.serviceOf(A_MATE.projectId, "zcp");
          if (zcp === null) throw new Error("the account holds project A's zcp service");
          expect(zcp.serviceId).toBe(A_MATE.service.id);
          expect(services.serviceOf(A_MATE.projectId, "appdev")).toBeNull();
          const heard: Array<string> = [];
          deployments.subscribe((ref) => heard.push(ref.projectId));
          yield* built.invalidations
            .invalidate({ topic: "deployment", service: zcp })
            .pipe(Effect.provideService(Clock.Clock, clock));
          yield* clock.advance(SECOND);
          yield* settle;
          expect(heard).toEqual([A_MATE.projectId]);

          release();
          yield* clock.advance(SECOND);
          yield* settle;
          expect(yield* followsActivity).toBe(false);
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
        expect(rig.listening).toEqual({ records: 1, catalog: 1, births: 1 });
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
        expect(rig.listening).toEqual({ records: 0, catalog: 0, births: 0 });
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
      name: "the registry takes it: its target is remembered and its birth ends",
      installed: true,
      records: [REMEMBERED_A],
      promoted: [[A_MATE.projectId, ENV_A]],
    },
    {
      name: "the registry refuses it: nothing is written",
      installed: false,
      records: [],
      promoted: [],
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
        expect(rig.promoted).toEqual(row.promoted);
        if (row.installed) {
          expect(yield* Effect.promise(() => connect)).toEqual({
            _tag: "Connected",
            environmentId: ENV_A,
          });
        }
      }),
    ),
  );

  const ENV_B = EnvironmentId.make("env-b");
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
          if (row.remembered.length === 0) void environments.connect(MATE, "user");
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

  it.effect(
    "a route nothing names waits for each unreachable Mate's next poll, and is answered once that read fails too",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const [named, down, coming] = [mate("1"), mate("2"), mate("3")];
          const { clock, rig, environments } = yield* granted([], [named, down, coming]);
          const probed = () => rig.probes.length;
          const unanswered = () => environments.index().unanswered;
          yield* answerProbe(rig, named.origin, answering(ENV_B, named.projectId));
          // Unreachable, it boots on a guess, read again at the backing-off intervals; a Mate still
          // coming up answers /healthz only, read every poll interval.
          yield* answerProbe(rig, down.origin, { kind: "unreachable" });
          yield* answerProbe(rig, coming.origin, { kind: "initializing", initAt: null });
          const beforeSweep = probed();

          environments.setRoute(ENV_A);
          yield* settle;
          const sweptAtOnce = probed() - beforeSweep;
          const beforeItsPoll = unanswered();
          // Its first backed-off poll is 10 s after its failure; a landing lets the poll read it.
          yield* clock.advance(10 * SECOND);
          yield* answerProbe(rig, coming.origin, { kind: "initializing", initAt: null });
          yield* answerProbe(rig, down.origin, { kind: "unreachable" });

          // The Mate coming up read again on the sweep's watch has still not answered.
          expect({ sweptAtOnce, beforeItsPoll, polled: unanswered() }).toEqual({
            sweptAtOnce: 0,
            beforeItsPoll: [down.key, coming.key],
            polled: [coming.key],
          });
          expect(environments.index().failed).toEqual([down.key, coming.key]);
        }),
      ),
  );

  it.effect.each([
    {
      name: "a ready Mate of the organization the tab has open",
      open: "org-1",
      born: [],
      wanted: 1,
    },
    { name: "none while another organization is open", open: "org-2", born: [], wanted: 0 },
    {
      name: "none while its birth has not closed its project off",
      open: "org-1",
      born: [A_MATE.projectId],
      wanted: 0,
    },
  ])("auto-connect wants $name (D13)", (row) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { rig, environments } = yield* granted([]);
        rig.setUnhardened(new Set(row.born));
        yield* answerProbe(rig, MATE_ORIGIN, answering(ENV_A, A_MATE.projectId));

        environments.setActiveOrganization(row.open);
        yield* settle;

        expect(rig.exchanges.map(({ input: { key, reason } }) => ({ key, reason }))).toEqual(
          Array.from({ length: row.wanted }, () => ({ key: MATE, reason: "auto-connect" })),
        );
      }),
    ),
  );

  it.effect(
    "a Mate whose door names another project has its organization's inventory read again",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { clock, rig, built } = yield* granted([REMEMBERED_A]);
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

          expect(heard).toEqual([{ topic: "inventory", organization }]);
        }),
      ),
  );

  /**
   * A platform whose projects' services are read directly once, as `first` lists them. Every
   * later direct read of them waits for `release` and answers as `after` does, and so does every
   * registration from then on.
   */
  const heldServicesReads = (first: ZeropsDataAdapter, after: ZeropsDataAdapter) => {
    let reads = 0;
    let released = false;
    let release: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      release = () => {
        released = true;
        resolve();
      };
    });
    const adapter: ZeropsDataAdapter = {
      ...first,
      register: (receiver, request, context) =>
        (released ? after : first).register(receiver, request, context),
      read: (ticket, context) =>
        ticket.target.kind === "query" &&
        (ticket.target.descriptor as EntityQueryDescriptor).kind === "services-of-project" &&
        ++reads > 1
          ? Effect.promise(() => opened).pipe(Effect.andThen(after.read(ticket, context)))
          : (released ? after : first).read(ticket, context),
    };
    return { adapter, reads: () => reads, release };
  };

  it.effect("a deleted service loses its Mate only after a confirming read (§9 C19, MC-14)", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const ENV_DELETED = EnvironmentId.make("env-deleted");
        const deleted: RegistrationRecord = {
          ...REMEMBERED_A,
          targetKey: `${A_MATE.projectId}:service-deleted`,
          environmentId: ENV_DELETED,
          origin: "https://zcp-deleted-8080.prg1.zerops.app",
        };
        const platform = heldServicesReads(platformAdapter([A_MATE]), platformAdapter([A_MATE]));
        const { clock, rig, environments } = yield* granted([deleted], [A_MATE], platform.adapter);
        yield* clock.advance(MINUTE);
        yield* settle;

        // The services were read without it: a direct read of them is asked for, and until it
        // answers the Mate is kept, however long it takes.
        expect(environments.machines().get(deleted.targetKey)?.presence.kind).not.toBe("gone");
        expect(rig.removed).toEqual([]);
        expect(platform.reads()).toBeGreaterThan(1);

        platform.release();
        yield* clock.advance(MINUTE);
        yield* settle;

        // The direct read lacks it too: the Mate leaves the catalog.
        expect(environments.machines().get(deleted.targetKey)?.presence).toEqual({
          kind: "gone",
          evidence: "complete-scope-omits-verified",
        });
        expect(rig.removed).toEqual([ENV_DELETED]);
        // The listed Mate beside it is untouched.
        expect(environments.machines().get(MATE)?.presence.kind).toBe("present");
      }),
    ),
  );

  it.effect(
    "a service one listing drops keeps its Mate when the direct read finds it (MC-14)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = heldServicesReads(
            platformAdapter([{ ...A_MATE, service: { ...A_MATE.service, id: "service-other" } }]),
            platformAdapter([A_MATE]),
          );
          const { clock, rig, environments } = yield* granted(
            [REMEMBERED_A],
            [A_MATE],
            platform.adapter,
          );
          yield* clock.advance(MINUTE);
          yield* settle;
          // Listed without it: the Mate is kept while a direct read of the services is asked for.
          expect(environments.machines().get(MATE)?.presence.kind).not.toBe("gone");
          expect(platform.reads()).toBeGreaterThan(1);

          platform.release();
          yield* clock.advance(MINUTE);
          yield* settle;

          expect(environments.machines().get(MATE)?.presence).toEqual({
            kind: "present",
            origin: MATE_ORIGIN,
          });
          expect(rig.removed).toEqual([]);
        }),
      ),
  );
});

describe("the post-grant stage's forge", () => {
  const throwaways: ZeropsThrowawayPlatform = {
    mint: async () => ({ id: "throwaway", token: "the-throwaway" }),
    remove: async () => undefined,
  };
  const TAGS: ForgeFact = {
    kind: "tags",
    origin: HARNESS_GITEA_ORIGIN,
    owner: "acme",
    repo: "group",
  };

  /**
   * An account runtime whose forge reaches a fake Gitea and broker; every Gitea read after `hold`
   * waits, and ends only by its signal. The forge's timers run on the test's clock.
   */
  const openAccount = Effect.fnUntraced(function* () {
    const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
    const registry = AtomRegistry.make();
    const page = yield* makePage(clock);
    const grant = heldVerifier();
    const harness = makeAccountHarness({ people: [] });
    harness.gitea.setTags("acme", "group", ["v1.0.0"]);
    const direct = fetchAcross(harness.gitea, harness.broker);
    const sent: Array<string> = [];
    const held: Array<AbortSignal> = [];
    let holding = false;
    /** The forge's timers, fired by `turn` once the clock reaches them. */
    const timers = new Set<{ readonly at: number; readonly fire: () => void }>();
    const forge: AccountForgePorts = {
      fetch: async (input, init) => {
        const url = String(input);
        sent.push(url);
        if (holding && url.startsWith(HARNESS_GITEA_ORIGIN)) {
          const signal = init?.signal ?? new AbortController().signal;
          held.push(signal);
          return new Promise<Response>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
          );
        }
        return direct(input, init);
      },
      now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
      random: () => 0.5,
      nonce: () => "nonce",
      setTimer: (delayMs, fire) => {
        const timer = { at: clock.monoMs() + delayMs, fire };
        timers.add(timer);
        return () => void timers.delete(timer);
      },
    };
    const built = yield* Effect.gen(function* () {
      const data = yield* makeZeropsDataRuntime({
        scope: scope(),
        adapter: inertAdapter,
        atomRegistry: registry,
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
        environments: inertEnvironments(clock),
        forge,
      });
    }).pipe(Effect.provideService(Clock.Clock, clock));
    yield* Effect.addFinalizer(() => built.close("application-close"));
    return {
      clock,
      page,
      grant,
      built,
      sent,
      held,
      hold: () => {
        holding = true;
      },
      /** Lets the forge's answers land and fires the timers they arm that are due. */
      turn: Effect.gen(function* () {
        for (let step = 0; step < 10; step++) {
          for (const timer of timers) {
            if (timer.at > clock.monoMs()) continue;
            timers.delete(timer);
            timer.fire();
          }
          yield* settle;
        }
      }),
    };
  });

  it.effect("the forge store is built only after the first grant and disposed at sign-out", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { clock, grant, built, sent, held, hold, turn } = yield* openAccount();
        const postGrant = yield* Effect.forkChild(built.postGrant);
        yield* clock.advance(SECOND);
        yield* settle;
        // Nothing of the forge stands, and nothing reached Gitea or its broker.
        expect(postGrant.pollUnsafe()).toBeUndefined();
        expect(sent).toEqual([]);

        yield* grant.answer();
        yield* clock.advance(SECOND);
        yield* settle;
        const { forge } = yield* Fiber.join(postGrant);
        if (forge === null) throw new Error("the web host gives the forge its ports");
        forge.sessions.demand({
          giteaOrigin: HARNESS_GITEA_ORIGIN,
          brokerOrigin: HARNESS_BROKER_ORIGIN,
          clientId: "org-1",
          platform: throwaways,
        });
        forge.store.demand(TAGS);
        yield* turn;
        expect(forge.store.read(TAGS).state).toBe("known");

        // A re-read on the bus is in flight when the person signs out.
        hold();
        yield* built.invalidations
          .invalidate({
            topic: "forge-repo",
            origin: HARNESS_GITEA_ORIGIN,
            owner: "acme",
            repo: "group",
          })
          .pipe(Effect.provideService(Clock.Clock, clock));
        yield* clock.advance(SECOND);
        yield* turn;
        expect(held).toHaveLength(1);

        yield* built.close("logout");

        expect(held.map((signal) => signal.aborted)).toEqual([true]);
        expect(forge.store.read(TAGS).state).toBe("unread");
        expect(forge.sessions.view(HARNESS_GITEA_ORIGIN).signedIn).toBe(false);
        expect(forge.sessions.capability(HARNESS_GITEA_ORIGIN)).toEqual({
          allowed: false,
          reason: "epoch-closed",
          waitable: false,
        });
        expect(
          yield* Effect.promise(() =>
            forge.commands.run({
              kind: "release",
              origin: HARNESS_GITEA_ORIGIN,
              slug: "acme",
              groupId: "g1",
              tag: "v1.0.1",
              message: "",
            }),
          ),
        ).toMatchObject({ phase: "refused", refusal: { reason: "epoch-closed" } });
      }),
    ),
  );
});
