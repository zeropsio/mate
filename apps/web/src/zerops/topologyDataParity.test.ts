import {
  DEFAULT_ZEROPS_DATA_POLICY,
  decodeEntityDirectResponse,
  decodeEntityQueryResponse,
  decodeMetricRead,
  decodeNativeFrame,
  makeInitialZeropsDataState,
  reduceZeropsDataState,
  selectHistory,
  selectActivity,
  selectProjectsOf,
  selectServicesOf,
  selectTopology,
  selectUsage,
  serviceRecordToZeropsService,
  type RegistrationRequest,
  ZeropsWireSubscriptionName,
  type ProtocolDecodeResult,
} from "@t3tools/client-runtime/zerops/data";
import type {
  ZeropsCurrentStat,
  ZeropsService,
  ZeropsStatHistoryItem,
} from "@t3tools/client-runtime/zerops";
import { projectTopology } from "@t3tools/client-runtime/zerops/topology";
import { readProjectProcesses } from "@t3tools/client-runtime/zerops/activity/dto";
import { getPipelineState } from "@t3tools/client-runtime/zerops/activity/pipelineState";
import { observe } from "@t3tools/client-runtime/zerops/activity/observe";
import { projectZeropsCandidates } from "@t3tools/client-runtime/zerops/candidateLoading";
import {
  derivePublicRoutes,
  derivePublicRouteOffers,
  summarizeEnvironmentServices,
} from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  desiredInterest,
  directTicket,
  entityRegistration,
  identity,
  project,
  process,
  scope,
  service,
  stamp,
} from "./__fixtures__/platformData";
import { projectTopologySnapshotFromRead } from "./useProjectTopology";
import { projectActivitySnapshotFromRead } from "./activity/useProjectActivity";

const owner = project();
const projectDto = {
  id: owner.projectId,
  clientId: owner.organization.organizationId,
  name: "Original topology",
  status: "ACTIVE",
  publicZone: "fte2334ab.prg1-zerops.zone",
  zeropsSubdomainHost: "project",
  tagList: ["custom", "mate:agent:Pia"],
  description: "Preserve user description",
  mode: "LIGHT",
};
const services: ReadonlyArray<ZeropsService> = [
  {
    id: "core",
    name: "core",
    status: "ACTIVE",
    isSystem: true,
    subdomainAccess: true,
    ports: [{ port: 8080, scheme: "http", protocol: "TCP" }],
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "core@2",
      serviceStackTypeCategory: "SYSTEM",
    },
  },
  {
    id: "zcp",
    name: "zcp",
    status: "ACTIVE",
    isSystem: false,
    subdomainAccess: true,
    ports: [{ port: 8080, scheme: "http", protocol: "TCP" }],
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "zcp@1",
      serviceStackTypeCategory: "USER",
    },
  },
  {
    id: "app",
    name: "weatherapp",
    status: "ACTIVE",
    isSystem: false,
    versionNumber: "v22.22.3",
    created: "2026-09-01T09:00:00Z",
    lastUpdate: "2026-09-08T09:00:00Z",
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: "nodejs@22",
      serviceStackTypeName: "Node.js 22",
      serviceStackTypeCategory: "USER",
    },
    subdomainAccess: true,
    ports: [{ port: 3000, protocol: "TCP", scheme: "http", httpSupport: true }],
    activeAppVersion: {
      source: "GIT",
      created: "2026-09-07T09:00:00Z",
      lastUpdate: "2026-09-08T09:00:00Z",
      name: "Weather",
      gitlabIntegration: {
        branchName: "main",
        commit: "abc123",
        repositoryFullName: "team/weather",
      },
    },
    currentAutoscaling: {
      verticalAutoscaling: {
        minResource: { cpuCoreCount: 1, memoryGBytes: 0.25, diskGBytes: 1 },
        maxResource: { cpuCoreCount: 4, memoryGBytes: 4, diskGBytes: 10 },
        cpuMode: "SHARED",
      },
      horizontalAutoscaling: { minContainerCount: 1, maxContainerCount: 2 },
    },
  },
];
const current: ReadonlyArray<ZeropsCurrentStat> = [
  {
    serviceStackId: "zcp",
    containerId: "zcp-1",
    cpu: { used: 0, limit: 0 },
    vCpu: { used: 0.076, limit: 2 },
    ramGBytes: { used: 1.2, limit: 2.75 },
    diskGBytes: { used: 0.5, limit: 2 },
  },
  {
    serviceStackId: "app",
    containerId: "app-1",
    cpu: { used: 0.5, limit: 1 },
    vCpu: { used: 0.25, limit: 2 },
    ramGBytes: { used: 0.1, limit: 0.25 },
    diskGBytes: { used: 0.2, limit: 1 },
  },
  {
    serviceStackId: "app",
    containerId: "app-2",
    vCpu: { used: 0.125, limit: 2 },
    ramGBytes: { used: 0.2, limit: 0.5 },
    diskGBytes: { used: 0.3, limit: 1 },
  },
];
const history: ReadonlyArray<ZeropsStatHistoryItem> = [1, 2].map((hour) => ({
  serviceStackId: "app",
  from: `2026-09-08T0${hour}:00:00Z`,
  till: `2026-09-08T0${hour + 1}:00:00Z`,
  containerCount: 2,
  cpuUsed: 0.5,
  cpuLimit: 1,
  vCpuUsed: hour / 4,
  vCpuLimit: 4,
  ramUsed: 0.3,
  ramLimit: 0.75,
  diskUsed: 0.5,
  diskLimit: 2,
}));
const window = { timeGroupBy: "1h" as const, limit: 24, timeZone: "UTC" };
const currentQuery = {
  kind: "current-metrics-of-project" as const,
  project: owner,
  groupBy: "containerId" as const,
  schemaVersion: 1 as const,
};
const historyQuery = {
  kind: "metric-history-of-project" as const,
  project: owner,
  groupBy: "serviceStackId" as const,
  window,
  schemaVersion: 1 as const,
};

function fixture() {
  const id = identity();
  let state = reduceZeropsDataState(
    makeInitialZeropsDataState(scope()),
    { kind: "interest-upserted", interest: desiredInterest(id) },
    DEFAULT_ZEROPS_DATA_POLICY,
  ).state;
  let ordinal = 1;
  const ingest = (decoded: ProtocolDecodeResult) => {
    expect(decoded.issues).toEqual([]);
    for (const input of decoded.observations) {
      state = reduceZeropsDataState(
        state,
        {
          kind: "observation",
          observation: { input, stamp: stamp(++ordinal), accessEvidence: null },
        },
        DEFAULT_ZEROPS_DATA_POLICY,
      ).state;
    }
  };
  ingest(decodeEntityDirectResponse(directTicket({ kind: "project", ref: owner }, id), projectDto));
  const query = { kind: "services-of-project" as const, project: owner, schemaVersion: 1 as const };
  ingest(
    decodeEntityQueryResponse(
      query,
      directTicket({ kind: "query", descriptor: query }, id),
      { list: services, totalCount: services.length },
      "direct-read",
    ),
  );
  const metrics = (items: ReadonlyArray<ZeropsCurrentStat>) =>
    ingest(
      decodeMetricRead(
        directTicket({ kind: "query", descriptor: currentQuery }, id, ++ordinal, ordinal),
        { items },
      ),
    );
  const past = (items: ReadonlyArray<ZeropsStatHistoryItem>) =>
    ingest(
      decodeMetricRead(
        directTicket({ kind: "query", descriptor: historyQuery }, id, ++ordinal, ordinal),
        { items },
      ),
    );
  const snapshot = () =>
    projectTopologySnapshotFromRead(
      selectTopology(state, owner),
      new Map(services.map(({ id }) => [id, selectUsage(state, service(id))])),
      new Map(
        services.map(({ id }) => [
          id,
          selectHistory(state, {
            service: service(id),
            groupBy: "serviceStackId",
            window,
            schemaVersion: 1,
          }),
        ]),
      ),
    ).view!;
  return { ingest, metrics, past, snapshot, id, state: () => state };
}

describe("original topology behavior through the central data pipeline", () => {
  it("preserves project tags and presentation plus public routes, offers and environment summaries", () => {
    const f = fixture();
    const readDtos = () =>
      selectServicesOf(f.state(), owner).value.flatMap((entry) => {
        if (entry.knowledge !== "observed") return [];
        const dto = serviceRecordToZeropsService(entry.record);
        return dto === null ? [] : [dto];
      });
    const dtos = readDtos();
    expect(derivePublicRoutes(projectDto, dtos)).toHaveLength(1);
    expect(derivePublicRoutes(projectDto, dtos)).toEqual(derivePublicRoutes(projectDto, services));
    expect(derivePublicRouteOffers(dtos)).toEqual(derivePublicRouteOffers(services));
    expect(summarizeEnvironmentServices(dtos)).toEqual(summarizeEnvironmentServices(services));
    const registration = entityRegistration("service", f.id);
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: registration.subscriptionName,
        data: {
          update: services.map(({ id }) => ({
            id,
            projectId: owner.projectId,
            subdomainAccess: false,
          })),
        },
      }),
      new Map([[registration.subscriptionName, registration]]),
    );
    expect(decoded.kind).toBe("observations");
    if (decoded.kind === "observations") f.ingest(decoded);
    expect(derivePublicRoutes(projectDto, readDtos())).toEqual([]);
    expect(derivePublicRouteOffers(readDtos())).toEqual([
      { service: "weatherapp", serviceId: "app", port: 3000 },
    ]);
  });
  it("retains the owning organization on candidates used for connecting and creating environments", () => {
    const f = fixture();
    const query = {
      kind: "projects-of-organization" as const,
      organization: owner.organization,
      statuses: [],
      schemaVersion: 1 as const,
    };
    f.ingest(
      decodeEntityQueryResponse(
        query,
        directTicket({ kind: "query", descriptor: query }, f.id, 50, 50),
        { list: [projectDto], totalCount: 1 },
        "direct-read",
      ),
    );
    const candidates = projectZeropsCandidates(
      selectProjectsOf(f.state(), owner.organization),
      (record) => selectServicesOf(f.state(), record.ref),
      new Map(),
    ).candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.project.clientId).toBe(projectDto.clientId);
    expect(candidates[0]?.project).toEqual(projectDto);
  });

  it.each(["BUILDING", "PREPARING_RUNTIME", "DEPLOYING", "ACTIVE", "FAILED", "CANCELLED"])(
    "preserves original process and pipeline fields for %s",
    (status) => {
      const f = fixture();
      const raw = {
        id: "build-process",
        projectId: owner.projectId,
        status: "RUNNING",
        actionName: "stack.deploy",
        created: "2026-09-08T09:00:00Z",
        serviceStackId: "app",
        serviceStacks: [{ id: "app" }, { id: "worker" }],
        started: "2026-09-08T09:00:01Z",
        appVersion: {
          id: "release-1",
          status,
          build: {
            pipelineStart: "2026-09-08T09:00:02Z",
            startDate: "2026-09-08T09:00:03Z",
            endDate: "2026-09-08T09:00:04Z",
            pipelineFinish: "2026-09-08T09:00:08Z",
            pipelineFailed: "2026-09-08T09:00:08Z",
            serviceStackId: "builder",
          },
          prepareCustomRuntime: {
            startDate: "2026-09-08T09:00:05Z",
            endDate: "2026-09-08T09:00:06Z",
            serviceStackId: "prepare",
          },
          activationDate: "2026-09-08T09:00:07Z",
        },
      };
      f.ingest(
        decodeEntityDirectResponse(
          directTicket({ kind: "process", ref: process(raw.id) }, f.id),
          raw,
        ),
      );
      const actual = projectActivitySnapshotFromRead(selectActivity(f.state(), owner)).processes;
      const expected = readProjectProcesses({ list: [raw] });
      expect(actual).toEqual(expected);
      expect(getPipelineState(actual?.[0]?.appVersion)).toEqual(
        getPipelineState(expected?.[0]?.appVersion),
      );
      expect(
        observe(
          {
            attributable: true,
            startedAtMs: 0,
            lastRead: {
              attribution: { stepSource: actual![0]!, chips: [], projectMismatch: false },
              atMs: 0,
            },
          },
          0,
        ),
      ).toMatchObject({
        observation: {
          buildLog: {
            buildServiceStackId: "builder",
            appVersionId: "release-1",
            fromIso: "2026-09-08T08:59:57.000Z",
          },
        },
      });
    },
  );
  it("hides system services even after a partial native update, without hiding zcp", () => {
    const f = fixture();
    const registration = entityRegistration("service", f.id);
    const decoded = decodeNativeFrame(
      JSON.stringify({
        type: "search",
        subscriptionName: registration.subscriptionName,
        data: {
          update: [{ id: "core", projectId: owner.projectId, name: "core", status: "ACTIVE" }],
        },
      }),
      new Map([[registration.subscriptionName, registration]]),
    );
    expect(decoded.kind).toBe("observations");
    if (decoded.kind === "observations") f.ingest(decoded);
    expect(f.snapshot().services.map((row) => row.serviceId)).toEqual(["zcp", "app"]);
  });

  it("preserves runtime version, deploy activation, routes and autoscaling", () => {
    const f = fixture();
    expect(f.snapshot().services.find((row) => row.serviceId === "app")).toEqual(
      projectTopology(projectDto, services, []).services.find((row) => row.serviceId === "app"),
    );
  });

  it("sums shared and dedicated CPU across containers like the original projection", () => {
    const f = fixture();
    f.metrics(current);
    for (const row of projectTopology(projectDto, services, [], current).services) {
      expect(
        f.snapshot().services.find((actual) => actual.serviceId === row.serviceId)?.usage,
      ).toEqual(row.usage);
    }
  });

  it("distinguishes an answered empty metric query from a pending read", () => {
    const f = fixture();
    expect(f.snapshot().usageRead).toBe(false);
    f.metrics([]);
    expect(f.snapshot().usageRead).toBe(true);
    expect(f.snapshot().services.every((row) => row.usage === undefined)).toBe(true);
  });

  it("restores hourly charts in chronological order and removes replaced history", () => {
    const f = fixture();
    f.past(history.toReversed());
    const expected = projectTopology(projectDto, services, [], undefined, history).services.find(
      (row) => row.serviceId === "app",
    )?.history;
    expect(f.snapshot().services.find((row) => row.serviceId === "app")?.history).toEqual(expected);
    f.past([history[1]!]);
    expect(f.snapshot().services.find((row) => row.serviceId === "app")?.history).toEqual(
      expected?.slice(1),
    );
    f.past([]);
    expect(f.snapshot().services.find((row) => row.serviceId === "app")?.history).toBeUndefined();
  });

  it("updates current usage and chart buckets from native messages without a second read", () => {
    const f = fixture();
    f.metrics(current);
    f.past(history);
    const currentRegistration: RegistrationRequest = {
      identity: f.id,
      subscriptionName: ZeropsWireSubscriptionName.make("current"),
      descriptor: { kind: "current-metrics", query: currentQuery },
      baselineTicket: {
        ...directTicket({ kind: "query", descriptor: currentQuery }, f.id),
        kind: "baseline",
        owner: { kind: "interest", identity: f.id },
      },
    };
    const historyRegistration: RegistrationRequest = {
      identity: f.id,
      subscriptionName: ZeropsWireSubscriptionName.make("history"),
      descriptor: { kind: "metric-history", query: historyQuery },
      baselineTicket: {
        ...directTicket({ kind: "query", descriptor: historyQuery }, f.id),
        kind: "history",
        owner: { kind: "interest", identity: f.id },
      },
    };
    const registry = new Map(
      [currentRegistration, historyRegistration].map((r) => [r.subscriptionName, r]),
    );
    const updated = [{ ...current[0]!, vCpu: { used: 0.5, limit: 3 } }];
    const corrected = { ...history[0]!, vCpuUsed: 1.5 };
    for (const frame of [
      {
        type: "search",
        subscriptionName: currentRegistration.subscriptionName,
        data: { items: updated },
      },
      {
        type: "search",
        subscriptionName: historyRegistration.subscriptionName,
        data: { update: [corrected] },
      },
    ]) {
      const decoded = decodeNativeFrame(JSON.stringify(frame), registry);
      expect(decoded.kind).toBe("observations");
      if (decoded.kind === "observations") f.ingest(decoded);
    }
    const expected = projectTopology(projectDto, services, [], updated, [corrected, history[1]!]);
    expect(f.snapshot().services).toEqual(expected.services);
  });
});
