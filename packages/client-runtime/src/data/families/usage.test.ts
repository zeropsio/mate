import { describe, expect, it } from "vite-plus/test";

import { usageFamily, usageOwnerOf } from "./usage.ts";
import { usageHistoryFamily } from "./usageHistory.ts";

const decode = usageFamily.zeropsQuery!.decode;

describe("usageFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "reads one container's current use, keyed by the container",
      raw: {
        clientId: "org",
        projectId: "p1",
        serviceStackId: "s1",
        containerId: "c1",
        cpu: { used: 0, limit: 0 },
        vCpu: { used: 0.4, limit: 1 },
        ramGBytes: { used: 0.5, limit: 1 },
        diskGBytes: { used: 1, limit: 5 },
      },
      row: {
        id: "c1",
        version: null,
        value: {
          serviceId: "s1",
          containerId: "c1",
          cpu: { used: 0, limit: 0 },
          vCpu: { used: 0.4, limit: 1 },
          ramGBytes: { used: 0.5, limit: 1 },
          diskGBytes: { used: 1, limit: 5 },
        },
      },
    },
    {
      name: "keeps a figure the row leaves unsaid unsaid",
      raw: { serviceStackId: "s1", containerId: "c1", ramGBytes: { used: 0.5, limit: 1 } },
      row: {
        id: "c1",
        version: null,
        value: {
          serviceId: "s1",
          containerId: "c1",
          cpu: null,
          vCpu: null,
          ramGBytes: { used: 0.5, limit: 1 },
          diskGBytes: null,
        },
      },
    },
    { name: "refuses a row without its container", raw: { serviceStackId: "s1" }, row: null },
    { name: "refuses a row without its service", raw: { containerId: "c1" }, row: null },
    {
      name: "refuses a row whose figure is no pair",
      raw: { serviceStackId: "s1", containerId: "c1", cpu: { used: "x", limit: 1 } },
      row: null,
    },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });
});

describe("whose use is asked for", () => {
  it.each([
    { name: "usage", body: usageFamily.zeropsQuery!.body },
    { name: "usageHistory", body: usageHistoryFamily.zeropsQuery!.body },
  ])("$name asks in the project's own organization, whichever is shown", ({ body }) => {
    expect(body({ orgId: "shown", ownerId: usageOwnerOf("project-org", "p1") }).search).toEqual([
      { name: "clientId", operator: "eq", value: "project-org" },
      { name: "projectId", operator: "eq", value: "p1" },
    ]);
  });
});
