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
  mateServerVersion,
  useTargetContainer,
  useZeropsContainers,
} from "./zeropsContainers";

/** What the hooks read: each Mate as the account's store holds it, and HQ's Mates in view. */
const held = vi.hoisted(() => ({
  links: new Map<string, unknown>(),
  mates: null as ReadonlyMap<string, unknown> | null,
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () =>
    Object.fromEntries(
      [...(held.mates ?? [])].map(([id, mate]) => [
        id,
        (mate as MateLiveView).identity?.serverVersion,
      ]),
    ),
}));
vi.mock("./accountEnvironments", () => ({
  accountEnvironmentsReady: () => new Promise(() => undefined),
  currentAccountEnvironments: () => null,
  useMateLinkValues: () => held.links,
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

/** A Mate as the account's store holds it: its container's last read, and whether it is read now. */
const link = (reading: ProbeReading, watched: boolean) => ({
  container: readAt(reading, 0),
  watched,
});

describe("mateServerVersion: a read Mate's own word, else HQ's", () => {
  it.each([
    ["HQ's word alone, for a Mate never read", undefined, told("0.12.0"), "0.12.0"],
    [
      "the read alone, where HQ knows no Mate",
      link(answering("0.11.9"), false),
      undefined,
      "0.11.9",
    ],
    [
      "the read, where HQ holds the Mate without an overview",
      link(answering("0.11.9"), false),
      told(null),
      "0.11.9",
    ],
    [
      "HQ's word over a read no longer current: nothing reads the Mate now",
      link(answering("0.11.9"), false),
      told("0.12.0"),
      "0.12.0",
    ],
    [
      "the Mate's own read while it is read, as a restart of ours comes back before HQ hears it",
      link(answering("0.12.1"), true),
      told("0.12.0"),
      "0.12.1",
    ],
    [
      "HQ's word over a read that found no Mate answering",
      link({ kind: "unreachable" }, true),
      told("0.12.0"),
      "0.12.0",
    ],
    ["nothing, where neither says", link({ kind: "unreachable" }, true), undefined, undefined],
  ] as const)("reads %s", (_name, mate, hq, expected) => {
    expect(mateServerVersion(mate, hq)).toBe(expected);
  });
});

describe("containerSnapshotWithHq: the rows' containers, their versions from HQ too", () => {
  it("gives a Mate never read HQ's version, and one HQ does not know its read's", () => {
    const links = new Map([
      ["project-1:zcp", { container: initialContainer(), watched: false }],
      ["project-2:zcp", link(answering("0.11.9"), true)],
    ]);
    const mates = new Map([["project-1", told("0.12.0")]]);
    expect([...containerSnapshotWithHq(links, mates).serverVersions]).toEqual([
      ["project-1:zcp", "0.12.0"],
      ["project-2:zcp", "0.11.9"],
    ]);
  });
});

describe("the container hooks: a Mate never read runs the version HQ names", () => {
  const KEY = "project-1:zcp";

  it("useTargetContainer", () => {
    held.links = new Map([[KEY, { container: initialContainer(), watched: false }]]);
    held.mates = new Map([["project-1", told("0.12.0")]]);
    expect(useTargetContainer(KEY).serverVersion).toBe("0.12.0");
  });

  it("useZeropsContainers", () => {
    held.links = new Map([[KEY, { container: initialContainer(), watched: false }]]);
    held.mates = new Map([["project-1", told("0.12.0")]]);
    expect(useZeropsContainers().serverVersions.get(KEY)).toBe("0.12.0");
  });
});
