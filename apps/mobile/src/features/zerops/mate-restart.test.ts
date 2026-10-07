/**
 * A Mate on mobile through the account runtime mobile hosts (DESIGN §7.5, A10): the account's
 * records over the device's storage, its intents in memory, and a door, a probe and a
 * connection catalog the test answers — and the picker's rows as they read the runtime's machines.
 */
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import {
  makeAccountRuntime,
  type AccountEnvironmentPorts,
  type CatalogListener,
  type DoorRequest,
} from "@t3tools/client-runtime/zerops/account/runtime";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  type AccountScope,
} from "@t3tools/client-runtime/zerops/data";
import { knownServices, type ProbeReading } from "@t3tools/client-runtime/zerops/environments";
import { makePlatformSignals } from "@t3tools/client-runtime/zerops/knowledge";
import { selectCandidates } from "@t3tools/client-runtime/zerops/projections";
import {
  makeDeadlineClock,
  mountRoster,
  type DeadlineClock,
} from "@t3tools/client-runtime/zerops/testing";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import {
  projectServicesAtom,
  servicesScope,
  shownMateLinksAtom,
} from "@t3tools/client-runtime/data";

import { hqAbsent, memoryIntents } from "./account-ports";
import { mobileCandidates } from "./candidate-listing";
import { openMateRoute, openMateScreen } from "./open-mate";
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
  return {
    projectRow,
    serviceRow,
    setService: (status: string) => void (state.service = status),
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
      // The Mate the record remembers answers where it kept it (A16).
      readDescriptor: async () => ready(null).descriptor,
      retryLink: (environmentId) => void retried.push(environmentId),
      remove: () => undefined,
      park: () => undefined,
      unpark: () => undefined,
    },
    probe: async () => ({
      reading: probe.answer,
      sentAt: { wall: clock.wallMs(), mono: clock.monoMs() },
    }),
    readInitAt: async () => null,
    intents: memoryIntents(),
    catalog: {
      listen: (listener) => {
        catalog = listener;
        // An earlier session on this device registered the Mate: the device's catalog keeps it.
        listener.environments([{ environmentId: ENVIRONMENT_ID, origin: ORIGIN }]);
        return () => undefined;
      },
    },
    route: openMateRoute,
    closeOffPending: { read: () => new Set(), subscribe: () => () => undefined },
    ...hqAbsent(),
  };
  // The organization's roster and services, as the account's store reads them.
  const store = mountRoster(registry, ORGANIZATION_ID, [place.projectRow], {
    services: [place.serviceRow()],
  });
  const built = yield* makeAccountRuntime({
    account: scope,
    signals: makePlatformSignals({
      hidden: () => false,
      online: () => true,
      now: () => ({ wall: clock.wallMs(), mono: clock.monoMs() }),
      listen: () => () => undefined,
    }),
    atomRegistry: registry,
    environments: ports,
    store,
  }).pipe(Effect.provideService(Clock.Clock, clock));
  built.environments.setActiveOrganization(ORGANIZATION_ID);
  yield* Effect.addFinalizer(() => built.close("application-close"));
  let serviceVersion = 1;

  /** The Mate's row in the picker, as it reads the runtime's machines now. */
  const row = () => {
    const nowMs = clock.wallMs();
    const listing = mobileCandidates({
      organizations: [
        selectCandidates(
          {
            state: "known",
            value: [place.projectRow],
            asOf: { ordinal: 0, atMs: nowMs },
            coverage: "complete",
            freshness: { kind: "live" },
          },
          () => knownServices(registry.get(projectServicesAtom(PROJECT_ID)), nowMs),
        ),
      ],
      machines: registry.get(shownMateLinksAtom).machines,
      nowMs,
    });
    const candidate = listing.state === "known" ? listing.value[0] : undefined;
    return candidate === undefined ? undefined : zeropsCandidatePresentation(candidate, nowMs);
  };

  /** The platform pushes the service's new status to the organization's services listing. */
  const serviceStatus = (status: string) =>
    Effect.gen(function* () {
      place.setService(status);
      serviceVersion += 1;
      store.dispatch({
        kind: "rows",
        scope: servicesScope(ORGANIZATION_ID),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "service",
            id: "service-a",
            value: place.serviceRow(),
            revision: { kind: "zerops", version: serviceVersion },
          },
        ],
      });
      yield* settle;
      yield* clock.advance(SECOND);
      yield* settle;
    });

  return {
    built,
    exchanges,
    retried,
    probe,
    row,
    serviceStatus,
    catalog: () => catalog!,
    /** Each Mate's environment machine, as the account's store holds it. */
    machines: () => registry.get(shownMateLinksAtom).machines,
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
  // A9 (krok-a-hub §3): a remembered Mate is parked until it is opened, on mobile too.
  it.effect("a remembered Mate on mobile connects when its screen is opened", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
        const account = yield* openMobileAccount(clock);
        account.probe.answer = ready(null);
        yield* settle;
        yield* clock.advance(SECOND);
        yield* settle;
        const { environments } = account.built;
        expect(account.exchanges).toEqual([]);

        const close = openMateScreen(environments, ENVIRONMENT_ID);
        yield* Effect.addFinalizer(() => Effect.sync(close));
        yield* settle;
        yield* clock.advance(SECOND);
        yield* settle;

        expect(account.exchanges.map(({ key, reason }) => ({ key, reason }))).toEqual([
          { key: KEY, reason: "restore" },
        ]);
        expect(account.machines().get(KEY)?.credential.kind).toBe("held");
      }),
    ),
  );

  it.effect(
    "a mobile Mate restarting shows the container verdict and reconnects without a tap",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
          const close = openMateScreen(null, ENVIRONMENT_ID);
          yield* Effect.addFinalizer(() => Effect.sync(close));
          const account = yield* openMobileAccount(clock);
          account.probe.answer = ready("2026-09-23T09:00:00Z");
          yield* settle;
          yield* clock.advance(SECOND);
          yield* settle;
          account.catalog().link(ENVIRONMENT_ID, { phase: "connected" });
          yield* settle;
          expect(account.row()).toMatchObject({ label: "Connected", action: "Open" });

          // Zerops restarts the container: the socket drops and the Mate stops answering.
          yield* clock.advance(10 * SECOND);
          account.probe.answer = { kind: "unreachable" };
          yield* account.serviceStatus("RESTARTING");
          account.catalog().link(ENVIRONMENT_ID, { phase: "backoff", retryAtMs: null });
          yield* settle;

          expect(account.row()).toMatchObject({
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

          expect(account.row()).toMatchObject({ label: "Connected", action: "Open" });
          // The credential it held reconnected: no exchange beyond the restore, no Connect.
          expect(account.exchanges.map(({ reason }) => reason)).toEqual(["restore"]);
        }),
      ),
  );
});
