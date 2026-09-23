import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { initialContainer, type ContainerMachine } from "./containerMachine.ts";
import {
  indexDescriptors,
  resolveEnvironment,
  type DescriptorIndex,
  type ResolvedEnvironment,
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

const ready = (environmentId: EnvironmentId): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId,
    serverVersion: "0.12.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  initAt: null,
});

const read = (reading: ProbeReading): ContainerMachine => ({
  ...initialContainer(),
  reading: { reading, sentAt: { wall: 0, mono: 0 } },
});

describe("indexDescriptors", () => {
  const ROWS: ReadonlyArray<{
    readonly name: string;
    readonly machine: EnvironmentMachine;
    readonly container: ContainerMachine | undefined;
    readonly index: DescriptorIndex;
  }> = [
    {
      name: "a descriptor that answered as Mate serves its environment",
      machine: present(KEY),
      container: read(ready(ENV_A)),
      index: {
        serving: new Map([[ENV_A, KEY]]),
        unanswered: [],
        failed: [],
      },
    },
    {
      name: "an origin serving no Mate answered: it holds no environment",
      machine: present(KEY),
      container: read({ kind: "predates-mate" }),
      index: { serving: new Map(), unanswered: [], failed: [] },
    },
    {
      name: "an unread origin is on its way, not failed",
      machine: present(KEY),
      container: initialContainer(),
      index: { serving: new Map(), unanswered: [KEY], failed: [] },
    },
    {
      name: "a target the container store has not listed yet is unread",
      machine: present(KEY),
      container: undefined,
      index: { serving: new Map(), unanswered: [KEY], failed: [] },
    },
    {
      name: "a Mate still coming up has not answered",
      machine: present(KEY),
      container: read({ kind: "initializing", initAt: null }),
      index: { serving: new Map(), unanswered: [KEY], failed: [KEY] },
    },
    {
      name: "an unreachable origin has not answered",
      machine: present(KEY),
      container: read({ kind: "unreachable" }),
      index: { serving: new Map(), unanswered: [KEY], failed: [KEY] },
    },
    {
      name: "a target that is not present is neither indexed nor waited for",
      machine: present(KEY, { presence: { kind: "transitioning", status: "RESTARTING" } }),
      container: read(ready(ENV_A)),
      index: { serving: new Map(), unanswered: [], failed: [] },
    },
  ];

  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const containers = new Map(row.container === undefined ? [] : [[KEY, row.container]]);

    expect(indexDescriptors(new Map([[KEY, row.machine]]), containers)).toEqual(row.index);
  });
});

describe("resolveEnvironment", () => {
  const index = (entries: ReadonlyArray<readonly [string, EnvironmentId]>): DescriptorIndex => ({
    serving: new Map(entries.map(([key, environmentId]) => [environmentId, key])),
    unanswered: [],
    failed: [],
  });

  const resolved = (
    key: string,
    machine: EnvironmentMachine,
    reachability = selectReachability(machine, ENV_A),
  ): ResolvedEnvironment => ({ key, machine, reachability });

  const remembered = present(KEY, { record: ENV_A });
  const deepLinked = present(OTHER);

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
  ];

  it.each(ROWS.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(resolveEnvironment(row.machines, row.index, ENV_A)).toEqual(row.resolved);
  });
});
