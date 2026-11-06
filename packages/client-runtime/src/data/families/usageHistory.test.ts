import { describe, expect, it } from "vite-plus/test";

import { usageOwnerOf } from "./usage.ts";
import { usageHistoryFamily } from "./usageHistory.ts";

const decode = usageHistoryFamily.zeropsQuery!.decode;

// Captured /stats-history/group-by-search bucket, topology.test.ts (2026-09-06).
const captured = {
  from: "2026-09-06T00:00:00+02:00",
  till: "2026-09-06T00:59:59+02:00",
  serviceStackId: "svc-zcp",
  containerCount: 1,
  cpuLimit: 0,
  cpuUsed: 0,
  vCpuLimit: 2,
  vCpuUsed: 0.062,
  ramLimit: 2.75,
  ramUsed: 0.512,
  diskLimit: 2,
  diskUsed: 0.167,
};

describe("usageHistoryFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "reads one service's hour, keyed by the service and the hour",
      raw: captured,
      row: {
        id: "svc-zcp|2026-09-06T00:00:00+02:00|2026-09-06T00:59:59+02:00",
        version: null,
        value: {
          serviceStackId: "svc-zcp",
          from: "2026-09-06T00:00:00+02:00",
          till: "2026-09-06T00:59:59+02:00",
          containerCount: 1,
          cpuUsed: 0,
          cpuLimit: 0,
          vCpuUsed: 0.062,
          vCpuLimit: 2,
          ramUsed: 0.512,
          ramLimit: 2.75,
          diskUsed: 0.167,
          diskLimit: 2,
        },
      },
    },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });

  it("asks for the last day, by the hour, in the viewer's time zone", () => {
    const body = usageHistoryFamily.zeropsQuery!.body({
      orgId: "org",
      ownerId: usageOwnerOf("org", "p1"),
    });
    expect(body).toMatchObject({
      search: [
        { name: "clientId", operator: "eq", value: "org" },
        { name: "projectId", operator: "eq", value: "p1" },
      ],
      groupBy: "serviceStackId",
      timeGroupBy: "1h",
      limit: 24,
    });
    expect(typeof body.timeZone).toBe("string");
  });
});
