import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { MateHealth } from "./mateHealth.ts";

const decodeHealth = Schema.decodeUnknownSync(MateHealth);

it.each([false, true])("decodes retained health with new memory evidence present=%s", (modern) => {
  const memory = {
    current: 2 * 1024 ** 3,
    high: 1.375 * 1024 ** 3,
    max: 3.375 * 1024 ** 3,
    events: { high: 2513, oom: 0, oomKill: 0, ...(modern ? { max: 7 } : {}) },
    growth: { high: 0, oom: 0, oomKill: 0, ...(modern ? { max: 1 } : {}) },
    swapCurrent: 200 * 1024 ** 2,
    swapMax: 512 * 1024 ** 2,
    pressure: {
      some: { avg10: 5, total: 3, ...(modern ? { avg60: 40, avg300: 40 } : {}) },
      full: { avg10: 1, total: 2, ...(modern ? { avg60: 10, avg300: 10 } : {}) },
    },
    ...(modern ? { swapGrowth: 1024 } : {}),
  };
  const value = {
    source: { environmentId: "rhea", epoch: 1, incarnation: "run", revision: 1 },
    sampledAt: "2026-10-08T08:00:00Z",
    evidence: {
      status: "strained",
      severity: "warning",
      resources: modern ? ["memory", "io"] : ["disk"],
      memory,
      cpu: null,
      io: { some: { avg10: 30, total: 300 }, full: { avg10: 24, total: 240 } },
      disk: { free: 1000, total: 2000 },
      unavailable: [],
    },
  };
  expect(decodeHealth(value)).toEqual(value);
});
