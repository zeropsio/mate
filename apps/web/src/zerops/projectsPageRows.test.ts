import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { ThreadId } from "@t3tools/contracts";
import { buildZeropsGroupTree } from "@t3tools/client-runtime/zerops";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ZeropsAgentActivity } from "./agentActivity";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

vi.mock("./mateActivityAtoms", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    mateActivityAtom: Atom.family(() => Atom.make<ZeropsAgentActivity | undefined>(undefined)),
  };
});
vi.mock("~/state/shell", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { environmentsWithSnapshotAtom: Atom.make(new Set()) };
});
import { mateActivityAtom } from "./mateActivityAtoms";
import { projectsRowsAtom } from "./projectsPageRows";

const candidate = (id: string): ZeropsCandidatePresentation => ({
  project: {
    id,
    name: id,
    status: "ACTIVE",
    hq: { appId: id, appName: id, kind: "mate", mate: { face: "face" } },
  },
  group: "ready",
  key: id,
  presence: "known",
});
const activity = (subject: string): ZeropsAgentActivity => ({
  threadId: ThreadId.make("thread"),
  threadKey: "test:thread",
  task: subject,
  kind: "working",
  status: null,
  face: "working",
  subject,
  at: "2026-10-08T00:00:00Z",
  snippet: undefined,
  unread: false,
  pausedUntil: undefined,
});

describe("Projects keyed rows", () => {
  it("updates the changed Mate's visible task while preserving its neighbor's row value", () => {
    const registry = AtomRegistry.make();
    const groups = buildZeropsGroupTree([candidate("Ada"), candidate("Bea")], {
      order: "name",
    }).groups;
    const atom = projectsRowsAtom({
      groups,
      flows: {
        hqAddress: undefined,
        readFailure: undefined,
        groupsRead: false,
        knownGroups: new Set(),
        flows: new Map(),
        releaseFailures: new Map(),
      },
      deployments: new Map(),
      lines: new Map(),
    });
    const release = registry.mount(atom);
    const before = registry.get(atom);
    registry.set(
      mateActivityAtom("Ada") as Atom.Writable<ZeropsAgentActivity | undefined>,
      activity("Inspect checkout"),
    );
    const after = registry.get(atom);
    expect(after[0]?.activities[0]?.subject).toBe("Inspect checkout");
    expect(after[1]).toBe(before[1]);
    release();
    registry.dispose();
  });
});
