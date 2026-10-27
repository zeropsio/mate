import { expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { overlayEngineShell } from "@t3tools/client-runtime/data";
import {
  createEnvironmentThreadShellAtoms,
  mergeEnvironmentThread,
} from "@t3tools/client-runtime/state/threads";
import { engineRow, engineRun, engineThreadOfRecords } from "@t3tools/client-runtime/data/fixtures";
import { resolveThreadDetailRef } from "../state/entities";
import { derivePhase } from "../session-logic";
import {
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  resolveDraftPromotionNavigationTarget,
  threadHasStarted,
} from "./ChatView.logic";

it("a fresh engine draft consumes the sidebar's terminal run verdict and settles Sending", () => {
  const environmentId = EnvironmentId.make("env-ada");
  const threadId = ThreadId.make("fresh-draft-thread");
  const ref = { environmentId, threadId };
  const failure = "The conversation has no agent to open a session for.";
  const run = engineRun(threadId, 1, { end: { kind: "failed", reason: failure, next: null } });
  const row = engineRow(environmentId, threadId, {
    agent: null,
    state: { kind: "failed", errorLine: failure },
    latestRun: { id: run.id, end: run.end, endedAt: run.endedAt, turnState: "error" },
    subject: "First ask",
  });
  const source = {
    status: "live" as const,
    error: Option.none(),
    snapshot: Option.some({
      snapshotSequence: 1,
      projects: [{ id: "project-ada" }],
      threads: [],
      updatedAt: "2026-10-09T00:00:00.000Z",
    }),
  } as unknown as Parameters<typeof overlayEngineShell>[0];
  const projected = overlayEngineShell(source, [row]);
  const shells = createEnvironmentThreadShellAtoms({
    catalogValueAtom: Atom.make({ isReady: true, entries: new Map() }),
    snapshotAtom: () => Atom.make(Option.getOrNull(projected.snapshot)),
  });
  const registry = AtomRegistry.make();
  try {
    const inferred =
      registry
        .get(shells.environmentThreadRefsAtom(environmentId))
        .find((candidate) => candidate.threadId === threadId) ?? null;
    expect(
      inferred,
      "ASSERTION: the fresh draft resolves the same failed engine conversation as the sidebar",
    ).toEqual(ref);
    const shell = registry.get(shells.threadShellAtom(ref));
    const detailRef = resolveThreadDetailRef(ref, {
      shellExists: shell !== null,
      waitForShell: true,
    });
    expect(detailRef).toEqual(ref);
    const detail = engineThreadOfRecords(
      { environmentId, conversationId: threadId },
      { runs: [run], items: [], row },
    );
    const thread = mergeEnvironmentThread(
      detail === null ? null : { ...detail, environmentId },
      shell,
    );
    expect(thread?.session?.lastError).toBe(failure);
    expect(thread?.latestTurn?.state).toBe("error");
    expect(
      resolveDraftPromotionNavigationTarget({
        serverThreadRef: inferred,
        serverThreadStarted: threadHasStarted(thread),
        backgroundSubmissionPending: false,
      }),
    ).toEqual(ref);
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch: createLocalDispatchSnapshot(undefined),
        phase: derivePhase(thread?.session ?? null),
        latestTurn: thread?.latestTurn ?? null,
        session: thread?.session ?? null,
        latestUserMessageId: null,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
      "ASSERTION: the terminal engine verdict clears Sending without a timeout",
    ).toBe(true);
  } finally {
    registry.dispose();
  }
});
