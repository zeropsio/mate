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
