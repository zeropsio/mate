import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { ServiceDeployInfo } from "../flow/deployment.ts";
import { deployed, record } from "../flow/__fixtures__/services.ts";
import type { StopService } from "../flow/deployment.ts";
import {
  liveServices,
  liveProjects,
  liveZerops,
  processValue,
  serviceValue,
  zeropsVersion,
} from "../../data/__fixtures__/account.ts";
import { runningScope } from "../../data/families/process.ts";
import { servicesScope } from "../../data/families/service.ts";
import { activeScope, versionScope } from "../../data/families/version.ts";
import { accountReadsAtom } from "../../data/reads.ts";
import { makeAccountStore, type AccountStore } from "../../data/store.ts";
import { makeStops } from "./stops.ts";

const ORG_ID = "org";
const STAGE = project("project-stage");

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

function rig() {
  const registry = AtomRegistry.make();
  const acquired: Array<string> = [];
  const store: AccountStore = makeAccountStore(registry);
  for (const input of liveProjects(ORG_ID, [{ id: STAGE.projectId }])) store.dispatch(input);
  let revision = 1;
  let listed = false;
  /** The versions held to be read by id now. */
  const readById = new Set<string>();
  /** The projects whose process history is held now. */
  const histories = new Set<string>();
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: ORG_ID,
    demandDetail: (demand) => {
      if (demand.family === "service") {
        acquired.push("services");
        return () => undefined;
      }
      if (demand.family === "process") {
        histories.add(demand.ownerId);
        return () => histories.delete(demand.ownerId);
      }
      if (demand.family !== "version") return () => undefined;
      readById.add(demand.ownerId);
      return () => readById.delete(demand.ownerId);
    },
    renewHeld: () => {},
  });
  const stops = makeStops(registry);
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
    readById: () => [...readById],
    histories: () => [...histories],
    services,
    app,
    list: (deploy: ServiceDeployInfo | null) => {
      if (!listed) {
        listed = true;
        for (const input of liveServices(ORG_ID, [
          { ...record("app-id", "app", deployed(deploy), { project: STAGE }) },
        ]))
          store.dispatch(input);
        return;
      }
      store.dispatch({
        kind: "rows",
        scope: servicesScope(ORG_ID),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "service",
            id: "app-id",
            value: record("app-id", "app", deployed(deploy), { project: STAGE }),
            revision: zeropsVersion(++revision),
          },
        ],
      });
    },
    dispatch: (inputs: ReadonlyArray<Parameters<AccountStore["dispatch"]>[0]>) => {
      for (const input of inputs) store.dispatch(input);
    },
  };
}

/** The app's row, running `v-new` from `source`, its variables naming the build `named` started. */
const serviceRow = (source: string | null, named: string) => ({
  kind: "rows" as const,
  scope: servicesScope(ORG_ID),
  generation: 1,
  method: "push" as const,
  via: "zerops-realtime" as const,
  rows: [
    {
      family: "service" as const,
      id: "app-id",
      value: serviceValue({
        id: "app-id",
        projectId: STAGE.projectId,
        activeAppVersion: { id: "v-new", ...(source === null ? {} : { source }) },
        userData: [
          { key: "appVersionId", content: named },
          { key: "appVersionName", content: "v0.2.0" },
        ],
      }),
      revision: zeropsVersion(10),
    },
  ],
});

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

  it("reads a version the active versions lack by id, and fails it once the platform has none", () => {
    const { stops, dispatch, list, app, readById } = rig();
    stops.demand(STAGE);
    dispatch(liveZerops({ running: [], active: [] }));
    list(PUSHED_BY_ID);
    expect(readById()).toEqual(["v-new"]);
    expect(app()).toMatchObject({ state: "unread" });

    const scope = versionScope(ORG_ID, "v-new");
    dispatch([
      { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
      { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
      {
        kind: "stream",
        key: scope,
        now: 0,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", message: "HTTP 400" },
        },
      },
    ]);
    expect(app()).toMatchObject({
      state: "failed",
      failure: { kind: "malformed", detail: "Its active version is not listed." },
    });
  });

  it("lets a version's read by id go once the active versions bring it", () => {
    const { stops, dispatch, list, readById } = rig();
    stops.demand(STAGE);
    dispatch(liveZerops({ running: [], active: [] }));
    list(PUSHED_BY_ID);
    expect(readById()).toEqual(["v-new"]);
    dispatch([versionRows({ id: "v-new", status: "ACTIVE", source: "GIT" })]);
    expect(readById()).toEqual([]);
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

  it("names a version by its service's own row, once the row's variables name it", () => {
    const { stops, dispatch, list, app } = rig();
    stops.demand(STAGE, "detail");
    dispatch(liveZerops({ running: [], active: [] }));
    list(PUSHED_BY_ID);
    dispatch([versionRows({ id: "v-new", status: "ACTIVE", source: "GIT" })]);
    expect(app()).toMatchObject({ value: { kind: "running" } });

    dispatch([serviceRow("GIT", "v-new")]);
    expect(app()).toMatchObject({ value: { kind: "running", version: { label: "v0.2.0" } } });
  });

  describe("what a service runs, its source stated", () => {
    const APP = service("app-id", STAGE);
    /** The organization's listing live, with the app's row running `v-new` from `source`. */
    const running = (source: string | null) => [
      ...liveZerops({ running: [], active: [], services: [] }),
      serviceRow(source, "v-new"),
    ];

    it("is unread until the services listing holds the service's row", () => {
      const { stops, registry } = rig();
      expect(registry.get(stops.version(APP))).toEqual({ state: "unread", waitingFor: null });
    });

    it("fails a service the read listing does not hold", () => {
      const { stops, registry, dispatch } = rig();
      dispatch(liveZerops({ running: [], active: [], services: [] }));
      expect(registry.get(stops.version(APP))).toMatchObject({
        state: "failed",
        failure: { kind: "refused", words: "The service is not there." },
      });
    });

    it("passes a version whose row stated its source through", () => {
      const { stops, registry, dispatch } = rig();
      dispatch(running("GIT"));
      expect(registry.get(stops.version(APP))).toMatchObject({ value: { source: "GIT" } });
    });

    it("leaves a version nameless whose row's variables name a build started since", () => {
      const { stops, registry, dispatch } = rig();
      dispatch([
        ...liveZerops({ running: [], active: [], services: [] }),
        serviceRow("GIT", "v-next"),
      ]);
      expect(registry.get(stops.version(APP))).toMatchObject({
        state: "known",
        value: { activeId: "v-new", source: "GIT", name: null },
      });
    });

    it("waits for the active versions to source a version the row left unstated", () => {
      const { stops, registry, dispatch } = rig();
      dispatch(running(null));
      expect(registry.get(stops.version(APP))).toEqual({ state: "unread", waitingFor: null });

      dispatch([versionRows({ id: "v-new", status: "ACTIVE", source: "NONE" })]);
      expect(registry.get(stops.version(APP))).toMatchObject({
        state: "known",
        value: { activeId: "v-new", source: "NONE", name: "v0.2.0" },
      });
    });

    it("reads the version by id while a surface holds it, and fails it when the platform has none", () => {
      const { stops, registry, dispatch, readById } = rig();
      dispatch(running(null));
      registry.get(stops.version(APP));
      expect(readById()).toEqual([]);
      const release = stops.holdVersions([APP]);
      expect(registry.get(stops.version(APP))).toEqual({ state: "unread", waitingFor: null });
      expect(readById()).toEqual(["v-new"]);
      const scope = versionScope(ORG_ID, "v-new");
      dispatch([
        { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
        { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
        {
          kind: "stream",
          key: scope,
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "definitive-refusal", message: "HTTP 400" },
          },
        },
      ]);
      expect(registry.get(stops.version(APP))).toMatchObject({
        state: "failed",
        failure: { detail: "Its active version is not listed." },
      });
      release();
      expect(readById()).toEqual([]);
    });

    it("fails a version the refused active versions will never source", () => {
      const { stops, registry, dispatch } = rig();
      dispatch([
        ...running(null),
        {
          kind: "stream",
          key: activeScope(ORG_ID),
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "authoritative-denial", message: "no" },
          },
        },
      ]);
      expect(registry.get(stops.version(APP))).toMatchObject({ state: "failed" });
    });
  });

  it("reads an opened stop's process history: what its earlier builds named its versions", () => {
    const { stops, histories } = rig();
    const summary = stops.demand(STAGE);
    expect(histories()).toEqual([]);
    const detail = stops.demand(STAGE, "detail");
    expect(histories()).toEqual([STAGE.projectId]);
    detail();
    expect(histories()).toEqual([]);
    summary();
  });

  it("reads the navigation services without a project detail demand and releases history independently", () => {
    const { stops, acquired, histories } = rig();
    const release = stops.demand(STAGE);
    const detail = stops.demand(STAGE, "detail");
    expect(acquired).toEqual([]);
    expect(histories()).toEqual([STAGE.projectId]);
    detail();
    expect(histories()).toEqual([]);
    release();
  });
});
