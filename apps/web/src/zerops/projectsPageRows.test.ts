import { Atom, AtomRegistry } from "effect/reactivity";
import { ThreadId } from "@t3tools/contracts";
import { buildZeropsGroupTree } from "@t3tools/client-runtime/zerops";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ZeropsAgentActivity } from "./agentActivity";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

vi.mock("./mateActivityAtoms", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    mateActivityAtom: Atom.family(() => Atom.make<ZeropsAgentActivity | undefined>(undefined)),
  };
});
vi.mock("~/state/shell", async () => {
  const { Atom } = await import("effect/reactivity");
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

// The page consumes these rows; unrelated HQ detail must not replace a Mate's own evidence.
import { accountReadsAtom, makeAccountStore } from "@t3tools/client-runtime/data";
import { seedHqNavigation } from "@t3tools/client-runtime/data/fixtures";
import { EnvironmentId } from "@t3tools/contracts";
import { projectRowLine } from "~/components/zerops/projects/projectsView.logic";

function pageRow(input: ZeropsAgentActivity | undefined, signedOut = false) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  registry.set(accountReadsAtom, {
    orgId: "org",
    data: store.data,
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
  if (signedOut)
    seedHqNavigation(store, "org", {
      mates: {
        Ada: {
          presence: { online: true, since: "2026-10-09T00:00:00Z", overview: "live" },
          identity: {
            environmentId: EnvironmentId.make("env-Ada"),
            serverVersion: "0.14.35",
            update: null,
          },
          main: null,
          threads: { list: [], omitted: 0 },
          logins: { "claude-code": { present: false, signedInBy: null, token: false } },
          crew: { status: "off" },
        },
      },
    });
  registry.set(mateActivityAtom("Ada") as Atom.Writable<ZeropsAgentActivity | undefined>, input);
  const atom = projectsRowsAtom({
    groups: buildZeropsGroupTree([candidate("Ada")], { order: "name" }).groups,
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
  const row = registry.get(atom)[0]!;
  const line = projectRowLine({
    flow: row.flow,
    activities: row.activities,
    lastMerged: row.lastMerged,
    settled: true,
  });
  registry.dispose();
  return { row, line };
}

it("Projects names a provider limit with the same cause and severity as the Mate", () => {
  const { row, line } = pageRow({
    ...activity("Redesign checkout"),
    kind: "failed",
    face: "needs",
    limit: { kind: "limited", turnId: null, provider: "Claude", resetsAt: null },
  });
  expect(line).toMatchObject({
    kind: "needs-you",
    text: "Ada hit the Claude limit.",
    tone: "attention",
  });
  expect(row.flow.nextStep).toMatchObject({
    verb: "Open",
    target: { kind: "mate", projectId: "Ada" },
  });
});
it("Projects names proven missing sign-in and opens the affected Mate", () => {
  const { row, line } = pageRow(undefined, true);
  expect(line).toMatchObject({
    kind: "needs-you",
    text: expect.stringContaining("sign"),
    tone: "attention",
  });
  expect(row.flow.nextStep).toMatchObject({
    verb: "Sign in",
    target: { kind: "mate", projectId: "Ada" },
  });
});
it("Projects leads with the latest reply and its time while retaining the old request second", () => {
  const { line } = pageRow({
    ...activity("Redesign checkout"),
    kind: "idle",
    face: "idle",
    snippet: "Checkout is redesigned and verified.",
  });
  expect(line).toMatchObject({
    kind: "mate",
    text: "Checkout is redesigned and verified.",
    request: "Redesign checkout",
    at: "2026-10-08T00:00:00Z",
  });
});
