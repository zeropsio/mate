// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalTimers:off -- deterministic kernel-lock interleaving with real worktree clients.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { expect, it, vi } from "vite-plus/test";
import { RESERVED, reservePort } from "./test-ports.ts";

/**
 * The supervisor's guard holds server.lock while PostgreSQL runs, so taking that lock is the
 * kernel's receipt that the supervisor stopped it. A file watch is no receipt: macOS can drop it.
 */
const postgresStopped = (home: string) =>
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

it("releases the lifecycle lock while a scenario run keeps its PostgreSQL lease open", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-run-"));
  const fixture = NodePath.join(import.meta.dirname, "fixtures/test-postgres-lifecycle.ts");
  const children: NodeChildProcess.ChildProcess[] = [];
  const exits: Promise<void>[] = [];
  const released = new Set<NodeChildProcess.ChildProcess>();
  const start = (mode: string) => {
    const child = NodeChildProcess.spawn(process.execPath, [fixture, mode], {
      env: { ...process.env, MATE_TEST_PG_HOME: home },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    children.push(child);
    exits.push(new Promise<void>((resolve) => child.once("exit", () => resolve())));
    return child;
  };
  const next = (child: NodeChildProcess.ChildProcess, event: string) =>
    new Promise<void>((resolve) => {
      const receive = (message: unknown) => {
        if ((message as { event: string }).event !== event) return;
        child.off("message", receive);
        resolve();
      };
      child.on("message", receive);
    });
  try {
    const scenario = start("scenario");
    await next(scenario, "admitted");
    // Probe the kernel itself while the real scenario global-setup consumer still owns its lease.
    const probe = NodeChildProcess.spawnSync("flock", [
      "-n",
      NodePath.join(home, "lifecycle.lock"),
      process.execPath,
      "-e",
      "",
    ]);
    expect(probe.status, "an active scenario lease must not hold lifecycle.lock").toBe(0);
    const worker = start("worker");
    await next(worker, "created");
    expect(scenario.exitCode).toBeNull();
    const workerReleased = next(worker, "released");
    worker.send("release");
    await workerReleased;
    released.add(worker);
    const scenarioReleased = next(scenario, "released");
    scenario.send("release");
    await scenarioReleased;
    released.add(scenario);
  } finally {
    for (const child of children)
      if (!released.has(child) && child.connected) child.send("release", () => {});
    await Promise.all(exits);
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("admits another worktree's lease while the last release waits for its lifecycle lock", async () => {
  // Short socket paths also fit macOS's Unix-domain limit in deeply nested worktrees.
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-cycle-"));
  const fixture = NodePath.join(import.meta.dirname, "fixtures/test-postgres-lifecycle.ts");
  const bin = NodePath.join(home, "bin");
  NodeFS.mkdirSync(bin);
  NodeFS.writeFileSync(
    NodePath.join(bin, "flock"),
    '#!/bin/sh\nexec "$MATE_TEST_NODE" "$MATE_TEST_LIFECYCLE_FIXTURE" lock "$@"\n',
    { mode: 0o700 },
  );
  const realFlock = NodeChildProcess.execFileSync("which", ["flock"], { encoding: "utf8" }).trim();
  type Receipt = {
    event: string;
    role?: string;
    parent?: number;
    url?: string;
    socket?: NodeNet.Socket;
  };
  const receipts: Receipt[] = [];
  const waiting: { matches: (receipt: Receipt) => boolean; resolve: (receipt: Receipt) => void }[] =
    [];
  const record = (receipt: Receipt) => {
    const index = waiting.findIndex(({ matches }) => matches(receipt));
    if (index < 0) receipts.push(receipt);
    else waiting.splice(index, 1)[0]!.resolve(receipt);
  };
  const next = (matches: (receipt: Receipt) => boolean) => {
    const index = receipts.findIndex(matches);
    return index < 0
      ? new Promise<Receipt>((resolve) => waiting.push({ matches, resolve }))
      : Promise.resolve(receipts.splice(index, 1)[0]!);
  };
  const controls = new Set<NodeNet.Socket>();
  const server = NodeNet.createServer((socket) => {
    controls.add(socket);
    NodeReadline.createInterface({ input: socket }).on("line", (line) =>
      record({ ...(JSON.parse(line) as Receipt), socket }),
    );
    socket.on("close", () => controls.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(NodePath.join(home, "control.sock"), resolve));
  const children: NodeChildProcess.ChildProcess[] = [];
  const exits: Promise<void>[] = [];
  const start = (role: string) => {
    const cwd = NodePath.join(home, role);
    NodeFS.mkdirSync(cwd);
    const child = NodeChildProcess.spawn(process.execPath, [fixture], {
      cwd,
      env: {
        ...process.env,
        PATH: `${bin}${NodePath.delimiter}${process.env.PATH}`,
        MATE_TEST_PG_HOME: home,
        MATE_TEST_REAL_FLOCK: realFlock,
        MATE_TEST_NODE: process.execPath,
        MATE_TEST_LIFECYCLE_FIXTURE: fixture,
        MATE_TEST_LIFECYCLE_CONTROL: NodePath.join(home, "control.sock"),
        MATE_TEST_CLIENT_ROLE: role,
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    children.push(child);
    exits.push(new Promise<void>((resolve) => child.once("exit", () => resolve())));
    child.on("message", (receipt) => record({ ...(receipt as Receipt), role }));
    return child;
  };
  let firstReleased = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = start("first");
    const original = await next((r) => r.role === "first" && r.event === "created");
    const second = start("second");
    const held = await next((r) => r.role === "second" && r.event === "locked");
    // The second acquirer owns the kernel lock but has not connected yet. The last release
    // now reaches idle shutdown, which requests that same lock inside the database queue.
    first.send("release");
    await next((r) => r.role === "first" && r.event === "locking" && r.parent !== first.pid);
    held.socket!.write("continue");
    const admitted = await Promise.race([
      next((r) => r.role === "second" && r.event === "admitted").then(() => "admitted"),
      new Promise<string>((resolve) => {
        deadline = setTimeout(() => resolve("blocked"), 5_000);
      }),
    ]);
    expect(admitted).toBe("admitted");
    const replacement = await next((r) => r.role === "second" && r.event === "created");
    expect(new URL(replacement.url!).origin).toBe(new URL(original.url!).origin);
    await next((r) => r.role === "first" && r.event === "released");
    firstReleased = true;
    second.send("release");
    await next((r) => r.role === "second" && r.event === "released");
  } finally {
    clearTimeout(deadline);
    for (const socket of controls) socket.end("continue");
    // Captured children own their lock pipes; ending them releases a failed interleaving too.
    children[1]?.kill("SIGTERM");
    if (!firstReleased && children.length === 2)
      await next((r) => r.role === "first" && r.event === "released");
    for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.all(exits);
    await postgresStopped(home);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("a lease client that disconnects before its answer leaves the supervisor and its held leases running", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-gone-"));
  vi.stubEnv("MATE_TEST_PG_HOME", home);
  vi.resetModules();
  try {
    const { acquireTestPostgres } = await import("./test-postgres.ts");
    const held = await acquireTestPostgres();
    const gone = NodeNet.createConnection(NodePath.join(home, "supervisor.sock"));
    gone.write("create\ncreate\n");
    // The first answer proves the supervisor heard both; the second is written to a closed socket.
    await new Promise((resolve) =>
      NodeReadline.createInterface({ input: gone }).once("line", resolve),
    );
    gone.destroy();
    expect(await held.createDatabase()).toMatch(/^postgres:/u);
    await held.close();
    await postgresStopped(home);
  } finally {
    vi.unstubAllEnvs();
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("admits a lease while another lease's database command waits on PostgreSQL", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-wait-"));
  vi.stubEnv("MATE_TEST_PG_HOME", home);
  vi.resetModules();
  let holder: NodeChildProcess.ChildProcess | undefined;
  try {
    const { acquireTestPostgres, postgresBinDir } = await import("./test-postgres.ts");
    const first = await acquireTestPostgres();
    const maintenance = new URL(await first.createDatabase());
    maintenance.pathname = "/postgres";
    // A comment held open on the template blocks every CREATE DATABASE that copies it.
    holder = NodeChildProcess.spawn(
      NodePath.join(postgresBinDir(), "psql"),
      ["-X", "-v", "ON_ERROR_STOP=1", "-At", maintenance.href],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    const said = NodeReadline.createInterface({ input: holder.stdout! });
    const heard = (tag: string) =>
      new Promise<void>((resolve) =>
        said.on("line", (line) => {
          if (line === tag) resolve();
        }),
      );
    const commented = heard("COMMENT");
    holder.stdin!.write("BEGIN; COMMENT ON DATABASE template0 IS 'held';\n");
    await commented;
    const waiting = first.createDatabase();
    const blocked = heard("DO");
    holder.stdin!.write(`DO $$ BEGIN
      WHILE NOT EXISTS (SELECT FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE 'CREATE DATABASE %') LOOP
        PERFORM pg_sleep(0.01);
        PERFORM pg_stat_clear_snapshot();
      END LOOP; END $$;\n`);
    await blocked;
    // The CREATE stays blocked until the ROLLBACK below, so this admission happens while it waits.
    const second = await acquireTestPostgres();
    holder.stdin!.end("ROLLBACK;\n");
    expect(await waiting).toMatch(/^postgres:/u);
    await second.close();
    await first.close();
    await postgresStopped(home);
  } finally {
    holder?.stdin!.end();
    vi.unstubAllEnvs();
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("a running test PostgreSQL cluster's port is reserved, so no other test process is handed it", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-port-"));
  vi.stubEnv("MATE_TEST_PG_HOME", home);
  vi.resetModules();
  try {
    const { acquireTestPostgres } = await import("./test-postgres.ts");
    const lease = await acquireTestPostgres();
    const port = Number(new URL(await lease.createDatabase()).port);
    expect(port).toBeGreaterThanOrEqual(RESERVED.first);
    expect(port).toBeLessThanOrEqual(RESERVED.last);
    await expect(reservePort([port])).rejects.toThrow("is free to reserve");
    await lease.close();
    await postgresStopped(home);
  } finally {
    vi.unstubAllEnvs();
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});
