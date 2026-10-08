import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { zeropsNavigation } from "../demand.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { serviceFamily, servicesScope } from "./service.ts";

const decode = serviceFamily.zerops!.decode;

describe("serviceFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "keeps the whole row as it states it: its project, type, ports and running version",
      raw: {
        id: "s1",
        clientId: "org",
        projectId: "p1",
        name: "zcp",
        status: "ACTIVE",
        isSystem: false,
        subdomainAccess: true,
        ports: [{ port: 8080, protocol: "tcp", httpSupport: true }],
        serviceStackTypeInfo: {
          serviceStackTypeName: "zcp",
          serviceStackTypeVersionName: "zcp@1",
          serviceStackTypeCategory: "USER",
        },
        mode: null,
        created: "2026-10-05T18:49:08Z",
        _version: 4,
      },
      row: {
        id: "s1",
        version: 4,
        value: {
          id: "s1",
          clientId: "org",
          projectId: "p1",
          name: "zcp",
          status: "ACTIVE",
          isSystem: false,
          subdomainAccess: true,
          ports: [{ port: 8080, protocol: "tcp", httpSupport: true }],
          serviceStackTypeInfo: {
            serviceStackTypeName: "zcp",
            serviceStackTypeVersionName: "zcp@1",
            serviceStackTypeCategory: "USER",
          },
          mode: null,
          created: "2026-10-05T18:49:08Z",
        },
      },
    },
    {
      name: "orders by nothing without a version",
      raw: { id: "s1", projectId: "p1", name: "db", status: "STOPPED" },
      row: {
        id: "s1",
        version: null,
        value: { id: "s1", projectId: "p1", name: "db", status: "STOPPED" },
      },
    },
    {
      name: "refuses a row without its project",
      raw: { id: "s1", name: "db", status: "ACTIVE" },
      row: null,
    },
    {
      name: "refuses a row without its status",
      raw: { id: "s1", projectId: "p1", name: "db" },
      row: null,
    },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });
});

describe("services in the organization's navigation", () => {
  it("registers one pair for the whole organization, never one per project", () => {
    const services = zeropsNavigation("org").filter((entry) => entry.family === "service");
    expect(services).toEqual([
      {
        scope: servicesScope("org"),
        family: "service",
        role: "updates",
        path: "/service-stack/search",
        search: [{ name: "clientId", operator: "eq", value: "org" }],
      },
      {
        scope: servicesScope("org"),
        family: "service",
        role: "membership",
        path: "/service-stack/search",
        search: [{ name: "clientId", operator: "eq", value: "org" }],
      },
    ]);
  });

  it("asks the owner whether a service that left the listing is gone", () => {
    expect(serviceFamily.scope.leaving).toBe("absent-unverified");
    expect(serviceFamily.zerops?.verifyPath?.("s1")).toBe("/service-stack/s1");
    expect(serviceFamily.zerops?.organizationOf?.({ id: "s1", clientId: "org-b" })).toBe("org-b");
  });

  it("reads one service by its id while a screen demands it: its answer is the row", () => {
    const listing = serviceFamily.details!.find((detail) => detail.suffix === "service")!;
    expect(listing.zerops.path({ orgId: "org", ownerId: "s1" })).toBe("/service-stack/s1");
    expect(listing.zerops.items({ id: "s1", name: "zcp" })).toEqual([{ id: "s1", name: "zcp" }]);
    expect(listing.zerops.items(null)).toBeUndefined();
  });

  it("indexes each service under its project", () => {
    const index = serviceFamily.indexes!.find((entry) => entry.name === "serviceProject")!;
    expect(index.keyOf({ id: "s1", projectId: "p1", name: "db", status: "ACTIVE" }, "member")).toBe(
      "p1",
    );
  });
});

describe("a pushed service row", () => {
  it("folds into the held row: a push that names part of the row keeps the rest", () => {
    const live = liveZerops({
      running: [],
      projects: [{ id: "p1" }],
      services: [
        {
          id: "zcp",
          projectId: "p1",
          subdomainAccess: true,
          serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
        },
      ],
    });
    const state = [
      ...live,
      {
        kind: "rows",
        scope: servicesScope(ORG),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "service",
            id: "zcp",
            value: { id: "zcp", projectId: "p1", name: "zcp", status: "STOPPED" },
            revision: zeropsVersion(2),
          },
        ],
      } as AccountInput,
    ].reduce((current, input) => reduceAccount(current, input).state, emptyAccount);
    expect(readsOfState(state).fact("service", "zcp")).toMatchObject({
      kind: "known",
      value: {
        status: "STOPPED",
        subdomainAccess: true,
        serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
      },
    });
  });
});

describe("a service read by its id", () => {
  const read = (lastUpdate: string): AccountInput => ({
    kind: "rows",
    scope: servicesScope(ORG),
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: [
      {
        family: "service",
        id: "zcp",
        value: {
          id: "zcp",
          projectId: "p1",
          name: "zcp",
          status: "ACTIVE",
          subdomainAccess: true,
          lastUpdate,
        },
        revision: { kind: "zerops", version: null },
      },
    ],
  });
  const held = () =>
    liveZerops({
      running: [],
      projects: [{ id: "p1" }],
      services: [
        { id: "zcp", projectId: "p1", subdomainAccess: false, lastUpdate: "2026-10-02T12:01:40Z" },
      ],
    });

  it.each([
    {
      name: "updated after the row held: it replaces it",
      at: "2026-10-02T12:01:50Z",
      access: true,
    },
    {
      name: "no newer than the row held: it changes nothing",
      at: "2026-10-02T12:01:40Z",
      access: false,
    },
  ])("$name", ({ at, access }) => {
    const state = [...held(), read(at)].reduce(
      (current, input) => reduceAccount(current, input).state,
      emptyAccount,
    );
    expect(readsOfState(state).fact("service", "zcp")).toMatchObject({
      value: { subdomainAccess: access },
    });
  });
});

describe("a service row's variables", () => {
  it("keep only what surfaces read of them: every other variable is dropped at decode", () => {
    const row = decode({
      id: "s1",
      projectId: "p1",
      name: "app",
      status: "ACTIVE",
      userData: [
        { key: "appVersionId", content: "v1" },
        { key: "appVersionName", content: "build 7" },
        { key: "ZEROPS_YAML", content: "secret: hunter2" },
        { key: "DB_PASSWORD", content: "hunter2" },
      ],
    });
    expect(row?.value.userData).toEqual([
      { key: "appVersionId", content: "v1" },
      { key: "appVersionName", content: "build 7" },
    ]);
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });
});

it("stores only service evidence used by projections, including nested evidence and deploy labels", () => {
  const expected = {
    id: "app",
    projectId: "p1",
    clientId: "org",
    name: "app",
    status: "ACTIVE",
    ports: [{ port: 8080, scheme: "http", httpSupport: true }],
    serviceStackTypeInfo: { serviceStackTypeName: "nodejs", serviceStackTypeCategory: "USER" },
    activeAppVersion: {
      id: "v1",
      activationDate: "2026-10-01T12:00:00Z",
      githubIntegration: { commit: "abc", branchName: "main" },
      publicGitSource: { repositoryUrl: "https://example.test/app" },
    },
    currentAutoscaling: {
      verticalAutoscaling: { minResource: { memoryGBytes: 1 }, cpuMode: "SHARED" },
      horizontalAutoscaling: { minContainerCount: 1, maxContainerCount: 3 },
    },
    userData: [
      { key: "appVersionId", content: "v1" },
      { key: "appVersionName", content: "release" },
    ],
  };
  const row = decode({
    ...expected,
    _version: 7,
    buildConfig: "unneeded",
    customAutoscaling: { unused: true },
    ports: [{ ...expected.ports[0], internalMetadata: "unneeded" }],
    serviceStackTypeInfo: { ...expected.serviceStackTypeInfo, versions: ["unneeded"] },
    activeAppVersion: {
      ...expected.activeAppVersion,
      buildLog: "unneeded",
      githubIntegration: {
        ...expected.activeAppVersion.githubIntegration,
        webhookSecret: "unneeded",
      },
      publicGitSource: { ...expected.activeAppVersion.publicGitSource, credentials: "unneeded" },
    },
    currentAutoscaling: {
      ...expected.currentAutoscaling,
      verticalAutoscaling: {
        ...expected.currentAutoscaling.verticalAutoscaling,
        minResource: { memoryGBytes: 1, price: "unneeded" },
        metadata: "unneeded",
      },
      horizontalAutoscaling: {
        ...expected.currentAutoscaling.horizontalAutoscaling,
        metadata: "unneeded",
      },
    },
    userData: [...expected.userData, { key: "SECRET", content: "unneeded" }],
  });
  expect(row).toEqual({ id: "app", version: 7, value: expected });
});
