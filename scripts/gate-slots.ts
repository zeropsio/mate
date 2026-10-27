// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off preferSchemaOverJson:off -- machine-wide host gate admission.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import { acquireProcessLock } from "./test-process-lock.ts";

interface GateSlotHolder {
  pid: number;
  worktree: string;
  since: string;
}

export function gateSlotCount(value = process.env.GATE_SLOTS): number {
  const count = Number(value ?? 3);
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("GATE_SLOTS must be a positive integer");
  return count;
}

export function gateSlotDirectory(): string {
  return NodePath.join(NodeOS.homedir(), ".local", "share", "mate-gate-slots");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

export async function acquireGateSlot(options: {
  directory?: string;
  slots?: number;
  worktree: string;
  onWaiting?: (holders: GateSlotHolder[], waitMs: number) => void;
}): Promise<{ release: () => void; waitMs: number }> {
  const directory = options.directory ?? gateSlotDirectory();
  const slots = gateSlotCount(String(options.slots ?? gateSlotCount()));
  NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = NodePath.join(directory, `${process.pid}-${NodeCrypto.randomUUID()}.json`);
  const started = Date.now();
  let announced = false;
  for (;;) {
    // Kernel locking serializes admission and dead-PID reclamation; a reclaimer can never
    // unlink a replacement lease. Release only removes the releaser's unique filename.
    const unlock = await acquireProcessLock(NodePath.join(directory, "registry.lock"));
    const holders: GateSlotHolder[] = [];
    let acquired = false;
    try {
      for (const file of NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))) {
        const leasePath = NodePath.join(directory, file);
        // A killed writer may leave partial JSON. Its filename still identifies the dead
        // process, so reclamation never depends on it having finished the metadata write.
        const pid = Number(file.split("-")[0]);
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error(`Invalid gate lease: ${file}`);
        if (!alive(pid)) {
          NodeFS.rmSync(leasePath, { force: true });
          continue;
        }
        let holder: GateSlotHolder;
        try {
          holder = JSON.parse(NodeFS.readFileSync(leasePath, "utf8")) as GateSlotHolder;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        holders.push(holder);
      }
      if (holders.length < slots) {
        NodeFS.writeFileSync(
          path,
          JSON.stringify({
            pid: process.pid,
            worktree: options.worktree,
            since: new Date().toISOString(),
          } satisfies GateSlotHolder),
          { mode: 0o600 },
        );
        acquired = true;
      }
    } finally {
      await unlock();
    }
    if (acquired) {
      const onInterrupt = () => {
        release();
        process.exit(130);
      };
      const onTerminate = () => {
        release();
        process.exit(143);
      };
      const release = () => {
        NodeFS.rmSync(path, { force: true });
        process.off("exit", release);
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
      };
      process.once("exit", release);
      process.once("SIGINT", onInterrupt);
      process.once("SIGTERM", onTerminate);
      return { release, waitMs: Date.now() - started };
    }
    if (!announced) {
      options.onWaiting?.(holders, Date.now() - started);
      announced = true;
    }
    // An unbounded queue, not a failing attempt or retry of a stage. No work starts here.
    await NodeTimersPromises.setTimeout(1_000);
  }
}
