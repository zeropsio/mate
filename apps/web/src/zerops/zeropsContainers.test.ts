import {
  initialContainer,
  type ContainerMachine,
  type ProbeReading,
} from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  containerSnapshotWithHq,
  serverVersionOf,
  useTargetContainer,
  useZeropsContainers,
} from "./zeropsContainers";

/** What the hooks read: the container store's machines and HQ's Mates in view. */
const held = vi.hoisted(() => ({
  machines: new Map<string, unknown>(),
  mates: null as ReadonlyMap<string, unknown> | null,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => ({ organizationId: "org-1", mates: held.mates, current: true }),
}));
vi.mock("./accountEnvironments", () => ({
  accountEnvironmentsReady: () => new Promise(() => undefined),
  currentAccountEnvironments: () => null,
  useContainerMachines: () => held.machines,
  useEnvironmentMachines: () => new Map(),
}));

/** HQ's presence moved at this instant: its identity holds from then on. */
const SINCE = "2026-10-03T10:00:00.000Z";
const SINCE_MS = Date.parse(SINCE);

const answering = (serverVersion: string): ProbeReading => ({
  kind: "ready",
  descriptor: {
    environmentId: EnvironmentId.make("env-a"),
    serverVersion,
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
  projectId: "project-1",
  initAt: null,
});

/** The container as a read sent `offsetMs` from HQ's `since` left it. */
const readAt = (reading: ProbeReading, offsetMs: number): ContainerMachine => ({
  ...initialContainer(),
  reading: { reading, sentAt: { wall: SINCE_MS + offsetMs, mono: 0 } },
});

const told = (serverVersion: string | null): MateLiveView =>
  ({
    presence: { online: true, since: SINCE, overview: serverVersion === null ? "none" : "live" },
    ...(serverVersion === null
      ? {}
      : { identity: { environmentId: "env-a", serverVersion, update: null } }),
  }) as MateLiveView;

describe("serverVersionOf: the newer of HQ's identity and the last read", () => {
  it.each([
    ["HQ's word alone, for a Mate never read", undefined, told("0.12.0"), "0.12.0"],
    ["the read alone, where HQ knows no Mate", readAt(answering("0.11.9"), 0), undefined, "0.11.9"],
    [
      "the read, where HQ holds the Mate without an overview",
      readAt(answering("0.11.9"), 0),
      told(null),
      "0.11.9",
    ],
    [
      "HQ's word over a read sent before its presence moved",
      readAt(answering("0.11.9"), -60_000),
      told("0.12.0"),
      "0.12.0",
    ],
    [
      "a read sent since, as a restart of ours comes back before HQ hears the Mate",
      readAt(answering("0.12.1"), 60_000),
      told("0.12.0"),
      "0.12.1",
    ],
    [
      "HQ's word over a read that found no Mate answering",
      readAt({ kind: "unreachable" }, 60_000),
      told("0.12.0"),
      "0.12.0",
    ],
    ["nothing, where neither says", readAt({ kind: "unreachable" }, 0), undefined, undefined],
  ] as const)("reads %s", (_name, machine, mate, expected) => {
    expect(serverVersionOf(machine, mate)).toBe(expected);
  });
});

describe("containerSnapshotWithHq: the rows' containers, their versions from HQ too", () => {
  it("gives a Mate never read HQ's version, and one HQ does not know its read's", () => {
    const machines = new Map<string, ContainerMachine>([
      ["project-1:zcp", initialContainer()],
      ["project-2:zcp", readAt(answering("0.11.9"), 0)],
    ]);
    const mates = new Map([["project-1", told("0.12.0")]]);
    expect([...containerSnapshotWithHq(machines, mates).serverVersions]).toEqual([
      ["project-1:zcp", "0.12.0"],
      ["project-2:zcp", "0.11.9"],
    ]);
  });
});

describe("the container hooks: a Mate never read runs the version HQ names", () => {
  const KEY = "project-1:zcp";

  it("useTargetContainer", () => {
    held.machines = new Map([[KEY, initialContainer()]]);
    held.mates = new Map([["project-1", told("0.12.0")]]);
    expect(useTargetContainer(KEY).serverVersion).toBe("0.12.0");
  });

  it("useZeropsContainers", () => {
    held.machines = new Map([[KEY, initialContainer()]]);
    held.mates = new Map([["project-1", told("0.12.0")]]);
    expect(useZeropsContainers().serverVersions.get(KEY)).toBe("0.12.0");
  });
});
