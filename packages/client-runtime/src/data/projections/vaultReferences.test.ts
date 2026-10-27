import { describe, expect, it } from "vite-plus/test";

import {
  parseRefs,
  readerState,
  readersOf,
  refsOf,
  valueIdOf,
  type RefService,
  type RefWorld,
} from "./vaultReferences.ts";

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

const world = (
  appService: RefService,
  shared: Record<string, string | null> = {},
  more: ReadonlyArray<RefService> = [],
): RefWorld => ({
  shared: new Map(Object.entries(shared)),
  sharedSystem: new Set(["zeropsSubdomainHost", "envIsolation"]),
  services: [appService, db, zcp, ...more],
});

const SHARED = { kind: "shared" } as const;
const APP = { kind: "service", serviceId: "s-app" } as const;
const DB = { kind: "service", serviceId: "s-db" } as const;

describe("parseRefs", () => {
  it.each([
    { template: "production", names: [] },
    { template: "${LOG_LEVEL}", names: ["LOG_LEVEL"] },
    {
      template: "postgres://${db_user}:${db_password}@${db_hostname}",
      names: ["db_user", "db_password", "db_hostname"],
    },
    { template: "https://${API_HOST}/v1 and ${API_HOST}", names: ["API_HOST", "API_HOST"] },
    { template: "$LOG_LEVEL ${} ${a b}", names: [] },
  ])("$template", ({ template, names }) => {
    expect(parseRefs(template)).toEqual(names);
  });
});

describe("refsOf, by the platform's precedence", () => {
  it.each<{
    readonly name: string;
    readonly world: RefWorld;
    readonly entry: string;
    readonly refs: unknown;
  }>([
    {
      name: "a name the service holds is its own value",
      world: world(app({ LOG: "${LOG_LEVEL}" }, { LOG_LEVEL: "debug" }), { LOG_LEVEL: "info" }),
      entry: "LOG",
      refs: [{ kind: "value", name: "LOG_LEVEL", scope: APP, key: "LOG_LEVEL" }],
    },
    {
      name: "else Shared's",
      world: world(app({ LOG: "${LOG_LEVEL}" }), { LOG_LEVEL: "info" }),
      entry: "LOG",
      refs: [{ kind: "value", name: "LOG_LEVEL", scope: SHARED, key: "LOG_LEVEL" }],
    },
    {
      name: "a rename resolves, sensitive too",
      world: world(app({ R: "${SECRET}" }), { SECRET: null }),
      entry: "R",
      refs: [{ kind: "value", name: "SECRET", scope: SHARED, key: "SECRET" }],
    },
    {
      name: "a run entry passes another one on",
      world: world(app({ R: "${SHARED_ONE}", R2: "${R}-x" }), { SHARED_ONE: "v" }),
      entry: "R2",
      refs: [{ kind: "entry", name: "R", key: "R" }],
    },
    {
      name: "an entry wins over the service's own value of its name",
      world: world(app({ R: "a", R2: "${R}" }, { R: "b" })),
      entry: "R2",
      refs: [{ kind: "entry", name: "R", key: "R" }],
    },
    {
      name: "another service's value by its hostname",
      world: world(app({ DB_PASS: "${db_password}", DB_URL: "${db_connectionString}" })),
      entry: "DB_PASS",
      refs: [{ kind: "value", name: "db_password", scope: DB, key: "password" }],
    },
    {
      name: "a hostname is split at its first underscore only",
      world: world(app({ X: "${db_BACKUP_PERIOD}" })),
      entry: "X",
      refs: [{ kind: "value", name: "db_BACKUP_PERIOD", scope: DB, key: "BACKUP_PERIOD" }],
    },
    {
      name: "a name with an underscore that names no service is looked up whole",
      world: world(app({ X: "${API_HOST}" }), { API_HOST: "h" }),
      entry: "X",
      refs: [{ kind: "value", name: "API_HOST", scope: SHARED, key: "API_HOST" }],
    },
    {
      name: "a platform name — the service's own, Shared's, or another service's",
      world: world(app({ H: "${hostname}", S: "${zeropsSubdomainHost}", O: "${db_projectId}" })),
      entry: "H",
      refs: [{ kind: "platform", name: "hostname" }],
    },
    {
      name: "Shared's platform-made names are platform",
      world: world(app({ S: "${zeropsSubdomainHost}" })),
      entry: "S",
      refs: [{ kind: "platform", name: "zeropsSubdomainHost" }],
    },
    {
      name: "another runtime's platform-made names are platform",
      world: world(app({ O: "${appdev_hostname}" })),
      entry: "O",
      refs: [{ kind: "platform", name: "appdev_hostname" }],
    },
    {
      name: "the Mate's own container is never a vault: what it has is platform",
      world: world(app({ T: "${zcp_ZCP_TOKEN}" })),
      entry: "T",
      refs: [{ kind: "platform", name: "zcp_ZCP_TOKEN" }],
    },
    {
      name: "KEY: ${KEY} is the literal text",
      world: world(app({ KEY: "${KEY}" }, { KEY: "v" }), { KEY: "w" }),
      entry: "KEY",
      refs: [{ kind: "self", name: "KEY" }],
    },
    {
      name: "and poisons every other entry that names KEY",
      world: world(app({ KEY: "${KEY}", OTHER: "x-${KEY}" }), { KEY: "w" }),
      entry: "OTHER",
      refs: [{ kind: "self", name: "KEY" }],
    },
    {
      name: "a name nothing has stays literal",
      world: world(app({ X: "${NOPE} ${db_nope}" })),
      entry: "X",
      refs: [
        { kind: "missing", name: "NOPE" },
        { kind: "missing", name: "db_nope" },
      ],
    },
    {
      name: "a template without references refers to nothing",
      world: world(app({ NODE_ENV: "production" })),
      entry: "NODE_ENV",
      refs: [],
    },
  ])("$name", ({ world: refWorld, entry, refs }) => {
    const appService = refWorld.services[0]!;
    expect(refsOf(refWorld, appService, entry)).toEqual(refs);
  });
});

describe("readersOf", () => {
  const readers = (refWorld: RefWorld) =>
    Object.fromEntries([...readersOf(refWorld)].map(([id, list]) => [id, list]));

  it.each<{ readonly name: string; readonly world: RefWorld; readonly readers: unknown }>([
    {
      name: "a value read directly, with the entries that read it",
      world: world(app({ LOG: "${LOG_LEVEL}", ALSO: "${LOG_LEVEL}" }), { LOG_LEVEL: "i" }),
      readers: {
        [valueIdOf(SHARED, "LOG_LEVEL")]: [
          { serviceId: "s-app", hostname: "appdev", via: ["ALSO", "LOG"] },
        ],
      },
    },
    {
      name: "through a chain of entries, every entry on it reading it",
      world: world(app({ R: "${SECRET}", R2: "${R}-x", R3: "${R2}" }), { SECRET: null }),
      readers: {
        [valueIdOf(SHARED, "SECRET")]: [
          { serviceId: "s-app", hostname: "appdev", via: ["R", "R2", "R3"] },
        ],
      },
    },
    {
      name: "through a plain value that references others",
      world: world(app({ URL: "${DATABASE_URL}" }), {
        DATABASE_URL: "postgres://${db_user}:${db_password}@db",
      }),
      readers: {
        [valueIdOf(SHARED, "DATABASE_URL")]: [
          { serviceId: "s-app", hostname: "appdev", via: ["URL"] },
        ],
        [valueIdOf(DB, "user")]: [{ serviceId: "s-app", hostname: "appdev", via: ["URL"] }],
        [valueIdOf(DB, "password")]: [{ serviceId: "s-app", hostname: "appdev", via: ["URL"] }],
      },
    },
    {
      name: "through another service's value, resolved where it lives",
      world: world(app({ URL: "${db_connectionString}" })),
      readers: Object.fromEntries(
        ["connectionString", "user", "password", "hostname", "port"].map((key) => [
          valueIdOf(DB, key),
          [{ serviceId: "s-app", hostname: "appdev", via: ["URL"] }],
        ]),
      ),
    },
    {
      name: "a shadowed Shared value is not read",
      world: world(app({ LOG: "${LOG_LEVEL}" }, { LOG_LEVEL: "d" }), { LOG_LEVEL: "i" }),
      readers: {
        [valueIdOf(APP, "LOG_LEVEL")]: [{ serviceId: "s-app", hostname: "appdev", via: ["LOG"] }],
      },
    },
    {
      name: "KEY: ${KEY} reads nothing, nor does what names it",
      world: world(app({ KEY: "${KEY}", OTHER: "${KEY}" }, { KEY: "v" }), { KEY: "w" }),
      readers: {},
    },
    {
      name: "a cycle ends",
      world: world(app({ A: "${B}", B: "${A}${LOG}" }), { LOG: "i", C: "${C}" }),
      readers: {
        [valueIdOf(SHARED, "LOG")]: [{ serviceId: "s-app", hostname: "appdev", via: ["A", "B"] }],
      },
    },
    {
      name: "only a runtime service reads",
      world: world(app({}), { X: "1" }, [
        service({
          serviceId: "s-api",
          hostname: "api",
          kind: "other",
          entries: new Map([["X", "${X}x"]]),
        }),
      ]),
      readers: {},
    },
  ])("$name", ({ world: refWorld, readers: expected }) => {
    expect(readers(refWorld)).toEqual(expected);
  });

  it("follows a chain no deeper than eight", () => {
    const entries: Record<string, string> = { E0: "${SECRET}" };
    for (let at = 1; at <= 12; at += 1) entries[`E${at}`] = `\${E${at - 1}}`;
    const via = readersOf(world(app(entries), { SECRET: null })).get(valueIdOf(SHARED, "SECRET"));
    expect(via?.[0]?.via).toContain("E8");
    expect(via?.[0]?.via).not.toContain("E9");
  });
});

describe("readerState", () => {
  it.each([
    { startedAt: "2026-10-07T12:00:00Z", changedAt: "2026-10-07T11:00:00Z", state: "live" },
    { startedAt: "2026-10-07T11:00:00Z", changedAt: "2026-10-07T12:00:00Z", state: "restart" },
    { startedAt: null, changedAt: "2026-10-07T12:00:00Z", state: "unknown" },
    { startedAt: "2026-10-07T11:00:00Z", changedAt: null, state: "unknown" },
  ] as const)(
    "started $startedAt, changed $changedAt: $state",
    ({ startedAt, changedAt, state }) => {
      expect(readerState(startedAt, changedAt)).toBe(state);
    },
  );
});
