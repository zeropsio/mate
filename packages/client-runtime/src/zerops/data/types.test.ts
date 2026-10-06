import { describe, expect, it } from "@effect/vitest";

import {
  ZeropsAccountId,
  ZeropsApiOrigin,
  ZeropsContainerId,
  ZeropsOrganizationId,
  ZeropsProcessId,
  ZeropsProjectId,
  ZeropsServiceId,
  currentMetricKeyOf,
  entityKeyOf,
  historyBucketKeyOf,
  historySeriesKeyOf,
  makeZeropsApiOrigin,
  projectKeyOf,
  queryKeyOf,
  serviceKeyOf,
  type AccountRef,
  type OrganizationRef,
  type ProjectRef,
  type ProcessRef,
  type ServiceRef,
} from "./types.ts";

function account(origin = "https://api.example.test"): AccountRef {
  return {
    apiOrigin: makeZeropsApiOrigin(origin),
    accountId: ZeropsAccountId.make("account"),
  };
}

function organization(origin?: string): OrganizationRef {
  return {
    kind: "organization",
    account: account(origin),
    organizationId: ZeropsOrganizationId.make("organization"),
  };
}

function project(origin?: string): ProjectRef {
  return {
    kind: "project",
    organization: organization(origin),
    projectId: ZeropsProjectId.make("project"),
  };
}

describe("Zerops platform data identities", () => {
  it("normalizes API origins and rejects noncanonical branded construction", () => {
    expect(makeZeropsApiOrigin(" https://API.example.test:443/path?q=1 ")).toBe(
      "https://api.example.test",
    );
    expect(() => ZeropsApiOrigin.make("https://API.example.test:443/")).toThrow();
  });

  it("scopes the same source id by API origin, account and organization", () => {
    expect(projectKeyOf(project("https://eu.example.test"))).not.toBe(
      projectKeyOf(project("https://us.example.test")),
    );
  });

  it("does not collide when source ids contain separators", () => {
    const first: ServiceRef = {
      kind: "service",
      project: {
        ...project(),
        projectId: ZeropsProjectId.make("project/service"),
      },
      serviceId: ZeropsServiceId.make("leaf"),
    };
    const second: ServiceRef = {
      kind: "service",
      project: project(),
      serviceId: ZeropsServiceId.make("service/leaf"),
    };
    expect(serviceKeyOf(first)).not.toBe(serviceKeyOf(second));
  });

  it("does not collide across entity kinds sharing the same source id", () => {
    const service: ServiceRef = {
      kind: "service",
      project: project(),
      serviceId: ZeropsServiceId.make("same-id"),
    };
    const process: ProcessRef = {
      kind: "process",
      project: project(),
      processId: ZeropsProcessId.make("same-id"),
    };
    expect(entityKeyOf(service)).not.toBe(entityKeyOf(process));
  });

  it("keeps distinct history windows from sharing registrations", () => {
    const base = {
      kind: "metric-history-of-project" as const,
      project: project(),
      groupBy: "serviceStackId" as const,
      schemaVersion: 1 as const,
    };
    expect(
      queryKeyOf({
        ...base,
        window: { timeGroupBy: "1h", limit: 24, timeZone: "Europe/Prague" },
      }),
    ).not.toBe(
      queryKeyOf({
        ...base,
        window: { timeGroupBy: "1h", limit: 24, timeZone: "UTC" },
      }),
    );
  });

  it("keys metric series and corrected buckets by their complete declared identity", () => {
    const service: ServiceRef = {
      kind: "service",
      project: project(),
      serviceId: ZeropsServiceId.make("service"),
    };
    const current = {
      service,
      containerId: ZeropsContainerId.make("container"),
      groupBy: "containerId" as const,
      schemaVersion: 1 as const,
    };
    expect(currentMetricKeyOf(current)).not.toBe(
      currentMetricKeyOf({ ...current, containerId: ZeropsContainerId.make("other") }),
    );

    const series = {
      service,
      groupBy: "serviceStackId" as const,
      window: { timeGroupBy: "1h" as const, limit: 24, timeZone: "UTC" },
      schemaVersion: 1 as const,
    };
    expect(historySeriesKeyOf(series)).not.toBe(
      historySeriesKeyOf({ ...series, window: { ...series.window, timeZone: "Europe/Prague" } }),
    );
    expect(historyBucketKeyOf({ series, from: "a", till: "b" })).not.toBe(
      historyBucketKeyOf({ series, from: "b", till: "c" }),
    );
  });
});

it("keeps variables queries separate for different opened services", () => {
  const first = {
    kind: "service-variables-of-services" as const,
    organization: organization(),
    serviceIds: ["a"],
    keys: ["ZEROPS_MATE_ENABLED"],
    schemaVersion: 1 as const,
  };
  expect(queryKeyOf(first)).not.toBe(queryKeyOf({ ...first, serviceIds: ["b"] }));
});
