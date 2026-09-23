import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { initialContainer, type ContainerMachine } from "./containerMachine.ts";
import {
  indexDescriptors,
  resolveEnvironment,
  sweepRead,
  type DescriptorIndex,
  type ResolvedEnvironment,
  type SweepRead,
} from "./descriptorIndex.ts";
import { initialEnvironment, type EnvironmentMachine } from "./environmentMachine.ts";
import type { ProbeReading } from "./probeStore.ts";
import { selectReachability } from "./reachability.ts";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const KEY = "project-1:service-1";
const OTHER = "project-2:service-2";

const present = (key: string, overrides: Partial<EnvironmentMachine> = {}): EnvironmentMachine => ({
  ...initialEnvironment({ record: null }),
  presence: { kind: "present", origin: `https://${key.replace(":", "-")}.prg1.zerops.app` },
  ...overrides,
});

/** A descriptor that answered as Mate, stating `KEY`'s project unless told otherwise. */
const ready = (
  environmentId: EnvironmentId,
  projectId: string | null = "project-1",
): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId,
  initAt: null,
});

const at = (ms: number) => ({ wall: ms, mono: ms });

/** A container whose probe, sent at `sentMs`, read this. */
const read = (reading: ProbeReading, sentMs = 0): ContainerMachine => ({
  ...initialContainer(),
  reading: { reading, sentAt: at(sentMs) },
});

const HELD_A = {
  kind: "held",
  environmentId: ENV_A,
  installed: true,
  staleBlock: false,
  rereading: null,
} as const;

describe("indexDescriptors", () => {
  const ROWS: ReadonlyArray<{
    readonly name: string;
    readonly machine: EnvironmentMachine;
    readonly container: ContainerMachine | undefined;
    /** When the sweep asked for `KEY` to be read again, if it did. */
    readonly rereadMs?: number;
    readonly index: DescriptorIndex;
  }> = [
    {
      name: "a descriptor that answered as Mate serves its environment",
      machine: present(KEY),
      container: read(ready(ENV_A)),
      index: {
        serving: new Map([[ENV_A, KEY]]),
        reported: new Map([[KEY, ENV_A]]),
        unanswered: [],
        failed: [],
      },
    },
    {
      name: "a descriptor stating another project answered, and serves nothing for this target",
      machine: present(KEY),
      container: read(ready(ENV_A, "project-2")),
      index: { serving: new Map(), reported: new Map(), unanswered: [], failed: [] },
    },
    {
      name: "a descriptor stating no project answered, and serves nothing for this target",
      machine: present(KEY),
      container: read(ready(ENV_A, null)),
      index: { serving: new Map(), reported: new Map(), unanswered: [], failed: [] },
    },
    {
      name: "an origin serving no Mate answered: it holds no environment",
      machine: present(KEY),
      container: read({ kind: "predates-mate" }),
      index: { serving: new Map(), reported: new Map(), unanswered: [], failed: [] },
    },
    {
      name: "an unread origin is on its way, not failed",
      machine: present(KEY),
      container: initialContainer(),
      index: { serving: new Map(), reported: new Map(), unanswered: [KEY], failed: [] },
    },
    {
      name: "a target the container store has not listed yet is unread",
      machine: present(KEY),
      container: undefined,
      index: { serving: new Map(), reported: new Map(), unanswered: [KEY], failed: [] },
    },
    {
      name: "a Mate still coming up has not answered: read again",
      machine: present(KEY),
      container: read({ kind: "initializing", initAt: null }),
      index: { serving: new Map(), reported: new Map(), unanswered: [KEY], failed: [KEY] },
    },
    {
      name: "a Mate still coming up when the sweep read it again has not answered",
      machine: present(KEY),
      container: read({ kind: "initializing", initAt: null }, 5),
      rereadMs: 5,
      index: { serving: new Map(), reported: new Map(), unanswered: [KEY], failed: [KEY] },
    },
    {
      name: "an unreachable origin (a network or CORS failure) read once has not answered: read again",
      machine: present(KEY),
      container: read({ kind: "unreachable" }),
      index: { serving: new Map(), reported: new Map(), unanswered: [KEY], failed: [KEY] },
    },
    {
      name: "an unreachable origin whose reading left before the sweep's re-read has not answered",
      machine: present(KEY),
      container: read({ kind: "unreachable" }, 4),
      rereadMs: 5,
      index: { serving: new Map(), reported: new Map(), unanswered: [KEY], failed: [KEY] },
    },
    {
      name: "an unreachable origin the sweep read again, failing again, answered as failed",
      machine: present(KEY),
      container: read({ kind: "unreachable" }, 5),
      rereadMs: 5,
      index: { serving: new Map(), reported: new Map(), unanswered: [], failed: [KEY] },
    },
    {
      name: "a target that is not present is neither indexed nor waited for",
      machine: present(KEY, { presence: { kind: "transitioning", status: "RESTARTING" } }),
      container: read(ready(ENV_A)),
      index: { serving: new Map(), reported: new Map(), unanswered: [], failed: [] },
    },
  ];

  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const containers = new Map(row.container === undefined ? [] : [[KEY, row.container]]);
    const reread = new Map(row.rereadMs === undefined ? [] : [[KEY, at(row.rereadMs)]]);

    expect(indexDescriptors(new Map([[KEY, row.machine]]), containers, reread)).toEqual(row.index);
  });
});

describe("sweepRead", () => {
  const ASKED = at(3_000);
  const ROWS: ReadonlyArray<{
    readonly name: string;
    readonly container: ContainerMachine;
    readonly read: SweepRead;
  }> = [
    {
      name: "a Mate coming up is read on its poll, a poll interval after the failure the sweep saw",
      container: {
        ...read({ kind: "unreachable" }, 2_500),
        state: { level: "booting", since: at(0) },
      },
      read: { from: at(4_500), request: false },
    },
    {
      name: "a Mate past its boot budget is read on its overdue poll, never sooner",
      container: {
        ...read({ kind: "unreachable" }, 2_500),
        state: { level: "booting", since: at(0) },
        overdue: true,
      },
      read: { from: at(4_500), request: false },
    },
    {
      name: "a Mate no poll reads, its link up, is read once more now",
      container: {
        ...read({ kind: "unreachable" }, 2_500),
        state: { level: "ready" },
        connectedSince: at(1_000),
      },
      read: { from: ASKED, request: true },
    },
  ];

  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(sweepRead(row.container, ASKED)).toEqual(row.read);
  });
});

describe("resolveEnvironment", () => {
  const index = (entries: ReadonlyArray<readonly [string, EnvironmentId]>): DescriptorIndex => ({
    serving: new Map(entries.map(([key, environmentId]) => [environmentId, key])),
    reported: new Map(entries),
    unanswered: [],
    failed: [],
  });

  const resolved = (
    key: string,
    machine: EnvironmentMachine,
    reachability = selectReachability(machine, ENV_A),
  ): ResolvedEnvironment => ({ key, machine, reachability });

  const remembered = present(KEY, { record: ENV_A });
  const holding = present(KEY, {
    record: ENV_A,
    credential: HELD_A,
    link: { phase: "connected", since: { wall: 0, mono: 0 } },
  });
  const holdingB = present(KEY, {
    record: ENV_B,
    credential: { ...HELD_A, environmentId: ENV_B },
    link: { phase: "connected", since: { wall: 0, mono: 0 } },
  });
  const deepLinked = present(OTHER);
  const goneRemembered = present(KEY, {
    record: ENV_A,
    presence: { kind: "gone", evidence: "direct-not-found" },
  });

  const ROWS: ReadonlyArray<{
    readonly name: string;
    readonly machines: ReadonlyMap<string, EnvironmentMachine>;
    readonly index: DescriptorIndex;
    readonly resolved: ResolvedEnvironment | undefined;
  }> = [
    {
      name: "nothing names it",
      machines: new Map([[KEY, present(KEY)]]),
      index: index([[KEY, ENV_B]]),
      resolved: undefined,
    },
    {
      name: "only a descriptor serves it: a deep link on a device with no record",
      machines: new Map([[OTHER, deepLinked]]),
      index: index([[OTHER, ENV_A]]),
      resolved: resolved(OTHER, deepLinked),
    },
    {
      name: "a record names it ahead of another target's descriptor",
      machines: new Map([
        [KEY, remembered],
        [OTHER, deepLinked],
      ]),
      index: index([
        [KEY, ENV_A],
        [OTHER, ENV_A],
      ]),
      resolved: resolved(KEY, remembered),
    },
    {
      name: "the remembered target's descriptor reports another environment: replaced",
      machines: new Map([[KEY, remembered]]),
      index: index([[KEY, ENV_B]]),
      resolved: resolved(KEY, remembered, { kind: "replaced", by: ENV_B }),
    },
    {
      name: "a credential held for it is judged by its link, never by an older reading",
      machines: new Map([[KEY, holding]]),
      index: index([[KEY, ENV_B]]),
      resolved: resolved(KEY, holding),
    },
    {
      name: "found only by its descriptor, with a credential held for another: waits on the descriptor",
      machines: new Map([[KEY, holdingB]]),
      index: index([[KEY, ENV_A]]),
      resolved: resolved(KEY, holdingB, { kind: "connecting", waitingOn: "descriptor" }),
    },
    {
      name: "gone outranks the descriptor's replacement",
      machines: new Map([[KEY, goneRemembered]]),
      index: index([[KEY, ENV_B]]),
      resolved: resolved(KEY, goneRemembered, { kind: "gone", because: "direct-not-found" }),
    },
  ];

  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(resolveEnvironment(row.machines, row.index, ENV_A)).toEqual(row.resolved);
  });
});
