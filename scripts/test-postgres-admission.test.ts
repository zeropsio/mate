// @effect-diagnostics nodeBuiltinImport:off -- deterministic host admission receipts.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { acquirePostgresAdmission, postgresAdmissionBudget } from "./test-postgres-admission.ts";

it("Decision: PG-backed test work from z3 and mate-hq on one host is admitted by one shared budget; waiting is ended by a release receipt, never a clock.", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-budget-"));
  const admitted: string[] = [];
  const first = await acquirePostgresAdmission({ directory, capacity: 1 });
  let waiting!: () => void;
  const queued = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const second = acquirePostgresAdmission({ directory, capacity: 1, onWaiting: waiting }).then(
    (lease) => {
      admitted.push("second");
      return lease;
    },
  );
  try {
    await queued;
    expect(admitted).toEqual([]);
    await first.release();
    const lease = await second;
    expect(admitted).toEqual(["second"]);
    await lease.release();
  } finally {
    await first.release();
    await (await second).release();
  }
});

it("a queued PostgreSQL admission can be cancelled without taking the next released capacity", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-cancel-"));
  const first = await acquirePostgresAdmission({ directory, capacity: 1 });
  const abort = new AbortController();
  let waiting!: () => void;
  const queued = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const cancelled = acquirePostgresAdmission({
    directory,
    capacity: 1,
    signal: abort.signal,
    onWaiting: waiting,
  });
  const rejected = expect(cancelled).rejects.toThrow("cancelled");
  await queued;
  abort.abort(new Error("cancelled"));
  await rejected;
  await first.release();
  const next = await acquirePostgresAdmission({ directory, capacity: 1 });
  await next.release();
});

it("a PostgreSQL admission owner's process exit releases its host capacity", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-exit-"));
  const script = `import {acquirePostgresAdmission} from ${JSON.stringify(new URL("./test-postgres-admission.ts", import.meta.url).href)}; await acquirePostgresAdmission({directory:process.argv[1],capacity:1}); process.send('admitted'); process.on('message',()=>process.exit(0));`;
  const owner = NodeChildProcess.spawn(
    process.execPath,
    ["--input-type=module", "-e", script, directory],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  const exited = new Promise<void>((resolve) => owner.once("exit", () => resolve()));
  await new Promise<void>((resolve) => owner.once("message", () => resolve()));
  let waiting!: () => void;
  const queued = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const next = acquirePostgresAdmission({ directory, capacity: 1, onWaiting: waiting });
  try {
    await queued;
    owner.send("exit");
    await exited;
    await (await next).release();
  } finally {
    if (owner.exitCode === null) owner.kill("SIGTERM");
    await exited;
  }
});

it.live(
  "Decision: A gate stage ends when its own work ends; it never waits on another stage's resources or on leftover processes.",
  () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-stage-exit-"));
      const script = `import {acquirePostgresAdmission} from ${JSON.stringify(new URL("./test-postgres-admission.ts", import.meta.url).href)}; const lease = await acquirePostgresAdmission({directory:process.argv[1],capacity:2}); process.send('admitted'); process.once('message',async()=>{await lease.release(); process.disconnect();});`;
      const owner = NodeChildProcess.spawn(
        process.execPath,
        ["--input-type=module", "-e", script, directory],
        { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      );
      owner.stdout!.resume();
      owner.stderr!.resume();
      const exited = NodeEvents.EventEmitter.once(owner, "exit");
      const closed = NodeEvents.EventEmitter.once(owner, "close").then(() => "closed");
      let peer: Awaited<ReturnType<typeof acquirePostgresAdmission>> | undefined;
      try {
        const [message] = yield* Effect.promise(() =>
          NodeEvents.EventEmitter.once(owner, "message"),
        );
        expect(message).toBe("admitted");
        peer = yield* Effect.promise(() => acquirePostgresAdmission({ directory, capacity: 2 }));
        owner.send("release");
        expect(yield* Effect.promise(() => exited)).toEqual([0, null]);
        const outcome = yield* Effect.raceFirst(
          Effect.promise(() => closed),
          Effect.as(Effect.sleep(1000), "stderr retained"),
        );
        expect(
          outcome,
          "A completed admission owner must close its piped output while another stage still holds admission",
        ).toBe("closed");
      } finally {
        yield* Effect.promise(async () => {
          await peer?.release();
          if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGTERM");
          await closed;
        });
      }
    }),
);

it("a PostgreSQL admission broker startup failure reports its diagnostics to the launching worker", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-startup-failure-"));
  const generation = NodePath.join(directory, "generation.lock");
  NodeFS.symlinkSync(NodePath.join(directory, "missing", "generation.lock"), generation);
  try {
    await expect(acquirePostgresAdmission({ directory, capacity: 1 })).rejects.toThrow(generation);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

it.each([
  { cores: 1, expected: 1 },
  { cores: 2, expected: 1 },
  { cores: 18, expected: 17 },
])("derives PostgreSQL admission from $cores host cores", ({ cores, expected }) => {
  expect(postgresAdmissionBudget(cores)).toBe(expected);
});

it("a replacement PostgreSQL admission broker waits for surviving workers of a killed broker", async () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-restart-"));
  const path = NodePath.join(import.meta.dirname, "test-postgres-admission.ts");
  const start = () => {
    const child = NodeChildProcess.spawn(process.execPath, [path, "serve", directory, "1"], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const messages: string[] = [];
    const waiters = new Map<string, () => void>();
    child.on("message", (message: unknown) => {
      if (typeof message !== "string") return;
      messages.push(message);
      waiters.get(message)?.();
    });
    return {
      child,
      messages,
      next: (event: string) =>
        messages.includes(event)
          ? Promise.resolve()
          : new Promise<void>((resolve) => waiters.set(event, resolve)),
      exited: new Promise<void>((resolve) => child.once("exit", () => resolve())),
    };
  };
  const original = start();
  await original.next("ready");
  let lost!: () => void;
  const disconnected = new Promise<void>((resolve) => {
    lost = resolve;
  });
  const first = await acquirePostgresAdmission({ directory, capacity: 1, onLost: lost });
  original.child.kill("SIGKILL");
  await Promise.all([disconnected, original.exited]);
  // Remove only the captured broker's dead socket, just as the real election path does.
  NodeFS.rmSync(NodePath.join(directory, "host.sock"), { force: true });
  const replacement = start();
  try {
    await replacement.next("starting");
    const probe = NodeChildProcess.spawnSync("flock", [
      "-n",
      NodePath.join(directory, "generation.lock"),
      "true",
    ]);
    expect(probe.status).toBe(1);
    expect(replacement.messages).not.toContain("ready");
    // Even a lost broker's lease retains its generation barrier until work explicitly finishes.
    await expect(first.release()).rejects.toThrow("PostgreSQL admission broker connection closed");
    await replacement.next("ready");
    const second = await acquirePostgresAdmission({ directory, capacity: 1 });
    replacement.child.disconnect();
    await second.release();
    await replacement.exited;
  } finally {
    await first.release().catch(() => undefined);
    if (replacement.child.exitCode === null && replacement.child.signalCode === null)
      replacement.child.kill("SIGTERM");
    await replacement.exited;
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
