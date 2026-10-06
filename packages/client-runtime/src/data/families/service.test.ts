import { describe, expect, it } from "vite-plus/test";

import { zeropsNavigation } from "../demand.ts";
import { serviceFamily, servicesScope } from "./service.ts";

const decode = serviceFamily.zerops!.decode;

describe("serviceFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "keeps the whole row: its project, type, ports and running version",
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

  it("indexes each service under its project", () => {
    const index = serviceFamily.indexes!.find((entry) => entry.name === "serviceProject")!;
    expect(index.keyOf({ id: "s1", projectId: "p1", name: "db", status: "ACTIVE" }, "member")).toBe(
      "p1",
    );
  });
});
