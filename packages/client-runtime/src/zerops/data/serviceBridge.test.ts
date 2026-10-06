import { describe, expect, it } from "vite-plus/test";

import type { ProjectServices } from "../../data/projections/services.ts";
import { project } from "./__fixtures__/index.ts";
import { runtimeServicesRead, serviceRecordOf } from "./serviceBridge.ts";

const zcp = { id: "s1", projectId: project().projectId, name: "zcp", status: "ACTIVE" };

describe("serviceRecordOf", () => {
  it.each<{ readonly name: string; readonly row: object; readonly deployment: unknown }>([
    {
      name: "a row that says nothing of its version leaves the deployment unsaid",
      row: {},
      deployment: { knowledge: "unresolved" },
    },
    {
      name: "a row whose active version is null runs nothing",
      row: { activeAppVersion: null },
      deployment: { knowledge: "observed", fields: { activeDeploy: null } },
    },
    {
      name: "a version named only by its variables takes the name they give it",
      row: {
        activeAppVersion: { id: "v1", status: "ACTIVE", source: "GIT" },
        userData: [
          { key: "appVersionId", content: "v1" },
          { key: "appVersionName", content: "build 7" },
        ],
      },
      deployment: {
        knowledge: "observed",
        fields: { activeDeploy: { id: "v1", source: "GIT", name: "build 7" } },
      },
    },
  ])("$name", ({ row, deployment }) => {
    expect(serviceRecordOf(project(), { ...zcp, ...row }).deployment).toMatchObject(
      deployment as object,
    );
  });

  it("is the same record for the same value", () => {
    const value = { ...zcp };
    expect(serviceRecordOf(project(), value)).toBe(serviceRecordOf(project(), value));
  });
});

describe("runtimeServicesRead", () => {
  const read = (patch: Partial<ProjectServices>): ProjectServices => ({
    services: [zcp],
    live: true,
    reconnecting: false,
    ...patch,
  });
  it.each<{
    readonly name: string;
    readonly read: ProjectServices;
    readonly query: string;
    readonly interest: object;
  }>([
    {
      name: "the listing live: read whole, observing",
      read: read({}),
      query: "observed",
      interest: { status: "observing" },
    },
    {
      name: "not read yet: unresolved, establishing",
      read: read({ services: undefined, live: false }),
      query: "unresolved",
      interest: { status: "establishing" },
    },
    {
      name: "an outage: what was read stays, its retry coming",
      read: read({ live: false, reconnecting: true }),
      query: "observed",
      interest: { status: "failed", retryable: true },
    },
    {
      name: "refused: failed for good",
      read: read({ services: undefined, live: false, unavailableReason: "forbidden" }),
      query: "unresolved",
      interest: { status: "failed", retryable: false },
    },
  ])("$name", ({ read: services, query, interest }) => {
    const bridged = runtimeServicesRead(project(), services);
    expect(bridged.query.status).toBe(query);
    expect(bridged.observation.required[0]).toMatchObject(interest);
  });
});

describe("runtimeServicesRead, read again", () => {
  it("is the same read for the same listing value: a reader comparing by reference hears nothing new", () => {
    const listed: ProjectServices = { services: [zcp], live: true, reconnecting: false };
    expect(runtimeServicesRead(project(), listed)).toBe(runtimeServicesRead(project(), listed));
  });
});
