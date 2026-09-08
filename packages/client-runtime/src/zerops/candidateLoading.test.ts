import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectZeropsCandidates } from "./candidateLoading.ts";
import type {
  CollectionRead,
  FacetAdmission,
  ProjectRecord,
  QueryCoverage,
  ServiceRecord,
} from "./data/types.ts";
import { ReadStartOrdinal, ReceiptOrdinal, queryKeyOf } from "./data/types.ts";
import { organization, project, service, stamp } from "./data/__fixtures__/index.ts";

const NO_CONNECTIONS = new Map<string, EnvironmentId>();
const admission: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};
const observation = { required: [], optional: [], access: { status: "unverified" as const } };

function projectRecord(id = "project-1"): ProjectRecord {
  const ref = project(id);
  return {
    ref,
    identity: {
      knowledge: "observed",
      fields: { name: id, createdAt: null },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    lifecycle: {
      knowledge: "observed",
      fields: { status: "ACTIVE" },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    presentation: {
      knowledge: "observed",
      fields: { tags: [], description: null },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    placement: {
      knowledge: "observed",
      fields: {
        publicZone: "fte2334ab.prg1-zerops.zone",
        zeropsSubdomainHost: "24cb",
        mode: "LIGHT",
      },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
  };
}

function serviceRecord(owner = project()): ServiceRecord {
  const ref = service("service-1", owner);
  return {
    ref,
    identity: {
      knowledge: "observed",
      fields: {
        hostname: "zcp",
        type: { versionName: "zcp@1", displayName: "Zerops Mate", category: "runtime" },
      },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    lifecycle: {
      knowledge: "observed",
      fields: { status: "ACTIVE", createdAt: null, updatedAt: null },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    routing: {
      knowledge: "observed",
      fields: {
        subdomainAccess: true,
        ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
      },
      unresolvedRequiredFields: [],
      source: "direct-read",
      stamp: stamp(1),
      admission,
    },
    deployment: {
      knowledge: "unresolved",
      fields: {},
      unresolvedRequiredFields: [],
      admission,
    },
    scaling: {
      knowledge: "unresolved",
      fields: {},
      unresolvedRequiredFields: [],
      admission,
    },
  };
}

function projectsRead(
  value: CollectionRead<ProjectRecord>["value"] = [],
  coverage: QueryCoverage = { kind: "none" },
): CollectionRead<ProjectRecord> {
  const descriptor = {
    kind: "projects-of-organization" as const,
    organization,
    statuses: [],
    schemaVersion: 1 as const,
  };
  const key = queryKeyOf(descriptor);
  const common = {
    descriptor,
    key,
    memberKeys: [],
    unresolvedMemberKeys: [],
    membershipOperations: new Map(),
    lastAppliedReadStartOrdinal: null,
  };
  return {
    value,
    observation,
    query:
      coverage.kind === "none" || coverage.kind === "partial"
        ? { ...common, status: "unresolved", coverage }
        : {
            ...common,
            status: "observed",
            coverage,
            observedTotal: value.length,
            source: "direct-read",
            stamp: stamp(1),
            lastAppliedReadStartOrdinal: ReadStartOrdinal.make(1),
          },
  };
}

function servicesRead(
  owner: ProjectRecord,
  value: CollectionRead<ServiceRecord>["value"] = [],
  coverage: QueryCoverage = { kind: "none" },
): CollectionRead<ServiceRecord> {
  const descriptor = {
    kind: "services-of-project" as const,
    project: owner.ref,
    schemaVersion: 1 as const,
  };
  const key = queryKeyOf(descriptor);
  const common = {
    descriptor,
    key,
    memberKeys: [],
    unresolvedMemberKeys: [],
    membershipOperations: new Map(),
    lastAppliedReadStartOrdinal: null,
  };
  return {
    value,
    observation,
    query:
      coverage.kind === "none" || coverage.kind === "partial"
        ? { ...common, status: "unresolved", coverage }
        : {
            ...common,
            status: "observed",
            coverage,
            observedTotal: value.length,
            source: "direct-read",
            stamp: stamp(1),
            lastAppliedReadStartOrdinal: ReadStartOrdinal.make(1),
          },
  };
}

const COMPLETE: QueryCoverage = {
  kind: "exhausted-traversal",
  traversedPages: 1,
  observedTotal: 0,
  guarantee: "non-atomic",
};

describe("projectZeropsCandidates", () => {
  it("preserves an unresolved project collection instead of fabricating complete emptiness", () => {
    const source = projectsRead();
    const result = projectZeropsCandidates(
      source,
      () => {
        throw new Error("no project should be visited");
      },
      NO_CONNECTIONS,
    );

    expect(result.projects).toBe(source);
    expect(result.projects.query.status).toBe("unresolved");
    expect(result.candidates).toEqual([]);
  });

  it("distinguishes partial empty from complete empty project coverage", () => {
    const partial = projectZeropsCandidates(
      projectsRead([], { kind: "partial", reason: "malformed" }),
      () => {
        throw new Error("no project should be visited");
      },
      NO_CONNECTIONS,
    );
    const complete = projectZeropsCandidates(
      projectsRead([], COMPLETE),
      () => {
        throw new Error("no project should be visited");
      },
      NO_CONNECTIONS,
    );

    expect(partial.projects.query.coverage).toEqual({ kind: "partial", reason: "malformed" });
    expect(complete.projects.query.status).toBe("observed");
    expect(complete.projects.query.coverage.kind).toBe("exhausted-traversal");
  });

  it("retains unavailable projects as unresolved candidate input", () => {
    const ref = project("forbidden");
    const unavailable = {
      knowledge: "unavailable" as const,
      ref,
      reason: "forbidden" as const,
      since: { receiptOrdinal: ReceiptOrdinal.make(1), observedAtMs: 1 },
    };
    const result = projectZeropsCandidates(
      projectsRead([unavailable], COMPLETE),
      () => {
        throw new Error("unavailable projects have no service read");
      },
      NO_CONNECTIONS,
    );

    expect(result.unresolvedProjects).toEqual([unavailable]);
    expect(result.candidates).toEqual([]);
  });

  it("exposes unresolved service membership without starting another fetch owner", () => {
    const record = projectRecord();
    const serviceSource = servicesRead(record);
    const result = projectZeropsCandidates(
      projectsRead([{ knowledge: "observed", record }], COMPLETE),
      () => serviceSource,
      NO_CONNECTIONS,
    );

    expect(result.unresolvedServiceProjects).toEqual([record]);
    expect(result.candidates).toMatchObject([{ group: "unavailable" }]);
  });

  it("does not claim a ready candidate while one service member is unresolved", () => {
    const record = projectRecord();
    const zcp = serviceRecord(record.ref);
    const unresolved = service("service-2", record.ref);
    const result = projectZeropsCandidates(
      projectsRead([{ knowledge: "observed", record }], COMPLETE),
      () =>
        servicesRead(
          record,
          [
            { knowledge: "observed", record: zcp },
            { knowledge: "unresolved", ref: unresolved },
          ],
          COMPLETE,
        ),
      NO_CONNECTIONS,
    );

    expect(result.unresolvedServiceProjects).toEqual([record]);
    expect(result.candidates).toMatchObject([{ group: "unavailable" }]);
  });

  it("derives a ready candidate from complete central project and service reads", () => {
    const record = projectRecord();
    const zcp = serviceRecord(record.ref);
    const result = projectZeropsCandidates(
      projectsRead([{ knowledge: "observed", record }], COMPLETE),
      () => servicesRead(record, [{ knowledge: "observed", record: zcp }], COMPLETE),
      NO_CONNECTIONS,
    );

    expect(result.candidates).toMatchObject([{ group: "ready", service: { id: "service-1" } }]);
    expect(result.unresolvedProjects).toEqual([]);
    expect(result.unresolvedServiceProjects).toEqual([]);
  });
});
