// @effect-diagnostics nodeBuiltinImport:off -- supervisor protocol compatibility fixture.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { expect, it, vi } from "vite-plus/test";

it.each([
  {
    name: "legacy",
    reply: { error: "Error: Unknown PostgreSQL supervisor command: capabilities" },
    templates: false,
  },
  { name: "partial", reply: { capabilities: ["freeze"] }, templates: false },
  { name: "current", reply: { capabilities: ["freeze", "clone"] }, templates: true },
  { name: "refused", reply: { error: "refused" }, templates: undefined },
])(
  "negotiates $name supervisor capabilities without masking unrelated failures",
  async ({ reply, templates }) => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-protocol-"));
    const commands: string[] = [];
    const server = NodeNet.createServer((socket) => {
      const lines = NodeReadline.createInterface({ input: socket });
      lines.on("line", (command) => {
        commands.push(command);
        socket.write(
          `${JSON.stringify(command === "capabilities" ? reply : { url: command === "create" ? "postgres://test/database" : "" })}\n`,
        );
      });
      socket.on("close", () => lines.close());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(NodePath.join(home, "supervisor.sock"), resolve);
    });
    vi.stubEnv("MATE_TEST_PG_HOME", home);
    vi.resetModules();
    try {
      const { acquireTestPostgres } = await import("./test-postgres.ts");
      if (templates === undefined) {
        await expect(acquireTestPostgres()).rejects.toThrow("refused");
        expect(commands).toEqual(["own", "capabilities"]);
      } else {
        const owner = await acquireTestPostgres();
        try {
          expect(owner.supportsTemplates).toBe(templates);
          expect(await owner.createDatabase()).toBe("postgres://test/database");
        } finally {
          await owner.close();
        }
        expect(commands).toEqual(["own", "capabilities", "create", "release"]);
      }
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    name: "macOS keeps the shared cluster outside /tmp cleanup",
    platform: "darwin" as const,
    env: {},
    expected: "/Users/dev/Library/Caches/mate-test-pg",
  },
  {
    name: "Linux keeps the shared cluster in /tmp",
    platform: "linux" as const,
    env: {},
    expected: "/tmp/mate-test-pg-501",
  },
  {
    name: "an explicit MATE_TEST_PG_HOME wins on every platform",
    platform: "darwin" as const,
    env: { MATE_TEST_PG_HOME: "/work/pg" },
    expected: "/work/pg",
  },
])("$name", async ({ platform, env, expected }) => {
  const { choosePostgresHome } = await import("./test-postgres.ts");
  expect(
    choosePostgresHome({
      platform,
      env,
      homeDirectory: "/Users/dev",
      user: 501,
      ramdisk: undefined,
    }),
  ).toBe(expected);
});

it("A test database lives on the test RAM disk when it is mounted", async () => {
  const { choosePostgresHome } = await import("./test-postgres.ts");
  const home = (platform: NodeJS.Platform, env: Record<string, string>) =>
    choosePostgresHome({
      platform,
      env,
      homeDirectory: "/Users/dev",
      user: 501,
      ramdisk: "/Volumes/mate-test",
    });
  expect(home("darwin", {})).toBe("/Volumes/mate-test/mate-test-pg-501");
  expect(home("linux", {})).toBe("/Volumes/mate-test/mate-test-pg-501");
  expect(home("darwin", { MATE_TEST_PG_HOME: "/work/pg" })).toBe("/work/pg");
});

it("re-initialises a cluster directory whose PG_VERSION is gone and says why", async () => {
  const { prepareClusterDirectory } = await import("./test-postgres.ts");
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-broken-"));
  try {
    const healthy = NodePath.join(home, "healthy");
    NodeFS.mkdirSync(healthy);
    NodeFS.writeFileSync(NodePath.join(healthy, "PG_VERSION"), "17\n");
    const broken = NodePath.join(home, "broken");
    NodeFS.mkdirSync(NodePath.join(broken, "base"), { recursive: true });
    const missing = NodePath.join(home, "missing");
    const notices: string[] = [];
    const report = (line: string) => notices.push(line);

    expect([healthy, broken, missing].map((data) => prepareClusterDirectory(data, report))).toEqual(
      ["reuse", "initialise", "initialise"],
    );
    expect(NodeFS.existsSync(broken)).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(healthy, "PG_VERSION"))).toBe(true);
    expect(notices).toEqual([
      `PostgreSQL test cluster ${broken} has no PG_VERSION (likely removed by temporary-file cleanup); re-initialising it.`,
    ]);
  } finally {
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

const writeCluster = (data: string, marker: string) => {
  NodeFS.mkdirSync(data, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(data, "PG_VERSION"), "17\n");
  NodeFS.writeFileSync(NodePath.join(data, marker), "");
};
const redoPanic = new Error(
  "pg_ctl failed: \n\npg_ctl: could not start server\n2026-10-24 09:00:00 LOG:  redo starts at 21/AD000000\n2026-10-24 09:00:01 PANIC:  failed to add new item\n2026-10-24 09:00:01 LOG:  startup process (PID 7) was terminated by signal 6: Abort trap",
);

it.each([
  {
    name: "a cluster whose WAL redo panics is moved aside and recreated at once",
    starts: [redoPanic, undefined],
    postmaster: undefined,
    outcome: "started",
    calls: ["start", "initialise", "start"],
    cluster: "fresh",
    notices: [
      "PostgreSQL test cluster {data} could not start (2026-10-24 09:00:01 PANIC:  failed to add new item); moved it aside to {data}.unstartable, removing it and re-initialising.",
    ],
  },
  {
    name: "a cluster that starts is reused untouched",
    starts: [undefined],
    postmaster: undefined,
    outcome: "started",
    calls: ["start"],
    cluster: "old",
    notices: [],
  },
  {
    name: "a failed start whose postmaster still runs is no unstartable cluster and is kept",
    starts: [redoPanic],
    postmaster: 4242,
    outcome: "failed",
    calls: ["start"],
    cluster: "old",
    notices: [],
  },
  {
    name: "a recreated cluster that cannot start either fails the run once",
    starts: [redoPanic, new Error("pg_ctl failed: could not bind IPv4 address")],
    postmaster: undefined,
    outcome: "failed",
    calls: ["start", "initialise", "start"],
    cluster: "fresh",
    notices: [
      "PostgreSQL test cluster {data} could not start (2026-10-24 09:00:01 PANIC:  failed to add new item); moved it aside to {data}.unstartable, removing it and re-initialising.",
    ],
  },
])("$name", async ({ starts, postmaster, outcome, calls, cluster, notices }) => {
  const { startCluster } = await import("./test-postgres.ts");
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-heal-"));
  try {
    const data = NodePath.join(home, "data");
    writeCluster(data, "old");
    if (postmaster !== undefined)
      NodeFS.writeFileSync(NodePath.join(data, "postmaster.pid"), `${postmaster}\n${data}\n`);
    const seen: string[] = [];
    const reported: string[] = [];
    const run = () =>
      startCluster(data, {
        initialise: () => {
          seen.push("initialise");
          writeCluster(data, "fresh");
        },
        start: () => {
          seen.push("start");
          const failure = starts.shift();
          if (failure) throw failure;
        },
        report: (line) => reported.push(line),
        alive: (pid) => pid === 4242,
      });
    if (outcome === "started") run();
    else expect(run).toThrow("pg_ctl failed");
    expect(seen).toEqual(calls);
    expect(NodeFS.existsSync(NodePath.join(data, cluster))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(data, cluster === "old" ? "fresh" : "old"))).toBe(false);
    expect(NodeFS.existsSync(`${data}.unstartable`)).toBe(false);
    expect(reported).toEqual(notices.map((line) => line.replaceAll("{data}", data)));
  } finally {
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

/** Catalog entries live in the disposable directory; initdb only adds its own entries. */
function catalog(left: { databases: [number, string][]; roles: [number, string][] }) {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-catalog-"));
  const data = NodePath.join(home, "data");
  const own = {
    databases: [
      [1, "template1"],
      [4, "template0"],
      [5, "postgres"],
    ] as [number, string][],
    roles: [
      [10, "postgres"],
      [3373, "pg_monitor"],
    ] as [number, string][],
  };
  const write = (kind: "databases" | "roles", entries: [number, string][]) => {
    NodeFS.mkdirSync(NodePath.join(data, kind), { recursive: true });
    for (const [oid, name] of entries)
      NodeFS.writeFileSync(NodePath.join(data, kind, String(oid)), name);
  };
  const read = (kind: "databases" | "roles") =>
    new Map(
      NodeFS.readdirSync(NodePath.join(data, kind))
        .map(
          (oid) =>
            [Number(oid), NodeFS.readFileSync(NodePath.join(data, kind, oid), "utf8")] as const,
        )
        .sort(([a], [b]) => a - b),
    );
  NodeFS.mkdirSync(data);
  NodeFS.writeFileSync(NodePath.join(data, "PG_VERSION"), "17\n");
  for (const kind of ["databases", "roles"] as const) write(kind, [...own[kind], ...left[kind]]);
  return {
    data,
    initialise: () => {
      for (const kind of ["databases", "roles"] as const) write(kind, own[kind]);
    },
    get databases() {
      return read("databases");
    },
    get roles() {
      return read("roles");
    },
    [Symbol.dispose]: () => NodeFS.rmSync(home, { recursive: true, force: true }),
  };
}

it("a killed supervisor's lease databases are dropped when the next one starts", async () => {
  const { startCluster } = await import("./test-postgres.ts");
  using cluster = catalog({
    databases: [
      [70001, "mate_test_0a1b"],
      [70002, "mate_test_ff00"],
    ],
    roles: [],
  });
  startCluster(cluster.data, {
    initialise: cluster.initialise,
    start: () => {},
    report: () => {},
    discardRetained: true,
  });
  expect([...cluster.databases.values()]).toEqual(["template1", "template0", "postgres"]);
});

it.each([
  {
    left: "its lease's databases",
    databases: [[70001, "mate_test_0a1b"]] as [number, string][],
    roles: [] as [number, string][],
  },
  {
    left: "a database it made beside its lease",
    databases: [[70002, "hq_test_0f36"]] as [number, string][],
    roles: [] as [number, string][],
  },
  {
    left: "the roles of a database it made",
    databases: [[70003, "mate_test_ff00"]] as [number, string][],
    roles: [
      [70004, "mate_test_ff00_runtime"],
      [70005, "mate_test_ff00_catalogue"],
    ] as [number, string][],
  },
  {
    left: "roles named apart from any database",
    databases: [] as [number, string][],
    roles: [
      [70006, "hq_runtime_9c2a"],
      [70007, "hq_catalogue_9c2a"],
    ] as [number, string][],
  },
  {
    left: "a database whose name needs quoting",
    databases: [[70008, '"Weird; DROP x"']] as [number, string][],
    roles: [] as [number, string][],
  },
])(
  "A test run reclaims the databases a killed run left behind: $left, keeping initdb's own",
  async ({ databases, roles }) => {
    const { startCluster } = await import("./test-postgres.ts");
    using cluster = catalog({ databases, roles });
    startCluster(cluster.data, {
      initialise: cluster.initialise,
      start: () => {},
      report: () => {},
      discardRetained: true,
    });
    expect([[...cluster.databases.values()], [...cluster.roles.values()]]).toEqual([
      ["template1", "template0", "postgres"],
      ["postgres", "pg_monitor"],
    ]);
  },
);

it("a later run removes test PostgreSQL homes unused for a day unless a postmaster still runs on them", async () => {
  const { pruneStaleClusters } = await import("./test-postgres.ts");
  const parent = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-prune-"));
  try {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const hours = (count: number) => (now - count * 60 * 60 * 1000) / 1000;
    const home = (name: string, idleHours: number, postmaster?: number) => {
      const path = NodePath.join(parent, name);
      writeCluster(NodePath.join(path, "data"), "base");
      NodeFS.writeFileSync(NodePath.join(path, "postgres.log"), "");
      if (postmaster !== undefined)
        NodeFS.writeFileSync(
          NodePath.join(path, "data", "postmaster.pid"),
          `${postmaster}\n${path}\n`,
        );
      for (const entry of ["data", "postgres.log", "."])
        NodeFS.utimesSync(NodePath.join(path, entry), hours(idleHours), hours(idleHours));
      return path;
    };
    const self = home("mate-test-pg-501", 48);
    home("mate-test-pg-501-0a1b2c3d4e5f", 25);
    home("mate-test-pg-501-111111111111", 25, 4242);
    home("mate-test-pg-501-222222222222", 25, 4343);
    home("mate-test-pg-501-333333333333", 23);
    home("another-cache", 72);
    const reported: string[] = [];

    pruneStaleClusters({
      home: self,
      now,
      alive: (pid) => pid === 4242,
      report: (line) => reported.push(line),
    });

    expect(NodeFS.readdirSync(parent).toSorted()).toEqual([
      "another-cache",
      "mate-test-pg-501",
      "mate-test-pg-501-111111111111",
      "mate-test-pg-501-333333333333",
    ]);
    expect(reported).toEqual(
      ["mate-test-pg-501-0a1b2c3d4e5f", "mate-test-pg-501-222222222222"].map(
        (name) =>
          `Removed test PostgreSQL home ${NodePath.join(parent, name)}: unused for over 24 h and no postmaster runs on it.`,
      ),
    );
  } finally {
    NodeFS.rmSync(parent, { recursive: true, force: true });
  }
});

/** Taking server.lock is the kernel's receipt that the supervisor's guard stopped PostgreSQL. */
const guardStopped = (home: string) =>
  new Promise<void>((resolve, reject) => {
    const probe = NodeChildProcess.spawn(
      "flock",
      ["-x", NodePath.join(home, "server.lock"), "true"],
      { stdio: "ignore" },
    );
    probe.once("error", reject);
    probe.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`flock exited ${String(code)}`)),
    );
  });

const exitedPid = () =>
  new Promise<number>((resolve, reject) => {
    const child = NodeChildProcess.spawn("true");
    child.once("error", reject);
    child.once("exit", () => resolve(child.pid!));
  });

/** A home whose PostgreSQL binaries are fake-postgres.ts behind initdb, pg_ctl, postgres and psql. */
function fakeCluster() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-rebuild-"));
  const home = NodePath.join(root, "home");
  const bin = NodePath.join(root, "bin");
  const data = NodePath.join(home, "data");
  NodeFS.mkdirSync(bin, { recursive: true });
  const fixture = NodePath.join(import.meta.dirname, "fixtures/fake-postgres.ts");
  for (const command of ["initdb", "pg_ctl", "postgres", "psql"])
    NodeFS.writeFileSync(
      NodePath.join(bin, command),
      `#!/bin/sh\nexec "${process.execPath}" "${fixture}" ${command} "$@"\n`,
      { mode: 0o755 },
    );
  // A cluster a crashed run left: its own catalog plus a database a run made beside its lease.
  NodeFS.mkdirSync(NodePath.join(data, "base", "hq_test_leftover"), { recursive: true });
  NodeFS.mkdirSync(NodePath.join(data, "global"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(data, "PG_VERSION"), "17\n");
  NodeFS.writeFileSync(NodePath.join(data, "global", "pg_control"), "valid");
  return { root, home, bin, data };
}

it("Decision: A test PostgreSQL supervisor that starts with no surviving leases rebuilds its disposable cluster once instead of dropping retained databases one by one", async () => {
  const cluster = fakeCluster();
  const commands = NodePath.join(cluster.home, "commands.log");
  for (let i = 0; i < 34; i++)
    NodeFS.mkdirSync(NodePath.join(cluster.data, "base", `retained_${i}`));
  for (const command of ["initdb", "pg_ctl", "psql"]) {
    const path = NodePath.join(cluster.bin, command);
    const wrapper = NodeFS.readFileSync(path, "utf8");
    NodeFS.writeFileSync(
      path,
      wrapper.replace("exec ", `printf '%s\\n' '${command}' "$@" >> "${commands}"\nexec `),
    );
  }
  vi.stubEnv("MATE_TEST_PG_HOME", cluster.home);
  vi.stubEnv("MATE_PG_BIN", cluster.bin);
  vi.resetModules();
  try {
    const { acquireTestPostgres } = await import("./test-postgres.ts");
    const first = await acquireTestPostgres();
    try {
      const url = await first.createDatabase();
      const held = await acquireTestPostgres();
      try {
        // Joining a surviving lease keeps its existing database and never initialises again.
        expect(NodeFS.readdirSync(NodePath.join(cluster.data, "base"))).toEqual([
          new URL(url).pathname.slice(1),
        ]);
        const calls = NodeFS.readFileSync(commands, "utf8").split("\n");
        expect(calls.filter((line) => line === "initdb")).toHaveLength(1);
        expect(calls.filter((line) => line.startsWith("DROP DATABASE"))).toEqual([]);
      } finally {
        await held.close();
      }
    } finally {
      await first.close();
    }
    await guardStopped(cluster.home);
  } finally {
    vi.unstubAllEnvs();
    NodeFS.rmSync(cluster.root, { recursive: true, force: true });
  }
});

it.each([
  {
    name: "a cluster whose last start was never followed by a clean stop",
    arrange: async ({ home }: ReturnType<typeof fakeCluster>) => {
      NodeFS.writeFileSync(NodePath.join(home, "postmaster.started"), `${await exitedPid()}\n`);
    },
  },
  {
    name: "a cluster whose start PANICs on a corrupt pg_control",
    arrange: async ({ data }: ReturnType<typeof fakeCluster>) => {
      NodeFS.writeFileSync(NodePath.join(data, "global", "pg_control"), "corrupt");
    },
  },
  {
    name: "a cluster whose start runs crash recovery",
    arrange: async ({ data }: ReturnType<typeof fakeCluster>) => {
      NodeFS.writeFileSync(NodePath.join(data, "crashed"), "");
    },
  },
  {
    name: "a cluster whose recorded postmaster outlived its supervisor",
    arrange: async ({ home, bin, data }: ReturnType<typeof fakeCluster>) => {
      const orphan = NodeChildProcess.spawn(NodePath.join(bin, "postgres"), ["-D", data], {
        stdio: "ignore",
      });
      NodeFS.writeFileSync(NodePath.join(data, "postmaster.pid"), `${orphan.pid}\n${data}\n`);
      NodeFS.writeFileSync(NodePath.join(home, "postmaster.started"), `${orphan.pid}\n`);
      return orphan;
    },
  },
])("$name is rebuilt into an empty, leasable cluster with no manual step", async ({ arrange }) => {
  const cluster = fakeCluster();
  const orphan = await arrange(cluster);
  vi.stubEnv("MATE_TEST_PG_HOME", cluster.home);
  vi.stubEnv("MATE_PG_BIN", cluster.bin);
  vi.resetModules();
  try {
    const { acquireTestPostgres } = await import("./test-postgres.ts");
    const owner = await acquireTestPostgres();
    // The supervisor waits until the orphan is gone, which needs this process to reap it first.
    if (orphan) expect(orphan.signalCode).toBe("SIGQUIT");
    try {
      const name = new URL(await owner.createDatabase()).pathname.slice(1);
      expect(NodeFS.readdirSync(NodePath.join(cluster.data, "base"))).toEqual([name]);
    } finally {
      await owner.close();
    }
    await guardStopped(cluster.home);
  } finally {
    if (orphan?.exitCode === null && orphan.signalCode === null) orphan.kill("SIGKILL");
    vi.unstubAllEnvs();
    NodeFS.rmSync(cluster.root, { recursive: true, force: true });
  }
});

it("a live postmaster no supervisor recorded keeps running, and the start names its PID", async () => {
  const cluster = fakeCluster();
  const stranger = NodeChildProcess.spawn(
    NodePath.join(cluster.bin, "postgres"),
    ["-D", cluster.data],
    { stdio: "ignore" },
  );
  NodeFS.writeFileSync(
    NodePath.join(cluster.data, "postmaster.pid"),
    `${stranger.pid}\n${cluster.data}\n`,
  );
  vi.stubEnv("MATE_TEST_PG_HOME", cluster.home);
  vi.stubEnv("MATE_PG_BIN", cluster.bin);
  vi.resetModules();
  try {
    const { acquireTestPostgres } = await import("./test-postgres.ts");
    await expect(acquireTestPostgres()).rejects.toThrow(
      `PostgreSQL ${stranger.pid} runs ${cluster.data}, but no supervisor recorded it`,
    );
    expect(stranger.exitCode ?? stranger.signalCode).toBeNull();
    expect(NodeFS.readdirSync(NodePath.join(cluster.data, "base"))).toEqual(["hq_test_leftover"]);
  } finally {
    stranger.kill("SIGKILL");
    vi.unstubAllEnvs();
    NodeFS.rmSync(cluster.root, { recursive: true, force: true });
  }
});

it("a run whose cluster volume has less free space than the floor is refused before any supervisor starts, naming the volume", async () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-pg-full-"));
  const home = NodePath.join(root, "home");
  NodeFS.writeFileSync(NodePath.join(root, "ballast"), Buffer.alloc(3 * 1024 * 1024));
  const volume = NodeChildProcess.spawnSync("df", ["-P", root], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")
    .at(-1)!
    .split(/\s+/u)
    .at(-1)!;
  vi.stubEnv("MATE_TEST_PG_HOME", home);
  vi.stubEnv("MATE_TEST_PG_MIN_FREE_BYTES", String(Number.MAX_SAFE_INTEGER));
  vi.resetModules();
  try {
    const { acquireTestPostgres } = await import("./test-postgres.ts");
    const refusal = await acquireTestPostgres().then(
      () => "",
      (error: unknown) => String(error),
    );
    expect(refusal).toContain(`The disk ${volume} holding the PostgreSQL test cluster is full:`);
    expect(refusal).toMatch(/ballast \(3\.0 MiB\)/u);
    expect(NodeFS.existsSync(NodePath.join(home, "supervisor.log"))).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
