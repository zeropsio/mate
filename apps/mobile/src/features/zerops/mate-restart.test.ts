/**
 * A Mate on mobile through the account runtime mobile hosts (DESIGN §7.5, A10): the account's
 * records over the device's storage, its intents in memory, no births, and a door, a probe and a
 * connection catalog the test answers — and the picker's rows as they read the runtime's machines.
 */
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";
import {
  makeAccountRuntime,
  type AccountEnvironmentPorts,
  type AccountEnvironments,
  type CatalogListener,
  type DoorRequest,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  AccountEpoch,
  decodeEntityDirectResponse,
  decodeEntityQueryPages,
  decodeRegistrationResponse,
  knownProjectsOf,
  knownServicesOf,
  makeZeropsApiOrigin,
  makeZeropsDataRuntime,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type AccessVerifier,
  type AccountScope,
  type EntityQueryDescriptor,
  type ManagedZeropsDataRuntime,
  type ZeropsDataAdapter,
} from "@t3tools/client-runtime/zerops/data";
import {
  REGISTRATION_RECORDS_KEY,
  type ProbeReading,
  type RegistrationRecord,
} from "@t3tools/client-runtime/zerops/environments";
import { makePlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { selectCandidates } from "@t3tools/client-runtime/zerops/projections";
import { makeDeadlineClock, type DeadlineClock } from "@t3tools/client-runtime/zerops/testing";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";

import { loadAccountRecords, memoryIntents, NO_BIRTHS } from "./account-ports";
import { mobileCandidates } from "./candidate-listing";
import { zeropsCandidatePresentation } from "./presentation";

const SECOND = 1_000;
const START_WALL_MS = Date.UTC(2026, 8, 23, 10, 0, 0);
const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";
const PROJECT_ID = "project-a";
const KEY = `${PROJECT_ID}:service-a`;
const ORIGIN = "https://zcp-a-8080.prg1.zerops.app";
const ENVIRONMENT_ID = EnvironmentId.make("env-a");

const scope: AccountScope = {
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make(USER_ID),
  },
  epoch: AccountEpoch.make(1),
};
const organization = {
  kind: "organization" as const,
  account: scope.account,
  organizationId: ZeropsOrganizationId.make(ORGANIZATION_ID),
};
const project = {
  kind: "project" as const,
  organization,
  projectId: ZeropsProjectId.make(PROJECT_ID),
};

/** The one project's platform: its zcp service's status is the test's to change. */
const platform = () => {
  const state = { service: "ACTIVE" };
  const projectRow = {
    id: PROJECT_ID,
    name: "shop",
    status: "ACTIVE",
    publicZone: "x.prg1-zerops.zone",
    zeropsSubdomainHost: "a",
  };
  const serviceRow = () => ({
    id: "service-a",
    projectId: PROJECT_ID,
    name: "zcp",
    status: state.service,
    serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
    subdomainAccess: true,
    ports: [{ port: 8080 }],
  });
  const rowsOf = (query: EntityQueryDescriptor): ReadonlyArray<unknown> =>
    query.kind === "projects-of-organization"
      ? [projectRow]
      : query.kind === "services-of-project"
        ? [serviceRow()]
        : [];
  const adapter: ZeropsDataAdapter = {
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
        return {
          observations:
            ticket.target.kind === "project"
              ? decodeEntityDirectResponse(ticket, projectRow).observations
              : [],
        };
      }),
    execute: () => Effect.succeed({ processRefs: [], observations: [] }),
    closeReceiver: () => Effect.void,
  };
  return { adapter, setService: (status: string) => void (state.service = status) };
};

/** A grant whose first round waits for the test, then verifies the one project as its owner. */
const heldVerifier = () => {
  const answers: Array<Deferred.Deferred<void>> = [];
  const verifier: AccessVerifier = {
    verifyRound: ({ round, report }) =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<void>();
        answers.push(answer);
        yield* Deferred.await(answer);
        yield* report({
          type: "ROUND_ACCOUNT",
          round,
          organizations: [{ organization, mutationsAllowed: true }],
          projects: [project],
        });
        yield* report({
          type: "ROUND_PROJECT",
          round,
          project,
          outcome: {
            kind: "verified",
            access: { project, role: "OWNER", mutationsAllowed: true },
          },
        });
      }),
    verifyProject: () => Effect.never,
  };
  return {
    verifier,
    rounds: () => answers.length,
    answer: () => Deferred.succeed(answers.at(-1)!, undefined),
  };
};

/** The device's keychain, as the session's storage adapter reaches it. */
const deviceStorage = (): ZeropsStorageAdapter => {
  const held = new Map<string, string>();
  return {
    get: async (key) => held.get(key) ?? null,
    set: async (key, value) => void held.set(key, value),
    remove: async (key) => void held.delete(key),
  };
};

/** Lets every fiber and promise the last step woke run to its next wait. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    yield* Effect.yieldNow;
  }
});

/**
 * The account runtime as mobile hosts it, over a device that remembers the Mate: its door admits
 * every exchange and the catalog registers what an install writes; every probe answers `probe`.
 */
const openMobileAccount = Effect.fnUntraced(function* (clock: DeadlineClock) {
  const registry = AtomRegistry.make();
  const place = platform();
  const grant = heldVerifier();
  const storage = deviceStorage();
  const remembered: RegistrationRecord = {
    targetKey: KEY,
    environmentId: ENVIRONMENT_ID,
    origin: ORIGIN,
    projectRef: { projectId: PROJECT_ID, orgId: ORGANIZATION_ID },
    name: "shop",
  };
  // An earlier session on this device connected the Mate.
  const earlier = yield* Effect.promise(() => loadAccountRecords(storage, USER_ID));
  earlier.setItem(REGISTRATION_RECORDS_KEY, JSON.stringify([remembered]));
  yield* settle;
  const records = yield* Effect.promise(() => loadAccountRecords(storage, USER_ID));

  const exchanges: Array<DoorRequest> = [];
  const retried: Array<EnvironmentId> = [];
  const probe: { answer: ProbeReading } = { answer: { kind: "unreachable" } };
  let catalog: CatalogListener | null = null;
  const ports: AccountEnvironmentPorts = {
    clock: {
      now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
      random: () => 0.5,
      setTimer: () => () => undefined,
    },
    door: {
      exchange: async (request) => {
        exchanges.push(request);
        return {
          ok: true,
          environmentId: ENVIRONMENT_ID,
          descriptor: ready(null).descriptor,
          credential: {
            install: async () => {
              catalog?.environments([{ environmentId: ENVIRONMENT_ID, origin: ORIGIN }]);
              return { ok: true };
            },
          },
        };
      },
      readDescriptor: () => new Promise(() => undefined),
      retryLink: (environmentId) => void retried.push(environmentId),
      remove: () => undefined,
    },
    probe: async () => probe.answer,
    intents: memoryIntents(),
    records,
    catalog: {
      listen: (listener) => {
        catalog = listener;
        return () => undefined;
      },
    },
    births: NO_BIRTHS,
  };
  const built = yield* Effect.gen(function* () {
    const data: ManagedZeropsDataRuntime = yield* makeZeropsDataRuntime({
      scope,
      adapter: place.adapter,
      atomRegistry: registry,
      makeOpaqueId: (() => {
        let next = 0;
        return () => `opaque-${++next}`;
      })(),
    });
    return yield* makeAccountRuntime({
      data,
      verifier: grant.verifier,
      signals: makePlatformSignals({
        hidden: () => false,
        online: () => true,
        now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
        listen: () => () => undefined,
      }),
      atomRegistry: registry,
      environments: ports,
    });
  }).pipe(Effect.provideService(Clock.Clock, clock));
  yield* Effect.addFinalizer(() => built.close("application-close"));
  // The picker's demand on the inventory, as `useZeropsCandidates` holds it.
  yield* built.data
    .acquire({ kind: "organization-inventory", organization })
    .pipe(Effect.provideService(Clock.Clock, clock));
  yield* built.data
    .acquire({ kind: "project-inventory", project })
    .pipe(Effect.provideService(Clock.Clock, clock));

  /** The Mate's row in the picker, as it reads the runtime's machines now. */
  const row = (environments: AccountEnvironments) => {
    const nowMs = clock.wallMs();
    const listing = mobileCandidates({
      organizations: [
        selectCandidates(
          knownProjectsOf(registry.get(built.data.reads.projectsOf(organization)), nowMs),
          (ref) => knownServicesOf(registry.get(built.data.reads.servicesOf(ref)), nowMs),
        ),
      ],
      machines: environments.machines(),
      nowMs,
    });
    const candidate = listing.state === "known" ? listing.value[0] : undefined;
    return candidate === undefined ? undefined : zeropsCandidatePresentation(candidate, nowMs);
  };

  /** The platform reports the service's status, and the account reads its inventory again. */
  const serviceStatus = (status: string) =>
    Effect.gen(function* () {
      place.setService(status);
      yield* built.invalidations
        .invalidate({ topic: "inventory", organization })
        .pipe(Effect.provideService(Clock.Clock, clock));
      yield* settle;
      yield* clock.advance(SECOND);
      yield* settle;
    });

  return {
    built,
    grant,
    exchanges,
    retried,
    probe,
    row,
    serviceStatus,
    catalog: () => catalog!,
  };
});

const ready = (initAt: string | null) => ({
  kind: "ready" as const,
  descriptor: {
    environmentId: ENVIRONMENT_ID,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok" as const,
    identityCheckedAt: null,
  },
  projectId: PROJECT_ID,
  initAt,
});

describe("a Mate on mobile", () => {
  it.effect("no exchange before the first grant on mobile", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const account = yield* openMobileAccount(clock);
        account.probe.answer = ready(null);
        yield* clock.advance(SECOND);
        yield* settle;

        // The remembered Mate is on the platform; the grant's first round is still out.
        expect(account.grant.rounds()).toBe(1);
        expect(account.exchanges).toEqual([]);

        yield* account.grant.answer();
        yield* settle;
        yield* clock.advance(SECOND);
        yield* settle;

        const { environments } = yield* account.built.postGrant;
        expect(account.exchanges.map(({ key, reason }) => ({ key, reason }))).toEqual([
          { key: KEY, reason: "restore" },
        ]);
        expect(environments.machines().get(KEY)?.credential.kind).toBe("held");
      }),
    ),
  );

  it.effect(
    "a mobile Mate restarting shows the container verdict and reconnects without a tap",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const account = yield* openMobileAccount(clock);
          account.probe.answer = ready("2026-09-23T09:00:00Z");
          yield* account.grant.answer();
          yield* settle;
          yield* clock.advance(SECOND);
          yield* settle;
          const { environments } = yield* account.built.postGrant;
          account.catalog().link(ENVIRONMENT_ID, { phase: "connected" });
          yield* settle;
          expect(account.row(environments)).toMatchObject({ label: "Connected", action: "Open" });

          // Zerops restarts the container: the socket drops and the Mate stops answering.
          yield* clock.advance(10 * SECOND);
          account.probe.answer = { kind: "unreachable" };
          yield* account.serviceStatus("RESTARTING");
          account.catalog().link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: null });
          yield* settle;

          expect(account.row(environments)).toMatchObject({
            label: "Restarting",
            notice: "Zerops is restarting this Mate.",
            action: null,
          });

          // The restart ends and the Mate answers again: its link is kicked with no one tapping.
          yield* clock.advance(20 * SECOND);
          account.probe.answer = ready("2026-09-23T10:00:30Z");
          yield* account.serviceStatus("ACTIVE");
          expect(account.retried).toEqual([ENVIRONMENT_ID]);
          account.catalog().link(ENVIRONMENT_ID, { phase: "connected" });
          yield* settle;

          expect(account.row(environments)).toMatchObject({ label: "Connected", action: "Open" });
          // The credential it held reconnected: no exchange beyond the restore, no Connect.
          expect(account.exchanges.map(({ reason }) => reason)).toEqual(["restore"]);
        }),
      ),
  );
});
