import { expect, it } from "vite-plus/test";

import { refsOf, type RefService, type RefWorld } from "./vaultReferences.ts";

const service = (
  patch: Partial<RefService> & Pick<RefService, "serviceId" | "hostname">,
): RefService => ({
  kind: "runtime",
  system: new Set(["hostname", "serviceId", "PATH"]),
  entries: new Map(),
  own: new Map(),
  ...patch,
});

const app = (entries: Record<string, string>, own: Record<string, string | null> = {}) =>
  service({
    serviceId: "s-app",
    hostname: "appdev",
    entries: new Map(Object.entries(entries)),
    own: new Map(Object.entries(own)),
  });

const db = service({
  serviceId: "s-db",
  hostname: "db",
  kind: "managed",
  system: new Set(["projectId", "serviceId"]),
  own: new Map<string, string | null>([
    ["password", null],
    ["user", "db"],
    ["port", "5432"],
    ["hostname", "db"],
    ["connectionString", "postgresql://${user}:${password}@${hostname}:${port}"],
    ["BACKUP_PERIOD", "daily"],
  ]),
});

const zcp = service({
  serviceId: "s-zcp",
  hostname: "zcp",
  kind: "other",
  own: new Map([["ZCP_TOKEN", null]]),
});

const world = (appService: RefService, shared: Record<string, string | null> = {}): RefWorld => ({
  shared: new Map(Object.entries(shared)),
  sharedSystem: new Set(["zeropsSubdomainHost", "envIsolation"]),
  services: [appService, db, zcp],
});

// witness: packages/client-runtime/src/data/projections/vaultReferences.ts | if (service.own.has(name)) → if (service.own.has(name) && !world.shared.has(name))
it("PJ57: A reference resolves to the service's own value of that name, else to Shared's", () => {
  const own = app({ LOG: "${LOG_LEVEL}" }, { LOG_LEVEL: "debug" });
  expect(refsOf(world(own, { LOG_LEVEL: "info" }), own, "LOG")).toEqual([
    {
      kind: "value",
      name: "LOG_LEVEL",
      scope: { kind: "service", serviceId: "s-app" },
      key: "LOG_LEVEL",
    },
  ]);
  const plain = app({ LOG: "${LOG_LEVEL}" });
  expect(refsOf(world(plain, { LOG_LEVEL: "info" }), plain, "LOG")).toEqual([
    { kind: "value", name: "LOG_LEVEL", scope: { kind: "shared" }, key: "LOG_LEVEL" },
  ]);
});
