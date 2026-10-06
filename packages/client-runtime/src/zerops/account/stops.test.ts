import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { project } from "../data/__fixtures__/index.ts";
import type { ManagedZeropsDataRuntime } from "../data/runtime.ts";
import type {
  CollectionRead,
  LeaseAdmissionError,
  ServiceDeployInfo,
  ServiceRecord,
} from "../data/types.ts";
import type { Shown } from "../knowledge/known.ts";
import type { ZeropsServiceDeployedVersion } from "../data/deployedVersion.ts";
import { deployed, record, servicesRead } from "../flow/__fixtures__/services.ts";
import type { StopService } from "../flow/deployment.ts";
import { liveZerops, processValue, zeropsVersion } from "../../data/__fixtures__/account.ts";
import { runningScope } from "../../data/families/process.ts";
import { activeScope } from "../../data/families/version.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import { makeAccountStore, type AccountStore } from "../../data/store.ts";
import { makeStops } from "./stops.ts";

const ORG_ID = "org";
const STAGE = project("project-stage");
const NOW = 100_000;

/** What a native service frame states of a new active version: its id, status and times. */
const PUSHED_BY_ID: ServiceDeployInfo = {
  id: "v-new",
  status: "ACTIVE",
  source: null,
  activatedAt: "2026-10-05T12:00:00Z",
  name: null,
  branch: null,
  commit: null,
  tag: null,
  repository: null,
};

function rig(options: { readonly refuse?: LeaseAdmissionError["reason"] } = {}) {
  const registry = AtomRegistry.make();
  const listing = Atom.make<CollectionRead<ServiceRecord>>(
    servicesRead([], { coverage: { kind: "none" }, project: STAGE }),
  );
  const stated = Atom.make<Shown<ZeropsServiceDeployedVersion>>({
    state: "unread",
    waitingFor: null,
  });
  const acquired: Array<string> = [];
  const data = {
    reads: { servicesOf: () => listing, deployedVersion: () => stated },
    access: { clock: { currentTimeMillisUnsafe: () => NOW } },
    acquire: (descriptor: { readonly kind: string }) => {
      acquired.push(descriptor.kind);
      return options.refuse === undefined
        ? Effect.never
        : Effect.fail({
            _tag: "ZeropsLeaseAdmissionError",
            reason: options.refuse,
            message: "refused",
          } satisfies LeaseAdmissionError);
    },
  } as unknown as ManagedZeropsDataRuntime;
  const store: AccountStore = makeAccountStore(registry);
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG_ID,
    demandDetail: () => () => undefined,
  });
  const stops = makeStops(data, registry, Context.empty());
  const services = () => registry.get(stops.services(STAGE));
  const app = (): StopService["deployment"] | undefined => {
    const shown = services();
    return shown.state === "known" ? shown.value[0]?.deployment : undefined;
  };
  return {
    registry,
    stops,
    store,
    acquired,
    services,
    app,
    list: (deploy: ServiceDeployInfo | null) =>
      registry.set(
        listing,
        servicesRead([record("app-id", "app", deployed(deploy), { project: STAGE })], {
          project: STAGE,
        }),
      ),
    state: (value: Shown<ZeropsServiceDeployedVersion>) => registry.set(stated, value),
    dispatch: (inputs: ReadonlyArray<Parameters<AccountStore["dispatch"]>[0]>) => {
      for (const input of inputs) store.dispatch(input);
    },
  };
}

const versionRows = (...rows: ReadonlyArray<{ id: string; status: string; source: string }>) => ({
  kind: "rows" as const,
  scope: activeScope(ORG_ID),
  generation: 1,
  method: "push" as const,
  via: "zerops-realtime" as const,
  rows: rows.map((row, index) => ({
    family: "version" as const,
    id: row.id,
    value: { ...row, projectId: STAGE.projectId, serviceId: "app-id" },
    revision: zeropsVersion(10 + index),
  })),
});

/** Each push of a process a newer observation of it, as the platform's `_version` rises. */
let observation = 10;
const processRows = (...rows: ReadonlyArray<ReturnType<typeof processValue>>) => ({
  kind: "rows" as const,
  scope: runningScope(ORG_ID),
  generation: 1,
  method: "push" as const,
  via: "zerops-realtime" as const,
  rows: rows.map((value) => ({
    family: "process" as const,
    id: value.id,
    value,
    revision: zeropsVersion((observation += 1)),
  })),
});

const appBuild = (status: string) =>
  processValue({
    id: "build-1",
    projectId: STAGE.projectId,
    status,
    actionName: "stack.build",
    serviceStackIds: ["app-id"],
    created: "2026-10-05T11:59:00Z",
    appVersion: { id: "v-new", name: "3f9c1b2000000000000000000000000000000000" },
  });

describe("a stop's services as the account's store and listing say them", () => {
  it("reads nothing for a stop nobody demands", () => {
    const { services, list } = rig();
    list(PUSHED_BY_ID);
    expect(services()).toEqual({ state: "unread", waitingFor: null });
  });

  it("names a version a push stated only by id from the organization's active versions", () => {
    const { stops, dispatch, list, app } = rig();
    stops.demand(STAGE);
    dispatch(liveZerops({ running: [], active: [] }));
    list(PUSHED_BY_ID);
    expect(app()).toMatchObject({ state: "unread" });

    dispatch([versionRows({ id: "v-new", status: "ACTIVE", source: "GIT" })]);
    expect(app()).toMatchObject({ state: "known", value: { kind: "running" } });
  });

  it("keeps a runtime that ran nothing as none while its next no-code version is on its way", () => {
    const { stops, dispatch, list, app } = rig();
    stops.demand(STAGE);
    dispatch(
      liveZerops({
        running: [],
        active: [{ id: "v-old", serviceId: "app-id", projectId: STAGE.projectId, source: "NONE" }],
      }),
    );
    list(PUSHED_BY_ID);
    expect(app()).toMatchObject({
      state: "known",
      value: { kind: "none" },
      freshness: { kind: "revalidating" },
    });

    dispatch([
      versionRows(
        { id: "v-old", status: "BACKUP", source: "NONE" },
        { id: "v-new", status: "ACTIVE", source: "NONE" },
      ),
    ]);
    expect(app()).toMatchObject({
      state: "known",
      value: { kind: "none" },
      freshness: { kind: "live" },
    });
  });

  it("names the running version by its build after the build ended", () => {
    const { stops, dispatch, list, app } = rig();
    stops.demand(STAGE);
    dispatch(liveZerops({ running: [], active: [] }));
    list({ ...PUSHED_BY_ID, id: "v-old", source: "GIT", name: "v0.1.0" });
    dispatch([processRows(appBuild("RUNNING"))]);
    expect(app()).toMatchObject({ value: { kind: "deploying" } });

    dispatch([processRows(appBuild("FINISHED"))]);
    list(PUSHED_BY_ID);
    expect(app()).toMatchObject({
      value: { kind: "running", version: { label: "3f9c1b2" } },
    });
  });

  it.each([
    { status: "FAILED", reason: "Zerops reports its build failed" },
    { status: "CANCELED", reason: "Zerops reports its build was canceled" },
  ])("says a first build that ended $status deployed nothing", ({ status, reason }) => {
    const { stops, dispatch, list, app } = rig();
    stops.demand(STAGE);
    dispatch(liveZerops({ running: [], active: [] }));
    list(null);
    dispatch([processRows(appBuild("RUNNING"))]);
    expect(app()).toMatchObject({ value: { kind: "deploying" } });

    dispatch([processRows(appBuild(status))]);
    expect(app()).toMatchObject({
      value: { kind: "none", failedBuild: { processId: "build-1", reason } },
    });
  });

  it("waits in detail for the variables that name a version, and names it once they do", () => {
    const { stops, dispatch, list, app, state } = rig();
    stops.demand(STAGE, "detail");
    dispatch(liveZerops({ running: [], active: [] }));
    list(PUSHED_BY_ID);
    dispatch([versionRows({ id: "v-new", status: "ACTIVE", source: "GIT" })]);
    expect(app()).toMatchObject({ state: "unread" });

    state({
      state: "known",
      value: { activeId: "v-new", source: "GIT", name: "v0.2.0" },
      asOf: { ordinal: 1, atMs: NOW },
      coverage: "complete",
      freshness: { kind: "live" },
    });
    expect(app()).toMatchObject({ value: { kind: "running", version: { label: "v0.2.0" } } });
  });

  it("holds summary demand, and detail adds the project's topology", () => {
    const { stops, acquired } = rig();
    const release = stops.demand(STAGE);
    const detail = stops.demand(STAGE, "detail");
    expect(acquired).toEqual(["project-inventory", "project-topology"]);
    detail();
    expect(acquired).toEqual(["project-inventory", "project-topology", "project-inventory"]);
    release();
  });

  it("fails a stop whose demand the platform refused until a manual Again", () => {
    const { stops, services, dispatch, acquired } = rig({ refuse: "account-capacity" });
    stops.demand(STAGE);
    dispatch(liveZerops({ running: [], active: [] }));
    expect(services()).toMatchObject({
      state: "failed",
      failure: { kind: "refused", code: "account-capacity" },
      attempt: 1,
    });
    expect(acquired).toHaveLength(1);

    stops.again(STAGE);
    expect(acquired).toHaveLength(2);
    expect(services()).toMatchObject({ state: "failed", attempt: 2 });
  });
});
