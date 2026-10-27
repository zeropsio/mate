import { EnvironmentId, OrchestrationShellSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
  parseArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";

const decodeShellSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);

it("round-trips environment keys in sorted order", () => {
  const envA = EnvironmentId.make("env-a");
  const envB = EnvironmentId.make("env-b");
  const key = makeArchivedThreadsEnvironmentKey([envB, envA]);

  expect(parseArchivedThreadsEnvironmentKey(key)).toEqual([envA, envB]);
});

it("does not expose an archived snapshot failure message", () => {
  const environmentId = EnvironmentId.make("env-sensitive");
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily<Error>({
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.failure<OrchestrationShellSnapshot, Error>(
          Cause.fail(new Error("credential=secret-value")),
        ),
      ),
    labelPrefix: "test:archived-thread-snapshots",
  });
  const registry = AtomRegistry.make();

  expect(registry.get(snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId])))).toEqual({
    snapshots: [],
    error: "Failed to load archived threads.",
    isLoading: false,
  });

  registry.dispose();
});

it("lists the person's archived threads and never a crewmate's retired stint", () => {
  const environmentId = EnvironmentId.make("env-crew");
  const archived = (id: string, extra: object) => ({
    id,
    projectId: "project-1",
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-27T08:00:00.000Z",
    updatedAt: "2026-09-27T09:00:00.000Z",
    archivedAt: "2026-09-27T09:00:00.000Z",
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...extra,
  });
  const snapshot = decodeShellSnapshot({
    snapshotSequence: 1,
    projects: [],
    threads: [
      archived("thread-person", {}),
      archived("thread-retired-stint", { crew: { crew: "shop", crewmate: "backend", stint: 1 } }),
    ],
    updatedAt: "2026-09-27T09:00:00.000Z",
  });
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily<Error>({
    getSnapshotAtom: () => Atom.make(AsyncResult.success(snapshot)),
    labelPrefix: "test:archived-thread-snapshots",
  });
  const registry = AtomRegistry.make();

  const { snapshots } = registry.get(
    snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId])),
  );
  expect(snapshots.map((entry) => entry.environmentId)).toEqual([environmentId]);
  expect(snapshots[0]?.snapshot.threads.map((thread) => thread.id)).toEqual(["thread-person"]);

  registry.dispose();
});
