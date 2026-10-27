import { describe, expect, it } from "vite-plus/test";

import { usageOwnerOf } from "./usage.ts";
import { usageHistoryFamily } from "./usageHistory.ts";

const decode = usageHistoryFamily.zeropsQuery!.decode;

describe("usageHistoryFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "reads one service's hour, keyed by the service and the hour",
      raw: {
        projectId: "p1",
        serviceStackId: "s1",
        from: "2026-10-06T10:00:00Z",
        till: "2026-10-06T11:00:00Z",
        containerCount: 2,
        cpuUsed: 0,
        cpuLimit: 0,
        vCpuUsed: 0.5,
        vCpuLimit: 2,
        ramUsed: 1,
        ramLimit: 2,
        diskUsed: 3,
        diskLimit: 10,
      },
      row: {
        id: "s1|2026-10-06T10:00:00Z|2026-10-06T11:00:00Z",
        version: null,
        value: {
          serviceStackId: "s1",
          from: "2026-10-06T10:00:00Z",
          till: "2026-10-06T11:00:00Z",
          containerCount: 2,
          cpuUsed: 0,
          cpuLimit: 0,
          vCpuUsed: 0.5,
          vCpuLimit: 2,
          ramUsed: 1,
          ramLimit: 2,
          diskUsed: 3,
          diskLimit: 10,
        },
      },
    },
    {
      name: "keeps a figure the bucket leaves unsaid unsaid",
      raw: { serviceStackId: "s1", from: "a", till: "b" },
      row: { id: "s1|a|b", version: null, value: { serviceStackId: "s1", from: "a", till: "b" } },
    },
    {
      name: "refuses a bucket whose figure is no number",
      raw: { serviceStackId: "s1", from: "a", till: "b", ramUsed: null },
      row: null,
    },
    {
      name: "refuses a bucket without its hour",
      raw: { serviceStackId: "s1", from: "a" },
      row: null,
    },
    { name: "refuses a bucket without its service", raw: { from: "a", till: "b" }, row: null },
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
