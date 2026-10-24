// @effect-diagnostics nodeBuiltinImport:off -- supervisor protocol compatibility fixture.
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
  expect(choosePostgresHome({ platform, env, homeDirectory: "/Users/dev", user: 501 })).toBe(
    expected,
  );
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

it("a killed supervisor's lease databases are dropped when the next one starts", async () => {
  const { reclaimLeasedDatabases } = await import("./test-postgres.ts");
  const dropped: string[] = [];
  reclaimLeasedDatabases((query) => {
    if (query.startsWith("SELECT")) return "mate_test_0a1b\nmate_test_ff00\n";
    dropped.push(query);
    return "";
  });
  expect(dropped).toEqual([
    "DROP DATABASE mate_test_0a1b WITH (FORCE)",
    "DROP DATABASE mate_test_ff00 WITH (FORCE)",
  ]);
  expect(() => reclaimLeasedDatabases(() => "mate_test_x; DROP TABLE y\n")).toThrow(
    "Unexpected test database: mate_test_x; DROP TABLE y",
  );
});

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
