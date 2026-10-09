import { it } from "@effect/vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import * as Journal from "../../checkpointing/WorkspaceCaptureJournal.ts";
import * as History from "../../checkpointing/WorkspaceHistory.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import type { EffectRow } from "../outbox/EffectOutbox.ts";
import { AgentWorkspace } from "../ports.ts";
import { makeWorkspaceFinish } from "./workspaceFinish.ts";

const thread = ThreadId.make("conversation");
const cwd = "/var/www";

const harness = Effect.gen(function* () {
  let snapshots = 0;
  const store = CheckpointStore.of({
    isGitRepository: () => Effect.succeed(true),
    captureCheckpoint: () => Effect.die("legacy capture used"),
    captureSnapshot: () =>
      Effect.sync(() => ({
        oid: (++snapshots).toString(16).padStart(40, "0"),
        representation: "git-normalized" as const,
        policyVersion: "git-v1" as const,
        reused: false,
      })),
    resolveSnapshot: ({ expectedOid }) => Effect.succeed(expectedOid ?? null),
    hasCheckpointRef: () => Effect.succeed(true),
    restoreCheckpoint: () => Effect.die("finish must not restore"),
    deleteCheckpointRefs: () => Effect.void,
    diffCheckpoints: () => Effect.succeed(""),
  });
  const history = yield* History.make.pipe(Effect.provideService(CheckpointStore, store));
  const finish = yield* makeWorkspaceFinish.pipe(
    Effect.provideService(History.WorkspaceHistory, history),
    Effect.provideService(
      AgentWorkspace,
      AgentWorkspace.of({ of: () => Effect.succeed({ cwd, runtimeMode: "full-access" }) }),
    ),
  );
  const ended = (runId: string, providerTurnId: string | null) =>
    finish.run({
      conversationId: thread,
      runId,
      payload: { runId, started: providerTurnId !== null, providerTurnId },
    } as unknown as EffectRow);
  return { history, ended, journal: yield* Journal.WorkspaceCaptureJournal };
});

describe("workspace.finish", () => {
  it.effect.each([
    { case: "after its turn", runId: "r/1", turn: "turn-1" },
    { case: "before it started", runId: "r/1", turn: null },
  ])(
    "a run that ended $case lets the next message start at once, beside nothing",
    ({ runId, turn }) =>
      Effect.gen(function* () {
        const h = yield* harness;
        yield* h.history.prepare({ threadId: thread, runId, cwd });
        if (turn !== null) yield* h.history.bindTurn(thread, TurnId.make(turn));
        yield* h.ended(runId, turn);

        const next = yield* h.history
          .prepare({ threadId: thread, runId: "r/2", cwd })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("1 second");
        expect(next.pollUnsafe()).toBeDefined();
        yield* Fiber.join(next);
        const prepared = yield* h.journal.get(thread, "r/2");
        expect(prepared?.phase).toBe("prepared");
        expect(prepared?.history.overlappingRunIds).toBeUndefined();
      }).pipe(Effect.provide(Journal.layer.pipe(Layer.provide(SqlitePersistenceMemory)))),
  );
});
