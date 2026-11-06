import {
  initialContainer,
  type ContainerMachine,
  type ProbeReading,
} from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import * as accountEnvironments from "./accountEnvironments";
import {
  containerSnapshotWithHq,
  mateServerVersion,
  useTargetContainer,
  useZeropsContainers,
} from "./zeropsContainers";

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

  function read<T>(hook: () => T): T {
    const atoms = AtomRegistry.make();
    const { store } = mountHqNavigation(atoms, "org-1", { mates: { "project-1": told("0.12.0") } });
    vi.spyOn(accountEnvironments, "useMateLinkValues").mockReturnValue(
      new Map([[KEY, { container: initialContainer(), watched: false }]]) as unknown as ReturnType<
        typeof accountEnvironments.useMateLinkValues
      >,
    );
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let shown: T | undefined;
    let tree: ReactTestRenderer | undefined;
    function Probe() {
      shown = hook();
      return null;
    }
    try {
      act(() => {
        tree = create(createElement(RegistryContext, { value: atoms }, createElement(Probe)));
      });
      if (shown === undefined) throw new Error("container hook did not render");
      return shown;
    } finally {
      act(() => tree?.unmount());
      store.close();
      atoms.dispose();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  }

  it("useTargetContainer", () => {
    expect(read(() => useTargetContainer(KEY)).serverVersion).toBe("0.12.0");
  });

  it("useZeropsContainers", () => {
    expect(read(useZeropsContainers).serverVersions.get(KEY)).toBe("0.12.0");
  });
});
