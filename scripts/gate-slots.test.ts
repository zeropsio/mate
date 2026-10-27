// @effect-diagnostics nodeBuiltinImport:off -- test the semaphore through real gate processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { acquireGateSlot, gateSlotCount } from "./gate-slots.ts";

const homes: string[] = [];
const children: NodeChildProcess.ChildProcess[] = [];
function home() {
  const path = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-gate-slots-"));
  homes.push(path);
  return path;
}

function client(directory: string, slots = 1) {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { acquireGateSlot } from ${JSON.stringify(new URL("./gate-slots.ts", import.meta.url).href)};
       const lease = await acquireGateSlot({ directory: process.argv[1], slots: Number(process.argv[2]),
         worktree: 'test-worktree', onWaiting: (holders, waitMs) => process.send({ type: 'waiting', holders, waitMs }) });
       process.send({ type: 'acquired', waitMs: lease.waitMs });
       process.once('message', message => { if (message === 'exit') process.exit(0); lease.release(); process.disconnect(); });`,
      directory,
      String(slots),
    ],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  children.push(child);
  const messages: {
    type: string;
    waitMs: number;
    holders: { pid: number; worktree: string; since: string }[];
  }[] = [];
  child.on("message", (message) => messages.push(message as (typeof messages)[number]));
  const closed = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const message = async (type: string) => {
    const found = messages.find((item) => item.type === type);
    if (found) return found;
    return await new Promise<(typeof messages)[number]>((resolve, reject) => {
      const receive = (item: unknown) => {
        const event = item as (typeof messages)[number];
        if (event.type === type) {
          child.off("message", receive);
          child.off("exit", exited);
          resolve(event);
        }
      };
      const exited = () => {
        child.off("message", receive);
        reject(new Error(`Client exited before ${type}`));
      };
      child.on("message", receive);
      child.once("exit", exited);
    });
  };
  return {
    child,
    messages,
    message,
    closed,
    release: async () => {
      child.send("release");
      await closed;
    },
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await closed;
    }),
  );
  for (const path of homes.splice(0)) NodeFS.rmSync(path, { recursive: true, force: true });
});

it("Decision: gate slots default to 3 and GATE_SLOTS accepts only positive integers", () => {
  vi.stubEnv("GATE_SLOTS", undefined);
  expect(gateSlotCount()).toBe(3);
  expect(gateSlotCount("1")).toBe(1);
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity"])
    expect(() => gateSlotCount(value)).toThrow("GATE_SLOTS must be a positive integer");
});

it("a gate releases its slot and a queued gate acquires it with a separate wait receipt", async () => {
  const directory = home();
  const first = client(directory);
  await first.message("acquired");
  const second = client(directory);
  const waiting = await Promise.race([second.message("waiting"), second.message("acquired")]);
  expect(waiting.type, "ASSERTION: a second gate queues until the occupied slot is released").toBe(
    "waiting",
  );
  expect(waiting.holders).toEqual([
    { pid: first.child.pid, worktree: "test-worktree", since: expect.any(String) },
  ]);
  expect(Number.isFinite(Date.parse(waiting.holders[0]!.since))).toBe(true);
  expect(second.messages.some((item) => item.type === "acquired")).toBe(false);
  await first.release();
  expect((await second.message("acquired")).waitMs).toBeGreaterThan(0);
  await second.release();
  expect(NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))).toEqual([]);
});

it("a slot held by a dead PID is reclaimed by the next gate", async () => {
  const directory = home();
  const first = client(directory);
  await first.message("acquired");
  const stale = NodeFS.readdirSync(directory).find((file) => file.endsWith(".json"))!;
  NodeFS.writeFileSync(NodePath.join(directory, stale), "{");
  first.child.kill("SIGKILL");
  await first.closed;
  const next = client(directory);
  await next.message("acquired");
  const holders = NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"));
  expect(holders).toHaveLength(1);
  expect(JSON.parse(NodeFS.readFileSync(NodePath.join(directory, holders[0]!), "utf8")).pid).toBe(
    next.child.pid,
  );
  await next.release();
});

it.each(["SIGINT", "SIGTERM"] as const)("a gate releases its slot on %s", async (signal) => {
  const directory = home();
  const holder = client(directory);
  await holder.message("acquired");
  holder.child.kill(signal);
  await holder.closed;
  expect(NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))).toEqual([]);
});

it("concurrent real gate processes never acquire more slots than the configured capacity", async () => {
  const directory = home();
  const first = client(directory, 2);
  const second = client(directory, 2);
  await Promise.all([first.message("acquired"), second.message("acquired")]);
  const queued = Array.from({ length: 4 }, () => client(directory, 2));
  await Promise.all(queued.map((gate) => gate.message("waiting")));
  expect(queued.every((gate) => !gate.messages.some((item) => item.type === "acquired"))).toBe(
    true,
  );
  let active = 2;
  let peak = active;
  for (const gate of queued)
    gate.child.on("message", (item) => {
      if ((item as { type: string }).type === "acquired") {
        active++;
        peak = Math.max(peak, active);
      }
    });
  active--;
  await first.release();
  for (let remaining = [...queued]; remaining.length;) {
    const gate = await Promise.race(
      remaining.map(async (gate) => {
        await gate.message("acquired");
        return gate;
      }),
    );
    remaining = remaining.filter((item) => item !== gate);
    expect(active).toBe(2);
    active--;
    await gate.release();
  }
  await second.release();
  expect(peak).toBe(2);
});

it("a process exit releases a slot even without an explicit release", async () => {
  const directory = home();
  const holder = client(directory);
  await holder.message("acquired");
  holder.child.send("exit");
  await holder.closed;
  expect(NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))).toEqual([]);
});

it("a gate can release its own slot more than once", async () => {
  const directory = home();
  const lease = await acquireGateSlot({ directory, slots: 1, worktree: "direct-consumer" });
  lease.release();
  lease.release();
  expect(NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))).toEqual([]);
});
