import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { makeMateAdapter } from "../../data/adapters/mate.ts";
import type { DetailDemand } from "../../data/demand.ts";
import { routeProjectScope } from "../../data/families/project.ts";
import { routeServicesScope } from "../../data/families/service.ts";
import { liveProjects, liveServices } from "../../data/__fixtures__/account.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import type { Row } from "../../data/reducer.ts";
import { makeAccountStore, type AccountStore } from "../../data/store.ts";
import { account } from "../data/__fixtures__/index.ts";
import type { ExchangeAnswer } from "../identityExchange.ts";
import {
  makeEnvironmentWiring,
  type AccountEnvironmentPorts,
  type DoorCredential,
  type DoorRequest,
} from "./environments.ts";

const ORG = "org-1";
const PROJECT = "project-1";
const ROUTE = EnvironmentId.make("env-route");
/** Where the zcp service below is served: its name, the project's subdomain host, its port. */
const ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";

const PROJECT_ROW = {
  id: PROJECT,
  clientId: ORG,
  name: "shop",
  status: "ACTIVE",
  tagList: [],
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
  mode: "LIGHT",
};
const ZCP = {
  id: "service-1",
  projectId: PROJECT,
  name: "zcp",
  status: "ACTIVE",
  serviceStackTypeInfo: {
    serviceStackTypeName: "Zerops Mate",
    serviceStackTypeVersionName: "zcp@1",
    serviceStackTypeCategory: "USER",
  },
  subdomainAccess: true,
  ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
};

/** One read ahead's answer committed, as the Zerops adapter commits it. */
const commitAhead = (
  store: AccountStore,
  scope: ReturnType<typeof routeProjectScope>,
  row: Row,
) => {
  store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
  store.dispatch({
    kind: "baseline-commit",
    scope,
    generation: 0,
    via: "zerops-read",
    members: [row.id],
    rows: [row],
  });
};

/**
 * The account stage over a store no listing has answered — the platform's socket still logging
 * in — with HQ's index naming the route's project: every detail it demands, and every exchange it
 * starts at a Mate's door, in order.
 */
function stage() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const events: Array<string> = [];
  const demanded: Array<DetailDemand> = [];
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG,
    demandDetail: (demand) => {
      demanded.push(demand);
      events.push(`demand ${demand.listing ?? demand.family}`);
      return () => events.push(`release ${demand.listing ?? demand.family}`);
    },
    renewHeld: () => undefined,
  });
  const exchanges: Array<DoorRequest> = [];
  const quiet = { subscribe: () => () => undefined };
  const ports: AccountEnvironmentPorts = {
    clock: {
      now: () => ({ wall: 0, mono: 0 }),
      random: () => 0.5,
      setTimer: () => () => undefined,
    },
    door: {
      exchange: (request) => {
        exchanges.push(request);
        events.push(`exchange ${request.origin}`);
        return new Promise<ExchangeAnswer<DoorCredential>>(() => undefined);
      },
      readDescriptor: () => new Promise(() => undefined),
      retryLink: () => undefined,
      remove: () => undefined,
      park: () => undefined,
      unpark: () => undefined,
    },
    probe: () => new Promise(() => undefined),
    readInitAt: async () => null,
    intents: { read: () => null, write: () => undefined },
    catalog: {
      listen: (listener) => {
        listener.environments([]);
        return () => undefined;
      },
    },
    route: () => ROUTE,
    hqIndex: {
      projectOf: (environmentId) => (environmentId === ROUTE ? PROJECT : null),
      ...quiet,
    },
    closeOff: { read: () => null, ...quiet },
    closeOffPending: { read: () => new Set(), ...quiet },
  };
  const wiring = makeEnvironmentWiring({
    ports,
    store,
    account,
    atomRegistry: registry,
    // The stage reads no invalidation: nothing here asks for one.
    invalidations: { invalidate: () => Effect.void, subscribe: Effect.never },
    hidden: false,
  });
  const started = wiring.start(makeMateAdapter(wiring.adapterPorts));
  started.environments.setActiveOrganization(ORG);
  started.environments.setRoute(ROUTE);
  return { store, events, demanded, exchanges, started };
}

describe("the route's Mate before the organization's listing", () => {
  it("the route's project is read ahead as soon as HQ names it, while no listing has answered", () => {
    const { demanded, started } = stage();

    expect(demanded).toEqual([
      { family: "project", listing: "route-project", ownerId: PROJECT },
      { family: "service", listing: "route-services", ownerId: PROJECT },
    ]);
    started.dispose();
  });

  it("the route's Mate is exchanged at its door from what was read ahead, before any listing answers", async () => {
    const { store, events, exchanges, started } = stage();

    commitAhead(store, routeProjectScope(ORG, PROJECT), {
      family: "project",
      id: PROJECT,
      value: PROJECT_ROW,
      revision: { kind: "zerops", version: null },
    } as Row);
    commitAhead(store, routeServicesScope(ORG, PROJECT), {
      family: "service",
      id: ZCP.id,
      value: ZCP,
      revision: { kind: "zerops", version: null },
    } as Row);
    await Promise.resolve();

    expect(
      exchanges.map(({ key, origin, projectId, organizationId }) => ({
        key,
        origin,
        projectId,
        organizationId,
      })),
    ).toEqual([
      { key: `${PROJECT}:${ZCP.id}`, origin: ORIGIN, projectId: PROJECT, organizationId: ORG },
    ]);
    expect(events.slice(0, 3)).toEqual([
      "demand route-project",
      "demand route-services",
      `exchange ${ORIGIN}`,
    ]);
    started.dispose();
  });

  it("once the listing reads the route's project itself, its reads ahead are let go and its Mate stays the one exchanged", async () => {
    const { store, events, exchanges, started } = stage();
    const readAhead = () => {
      commitAhead(store, routeProjectScope(ORG, PROJECT), {
        family: "project",
        id: PROJECT,
        value: PROJECT_ROW,
        revision: { kind: "zerops", version: null },
      } as Row);
      commitAhead(store, routeServicesScope(ORG, PROJECT), {
        family: "service",
        id: ZCP.id,
        value: ZCP,
        revision: { kind: "zerops", version: null },
      } as Row);
    };
    readAhead();
    await Promise.resolve();

    for (const input of [...liveProjects(ORG, [PROJECT_ROW]), ...liveServices(ORG, [ZCP])])
      store.dispatch(input);
    await Promise.resolve();

    expect(events).toEqual([
      "demand route-project",
      "demand route-services",
      `exchange ${ORIGIN}`,
      "release route-project",
      "release route-services",
    ]);
    expect(exchanges).toHaveLength(1);
    started.dispose();
  });
});
