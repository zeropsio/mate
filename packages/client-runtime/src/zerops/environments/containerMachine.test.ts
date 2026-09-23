import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Instant } from "../data/access/grant.ts";
import {
  containerVerdict,
  initialContainer,
  transitionContainer,
  type ContainerEvent,
  type ContainerMachine,
} from "./containerMachine.ts";
import type { DescriptorFacts } from "./environmentMachine.ts";
import type { ProbeReading } from "./probeStore.ts";

const START_MS = 1_800_000_000_000;

const instant = (ms: number): Instant => ({ wall: ms, mono: ms - START_MS });

const descriptor = (serverVersion: string): DescriptorFacts => ({
  environmentId: EnvironmentId.make("env-a"),
  serverVersion,
  update: null,
  identity: "ok",
  identityCheckedAt: null,
});

const READY: ProbeReading = { kind: "ready", descriptor: descriptor("0.11.40"), initAt: null };

interface Run {
  readonly machine: ContainerMachine;
  readonly nowMs: number;
}

/** Feeds events one second apart; `TICK` is delivered at the machine's own timer. */
const drive = (
  events: ReadonlyArray<ContainerEvent>,
  from: Run = { machine: initialContainer(), nowMs: START_MS },
): Run => {
  let { machine, nowMs } = from;
  for (const event of events) {
    nowMs = event.type === "TICK" && machine.timer !== null ? machine.timer.wall : nowMs + 1_000;
    machine = transitionContainer(machine, event, { now: instant(nowMs) }).state;
  }
  return { machine, nowMs };
};

const probed = (reading: ProbeReading, sentAtMs: number): ContainerEvent => ({
  type: "PROBED",
  reading,
  sentAt: instant(sentAtMs),
});

const active: ContainerEvent = {
  type: "PLATFORM",
  status: { project: "ACTIVE", service: "ACTIVE" },
};

/** Up and answering, with nothing connected to it. */
const ready = (): Run => {
  const run = drive([active]);
  return drive([probed(READY, run.nowMs)], run);
};

describe("container machine (DESIGN §4.5)", () => {
  it("our restart shows restarting(you)", () => {
    const up = ready();
    expect(containerVerdict(up.machine)).toEqual({ level: "ready" });

    const asked = drive(
      [{ type: "INTENT", intent: { kind: "restart", since: instant(up.nowMs + 1_000) } }],
      up,
    );
    const ours = { level: "restarting", by: "you", overdue: false };
    expect(containerVerdict(asked.machine)).toEqual(ours);

    // The platform's own RESTARTING is the restart we asked for, not someone else's.
    const restarting = drive(
      [{ type: "PLATFORM", status: { project: "ACTIVE", service: "RESTARTING" } }],
      asked,
    );
    expect(containerVerdict(restarting.machine)).toEqual(ours);

    // The old server still answering before it goes down is not the restart being over.
    const stale = drive([probed(READY, asked.nowMs)], restarting);
    expect(containerVerdict(stale.machine)).toEqual(ours);

    const ended = drive([active], stale);
    expect(containerVerdict(ended.machine)).toEqual(ours);
    const answered = drive([probed(READY, ended.nowMs)], ended);
    expect(containerVerdict(answered.machine)).toEqual({ level: "ready" });
    expect(answered.machine.intent).toBeNull();

    // Without an intent of ours, the same push is the platform's restart.
    const theirs = drive(
      [{ type: "PLATFORM", status: { project: "ACTIVE", service: "RESTARTING" } }],
      ready(),
    );
    expect(containerVerdict(theirs.machine)).toEqual({
      level: "restarting",
      by: "platform",
      overdue: false,
    });
  });

  it("update with the same version → ready within one connect, never overdue", () => {
    const up = ready();
    const linked = drive([{ type: "LINK", connected: true }], up);
    const asked = drive(
      [
        {
          type: "INTENT",
          intent: { kind: "update", since: instant(linked.nowMs + 1_000), from: "0.11.40" },
        },
      ],
      linked,
    );
    expect(containerVerdict(asked.machine)).toEqual({ level: "updating", overdue: false });

    // The server restarts on the version it had: the socket drops, a probe reads the same version.
    const dropped = drive(
      [{ type: "LINK", connected: false }, probed(READY, asked.nowMs + 1_000)],
      asked,
    );
    expect(containerVerdict(dropped.machine)).toEqual({ level: "updating", overdue: false });

    const back = drive([{ type: "LINK", connected: true }], dropped);
    expect(containerVerdict(back.machine)).toEqual({ level: "ready" });
    expect(back.machine.intent).toBeNull();
    expect(back.machine.timer).toBeNull();

    // Long past the update's budget, nothing turns it overdue.
    const later = drive([{ type: "TICK" }, { type: "LINK", connected: false }], {
      machine: back.machine,
      nowMs: back.nowMs + 10 * 60_000,
    });
    expect(later.machine.overdue).toBe(false);
    expect(containerVerdict(later.machine)).toEqual({ level: "ready" });
  });

  it("a cap past its budget sets overdue on the level it is on, and nothing else", () => {
    const booting = drive([active, probed({ kind: "initializing", initAt: null }, START_MS)]);
    expect(containerVerdict(booting.machine)).toEqual({ level: "booting", overdue: false });

    // A process running against the container holds the cap; its end starts the 90 s over.
    const running = drive([{ type: "PROCESS", running: true }], booting);
    expect(running.machine.timer).toBeNull();
    const ended = drive([{ type: "PROCESS", running: false }], running);
    expect(ended.machine.timer).toEqual(instant(ended.nowMs + 90_000));

    const late = drive([{ type: "TICK" }], ended);
    expect(containerVerdict(late.machine)).toEqual({ level: "booting", overdue: true });
    expect(late.machine.timer).toBeNull();

    // The next read fact moves the level, and the new level starts on time.
    const answered = drive([probed(READY, late.nowMs)], late);
    expect(containerVerdict(answered.machine)).toEqual({ level: "ready" });
    expect(answered.machine.overdue).toBe(false);
  });

  it("a new intent on the level the container is already on starts on time", () => {
    // The platform's restart ran past its budget; the user restarts it again.
    const stalled = drive(
      [
        { type: "PLATFORM", status: { project: "ACTIVE", service: "RESTARTING" } },
        { type: "TICK" },
      ],
      ready(),
    );
    expect(containerVerdict(stalled.machine)).toEqual({
      level: "restarting",
      by: "platform",
      overdue: true,
    });
    const restart = drive(
      [{ type: "INTENT", intent: { kind: "restart", since: instant(stalled.nowMs + 1_000) } }],
      stalled,
    );
    expect(containerVerdict(restart.machine)).toEqual({
      level: "restarting",
      by: "you",
      overdue: false,
    });
    expect(restart.machine.timer).toEqual(instant(restart.nowMs + 180_000));

    // An update ran past its budget; the user retries it.
    const late = drive(
      [
        {
          type: "INTENT",
          intent: { kind: "update", since: instant(START_MS + 3_000), from: "0.11.40" },
        },
        { type: "TICK" },
      ],
      ready(),
    );
    expect(containerVerdict(late.machine)).toEqual({ level: "updating", overdue: true });
    const retried = drive(
      [
        {
          type: "INTENT",
          intent: { kind: "update", since: instant(late.nowMs + 1_000), from: "0.11.40" },
        },
      ],
      late,
    );
    expect(containerVerdict(retried.machine)).toEqual({ level: "updating", overdue: false });
    expect(retried.machine.timer).toEqual(instant(retried.nowMs + 120_000));
  });

  const PLATFORM_ROWS: ReadonlyArray<{
    readonly project: string;
    readonly service: string | null;
    readonly verdict: ReturnType<typeof containerVerdict>;
  }> = [
    { project: "NEW", service: null, verdict: { level: "creating", overdue: false } },
    { project: "CREATING", service: null, verdict: { level: "creating", overdue: false } },
    { project: "STARTING", service: null, verdict: { level: "provisioning", overdue: false } },
    { project: "STOPPED", service: null, verdict: { level: "inactive", status: "STOPPED" } },
    { project: "ACTIVE", service: "NEW", verdict: { level: "provisioning", overdue: false } },
    { project: "ACTIVE", service: "STARTING", verdict: { level: "provisioning", overdue: false } },
    {
      project: "ACTIVE",
      service: "UPGRADING",
      verdict: { level: "restarting", by: "platform", overdue: false },
    },
    {
      project: "ACTIVE",
      service: "RELOADING",
      verdict: { level: "restarting", by: "platform", overdue: false },
    },
    { project: "ACTIVE", service: "STOPPED", verdict: { level: "inactive", status: "STOPPED" } },
    // Nothing read about the Mate behind an ACTIVE service yet.
    { project: "ACTIVE", service: "ACTIVE", verdict: { level: "unknown" } },
  ];

  for (const row of PLATFORM_ROWS) {
    it(`project ${row.project}, service ${row.service ?? "unread"} → ${row.verdict.level}`, () => {
      const run = drive([
        { type: "PLATFORM", status: { project: row.project, service: row.service } },
      ]);
      expect(containerVerdict(run.machine)).toEqual(row.verdict);
    });
  }

  it("a service the platform brought up boots until a probe sent after it answers", () => {
    const provisioning = drive([
      { type: "PLATFORM", status: { project: "ACTIVE", service: "STARTING" } },
      probed(READY, START_MS),
    ]);
    const up = drive([active], provisioning);
    expect(containerVerdict(up.machine)).toEqual({ level: "booting", overdue: false });
    const answered = drive([probed(READY, up.nowMs)], up);
    expect(containerVerdict(answered.machine)).toEqual({ level: "ready" });
  });

  it("a live socket outranks a boot still guessing", () => {
    const booting = drive([active, probed({ kind: "unreachable" }, START_MS)]);
    const linked = drive([{ type: "LINK", connected: true }], booting);
    expect(containerVerdict(linked.machine)).toEqual({ level: "ready" });
  });

  it("a container predating Mate is Enable only on a flag read off", () => {
    const predates = transitionContainer(
      drive([active]).machine,
      probed({ kind: "predates-mate" }, START_MS),
      { now: instant(START_MS + 5_000) },
    );
    expect(containerVerdict(predates.state)).toEqual({ level: "booting", overdue: false });
    expect(predates.effects).toContainEqual({ kind: "read-mate-flag" });

    const at = { machine: predates.state, nowMs: START_MS + 5_000 };
    expect(containerVerdict(drive([{ type: "MATE_FLAG", flag: "unknown" }], at).machine)).toEqual({
      level: "booting",
      overdue: false,
    });
    const off = drive([{ type: "MATE_FLAG", flag: false }], at);
    expect(containerVerdict(off.machine)).toEqual({ level: "needs-enable" });
    expect(containerVerdict(drive([{ type: "MATE_FLAG", flag: true }], at).machine)).toEqual({
      level: "needs-update",
    });

    // Enable restarts it; back on the same zcp release, it still predates Mate.
    const enabling = drive(
      [
        { type: "INTENT", intent: { kind: "enable", since: instant(off.nowMs + 1_000) } },
        { type: "PLATFORM", status: { project: "ACTIVE", service: "RESTARTING" } },
        active,
      ],
      off,
    );
    expect(containerVerdict(enabling.machine)).toEqual({
      level: "restarting",
      by: "you",
      overdue: false,
    });
    const still = drive([probed({ kind: "predates-mate" }, enabling.nowMs)], enabling);
    expect(containerVerdict(still.machine)).toEqual({ level: "not-yet-available" });
  });

  it("a re-initialized container ends our restart without the platform's push", () => {
    const up = drive([active, probed({ ...READY, initAt: "2026-09-23T08:00:00Z" }, START_MS)]);
    const asked = drive(
      [{ type: "INTENT", intent: { kind: "restart", since: instant(up.nowMs + 1_000) } }],
      up,
    );
    const same = drive([probed({ ...READY, initAt: "2026-09-23T08:00:00Z" }, asked.nowMs)], asked);
    expect(containerVerdict(same.machine).level).toBe("restarting");
    const reinit = drive(
      [probed({ kind: "initializing", initAt: "2026-09-23T09:00:00Z" }, same.nowMs)],
      same,
    );
    expect(containerVerdict(reinit.machine)).toEqual({ level: "booting", overdue: false });
  });

  // The browser's clock runs months ahead of the container's here (START_MS is 2027-01-15T08:00Z):
  // only the last row, ten minutes after it, may lean on comparing the two.
  const REINIT_ROWS: ReadonlyArray<{
    readonly name: string;
    readonly held: ReadonlyArray<ContainerEvent>;
    readonly intent: "restart" | "enable";
    readonly after: ReadonlyArray<ProbeReading>;
  }> = [
    {
      name: "a container predating Mate had no /mate/healthz: any initAt it shows is new",
      held: [
        active,
        probed({ kind: "predates-mate" }, START_MS),
        { type: "MATE_FLAG", flag: false },
      ],
      intent: "enable",
      after: [{ kind: "initializing", initAt: "2026-09-23T09:00:00Z" }],
    },
    {
      name: "no initAt held: the first one read is the old server's, a different one is new",
      held: [active, probed(READY, START_MS)],
      intent: "restart",
      after: [
        { ...READY, initAt: "2026-09-23T08:00:00Z" },
        { kind: "initializing", initAt: "2026-09-23T09:00:00Z" },
      ],
    },
    {
      name: "no initAt held: one later than the restart's start is new at once",
      held: [active, probed(READY, START_MS)],
      intent: "restart",
      after: [{ kind: "initializing", initAt: "2027-01-15T08:10:00.000Z" }],
    },
  ];

  for (const row of REINIT_ROWS) {
    it(`a re-init ends our ${row.intent} whatever the browser's clock says: ${row.name}`, () => {
      const up = drive(row.held);
      let run = drive(
        [{ type: "INTENT", intent: { kind: row.intent, since: instant(up.nowMs + 1_000) } }],
        up,
      );
      for (const reading of row.after) {
        expect(containerVerdict(run.machine).level).toBe("restarting");
        run = drive([probed(reading, run.nowMs)], run);
      }
      expect(containerVerdict(run.machine)).toEqual({ level: "booting", overdue: false });
    });
  }
});
