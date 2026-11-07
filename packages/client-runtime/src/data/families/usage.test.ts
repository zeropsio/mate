import { describe, expect, it } from "vite-plus/test";

import { usageFamily, usageOwnerOf } from "./usage.ts";

const decode = usageFamily.zeropsQuery!.decode;

// Captured /current-stats/group-by-search row, topology.test.ts (2026-09-06).
const captured = {
  serviceStackId: "svc-core",
  containerId: "LVu1pkB8R2ayMzJ3yBMYsA",
  cpu: { limit: 0, used: 0 },
  vCpu: { limit: 1, used: 0.036 },
  ramGBytes: { limit: 0.375, used: 0.164 },
  diskGBytes: { limit: 1, used: 0.002 },
};

describe("usageFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "reads one container's current use, keyed by the container",
      raw: captured,
      row: {
        id: "LVu1pkB8R2ayMzJ3yBMYsA",
        version: null,
        value: {
          serviceId: "svc-core",
          containerId: "LVu1pkB8R2ayMzJ3yBMYsA",
          cpu: { used: 0, limit: 0 },
          vCpu: { used: 0.036, limit: 1 },
          ramGBytes: { used: 0.164, limit: 0.375 },
          diskGBytes: { used: 0.002, limit: 1 },
        },
      },
    },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });
});

describe("whose use is asked for", () => {
  it.each([{ name: "usage", body: usageFamily.zeropsQuery!.body }])(
    "$name asks in the project's own organization, whichever is shown",
    ({ body }) => {
      expect(body({ orgId: "shown", ownerId: usageOwnerOf("project-org", "p1") }).search).toEqual([
        { name: "clientId", operator: "eq", value: "project-org" },
        { name: "projectId", operator: "eq", value: "p1" },
      ]);
    },
  );
});
