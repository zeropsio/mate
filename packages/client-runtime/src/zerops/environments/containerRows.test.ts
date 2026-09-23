import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsContainerHealth } from "../provisioning.ts";
import {
  initialContainer,
  type ContainerLevel,
  type ContainerMachine,
} from "./containerMachine.ts";
import { containerHealthOf, containerSnapshotOf } from "./containerRows.ts";
import type { ProbeReading } from "./probeStore.ts";

const SINCE = { wall: 1_800_000_000_000, mono: 0 };

const READY: ProbeReading = {
  kind: "ready",
  descriptor: {
    environmentId: EnvironmentId.make("env-a"),
    serverVersion: "0.11.40",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId: "project-1",
  initAt: null,
};

const machine = (
  state: ContainerLevel,
  overrides: Partial<ContainerMachine> = {},
): ContainerMachine => ({ ...initialContainer(), state, ...overrides });

const read = (reading: ProbeReading) => ({ reading: { reading, sentAt: SINCE } });

const ROWS: ReadonlyArray<{
  readonly name: string;
  readonly machine: ContainerMachine;
  readonly health: ZeropsContainerHealth | undefined;
}> = [
  { name: "nothing read yet", machine: machine({ level: "unknown" }), health: undefined },
  { name: "ready", machine: machine({ level: "ready" }, read(READY)), health: "ready" },
  {
    name: "ready, and a probe since went unanswered",
    machine: machine({ level: "ready" }, read({ kind: "unreachable" })),
    health: "unreachable",
  },
  {
    name: "ready on a live socket, whatever a probe said before it",
    machine: machine(
      { level: "ready" },
      { ...read({ kind: "unreachable" }), connectedSince: SINCE },
    ),
    health: "ready",
  },
  {
    name: "booting on a container answering /healthz",
    machine: machine(
      { level: "booting", since: SINCE, guessed: false },
      read({ kind: "initializing", initAt: null }),
    ),
    health: "initializing",
  },
  {
    name: "booting on a container that does not answer",
    machine: machine(
      { level: "booting", since: SINCE, guessed: true },
      read({ kind: "unreachable" }),
    ),
    health: "unreachable",
  },
  {
    name: "a boot past its cap",
    machine: machine({ level: "booting", since: SINCE, guessed: false }, { overdue: true }),
    health: "stalled",
  },
  {
    name: "our restart, on its way back",
    machine: machine(
      {
        level: "restarting",
        by: "you",
        since: SINCE,
        baseline: { kind: "unread" },
        platformEnded: null,
      },
      read({ kind: "unreachable" }),
    ),
    health: "initializing",
  },
  {
    name: "an update past its budget",
    machine: machine({ level: "updating", since: SINCE, from: "0.11.40" }, { overdue: true }),
    health: "stalled",
  },
  { name: "needs Enable", machine: machine({ level: "needs-enable" }), health: "predates-mate" },
  { name: "needs an update", machine: machine({ level: "needs-update" }), health: "predates-mate" },
  {
    name: "not yet available",
    machine: machine({ level: "not-yet-available" }),
    health: "predates-mate",
  },
  {
    name: "a stopped container keeps what was read",
    machine: machine({ level: "inactive", status: "STOPPED" }, read({ kind: "unreachable" })),
    health: "unreachable",
  },
];

describe("the container store in the rows' words", () => {
  for (const row of ROWS) {
    it(`${row.name} → ${row.health ?? "absent"}`, () => {
      expect(containerHealthOf(row.machine)).toBe(row.health);
    });
  }

  it("carries the server version a descriptor reported and the Mate flag as read", () => {
    const snapshot = containerSnapshotOf(
      new Map([
        ["p1:s1", machine({ level: "ready" }, read(READY))],
        ["p2:s2", machine({ level: "needs-enable" }, { mateFlag: false })],
        ["p3:s3", machine({ level: "unknown" })],
      ]),
    );
    expect([...snapshot.serverVersions]).toEqual([["p1:s1", "0.11.40"]]);
    expect([...snapshot.mateFlags]).toEqual([["p2:s2", false]]);
    expect([...snapshot.health.keys()]).toEqual(["p1:s1", "p2:s2"]);
  });
});
