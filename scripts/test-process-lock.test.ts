// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- real kernel locks and pipe-loss receipts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { expect, it, vi } from "vite-plus/test";
import { acquireProcessLock } from "./test-process-lock.ts";

// Observe captured children without replacing the real kernel-lock processes.
vi.mock("node:child_process", async (original) => {
  const real = await original<typeof NodeChildProcess>();
  return { ...real, spawn: vi.fn(real.spawn) };
});

it("kills a queued flock child when its waiting client loses its pipe", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-wait-"));
  const path = NodePath.join(home, "lifecycle.lock");
  const unlock = await acquireProcessLock(path);
  const realFlock = NodeChildProcess.execFileSync("which", ["flock"], { encoding: "utf8" }).trim();
  const bin = NodePath.join(home, "bin");
  NodeFS.mkdirSync(bin);
  // exec preserves this captured PID as the actual flock child, including through our pipe watcher.
  NodeFS.writeFileSync(
    NodePath.join(bin, "flock"),
    '#!/bin/sh\nprintf "%s\\n" "$$" > "$MATE_TEST_LOCK_PID"\nexec "$MATE_TEST_REAL_FLOCK" "$@"\n',
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", `${bin}${NodePath.delimiter}${process.env.PATH}`);
  vi.stubEnv("MATE_TEST_REAL_FLOCK", realFlock);
  vi.stubEnv("MATE_TEST_LOCK_PID", NodePath.join(home, "waiter.pid"));
  // The shim writes its PID into a FIFO: the read returns once the shim has run, with no
  // filesystem event involved.
  NodeChildProcess.execFileSync("mkfifo", [NodePath.join(home, "waiter.pid")]);
  const spawned = NodeFS.promises
    .readFile(NodePath.join(home, "waiter.pid"), "utf8")
    .then((text) => Number(text));
  const spawn = vi.mocked(NodeChildProcess.spawn);
  spawn.mockClear();
  const waiting = acquireProcessLock(path).then(
    (release) => ({ release }),
    (error: unknown) => ({ error }),
  );
  const child = spawn.mock.results[0]!.value as NodeChildProcess.ChildProcess;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let flockPid: number | undefined;
  try {
    flockPid = await spawned;
    vi.unstubAllEnvs();
    // EOF is exactly what a killed or timed-out worker leaves behind, while the owner stays alive.
    child.stdin!.end();
    const outcome = await Promise.race([
      exited.then(() => "exited"),
      new Promise<string>((resolve) => {
        deadline = setTimeout(() => resolve("still queued"), 1_000);
      }),
    ]);
    expect(outcome, "the abandoned waiter must exit before the current owner unlocks").toBe(
      "exited",
    );
    expect(() => process.kill(flockPid!, 0), "the real flock child must also be gone").toThrowError(
      expect.objectContaining({ code: "ESRCH" }),
    );
    expect("error" in (await waiting)).toBe(true);
    // The still-open owner's kernel lock remains exclusive; abandoning a waiter cannot release it.
    const probe = NodeChildProcess.spawnSync("flock", ["-n", path, process.execPath, "-e", ""]);
    expect(probe.status).toBe(1);
  } finally {
    clearTimeout(deadline);
    vi.unstubAllEnvs();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    await waiting;
    await unlock();
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it.each([
  { mode: undefined, sharedProbe: 1 },
  { mode: "exclusive" as const, sharedProbe: 1 },
  { mode: "shared" as const, sharedProbe: 0 },
])(
  "a $mode process lock admits only compatible kernel lock holders",
  async ({ mode, sharedProbe }) => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-mode-"));
    const path = NodePath.join(home, "generation.lock");
    const unlock = await acquireProcessLock(path, mode === undefined ? {} : { mode });
    try {
      const shared = NodeChildProcess.spawnSync("flock", ["-n", "-s", path, "true"]);
      expect(shared.status).toBe(sharedProbe);
      const exclusive = NodeChildProcess.spawnSync("flock", ["-n", "-x", path, "true"]);
      expect(exclusive.status).toBe(1);
    } finally {
      await unlock();
    }
    const released = NodeChildProcess.spawnSync("flock", ["-n", "-x", path, "true"]);
    expect(released.status).toBe(0);
    NodeFS.rmSync(home, { recursive: true, force: true });
  },
);

it("an unreferenced shared process lock allows its idle owner to exit without a finalizer", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-exit-"));
  const path = NodePath.join(home, "generation.lock");
  const script = `import {acquireProcessLock} from ${JSON.stringify(new URL("./test-process-lock.ts", import.meta.url).href)}; await acquireProcessLock(process.argv[1], {mode:'shared',unref:true});`;
  try {
    await NodeUtil.promisify(NodeChildProcess.execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script,
      path,
    ]);
    const unlock = await acquireProcessLock(path);
    await unlock();
  } finally {
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});

it("cancelling a queued process lock waits for its child to exit and preserves the abort reason", async () => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-abort-"));
  const path = NodePath.join(home, "generation.lock");
  const unlock = await acquireProcessLock(path);
  const realFlock = NodeChildProcess.execFileSync("which", ["flock"], { encoding: "utf8" }).trim();
  const bin = NodePath.join(home, "bin");
  NodeFS.mkdirSync(bin);
  NodeFS.writeFileSync(
    NodePath.join(bin, "flock"),
    '#!/bin/sh\nprintf "%s\\n" "$$" > "$MATE_TEST_ABORT_PID"\nexec "$MATE_TEST_REAL_FLOCK" "$@"\n',
    { mode: 0o700 },
  );
  const receipt = NodePath.join(home, "waiter.pid");
  NodeChildProcess.execFileSync("mkfifo", [receipt]);
  vi.stubEnv("PATH", `${bin}${NodePath.delimiter}${process.env.PATH}`);
  vi.stubEnv("MATE_TEST_ABORT_PID", receipt);
  vi.stubEnv("MATE_TEST_REAL_FLOCK", realFlock);
  const spawned = NodeFS.promises.readFile(receipt, "utf8").then(Number);
  const abort = new AbortController();
  const reason = new Error("cancelled generation election");
  const waiting = acquireProcessLock(path, { signal: abort.signal });
  const rejected = expect(waiting).rejects.toBe(reason);
  try {
    const flockPid = await spawned;
    vi.unstubAllEnvs();
    abort.abort(reason);
    await rejected;
    expect(() => process.kill(flockPid, 0)).toThrowError(
      expect.objectContaining({ code: "ESRCH" }),
    );
    const probe = NodeChildProcess.spawnSync("flock", ["-n", "-x", path, "true"]);
    expect(probe.status).toBe(1);
  } finally {
    abort.abort(reason);
    vi.unstubAllEnvs();
    await unlock();
    await waiting.catch(() => undefined);
    NodeFS.rmSync(home, { recursive: true, force: true });
  }
});
