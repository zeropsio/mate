import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { initialContainer, type ContainerMachine } from "./containerMachine.ts";
import { indexDescriptors } from "./descriptorIndex.ts";
import { initialEnvironment, type EnvironmentMachine } from "./environmentMachine.ts";
import type { ProbeReading } from "./probe.ts";

const ENV_A = EnvironmentId.make("env-a");
const KEY = "project-1:service-1";

const present: EnvironmentMachine = {
  ...initialEnvironment({ record: null }),
  presence: { kind: "present", origin: "https://zcp-1-abc.prg1.zerops.app" },
};

/** The target's container, its descriptor read stating `projectId`. */
const readStating = (projectId: string | null): ContainerMachine => {
  const reading: ProbeReading = {
    kind: "ready",
    descriptor: {
      environmentId: ENV_A,
      serverVersion: "0.16.0",
      update: null,
      identity: "ok",
      identityCheckedAt: null,
    },
    projectId,
    initAt: null,
  };
  return { ...initialContainer(), reading: { reading, sentAt: { wall: 1_000, mono: 1_000 } } };
};

const indexed = (container: ContainerMachine) =>
  indexDescriptors(new Map([[KEY, present]]), new Map([[KEY, container]]));

// witness: packages/client-runtime/src/zerops/environments/descriptorIndex.ts | if (reading.projectId !== projectOf(key)) continue; → if (reading.projectId === null) continue;
it("EN12: A descriptor naming another project or none serves nothing for the target", () => {
  expect(indexed(readStating("project-1"))).toEqual({
    serving: new Map([[ENV_A, KEY]]),
    reported: new Map([[KEY, ENV_A]]),
  });

  const nothing = { serving: new Map(), reported: new Map() };
  expect(indexed(readStating("project-2"))).toEqual(nothing);
  expect(indexed(readStating(null))).toEqual(nothing);
});
