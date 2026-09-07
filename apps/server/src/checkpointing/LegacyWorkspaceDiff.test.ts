import { it } from "@effect/vitest";
import {
  CheckpointRef,
  TurnId,
  VcsProcessExitError,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";
import { CheckpointStore } from "./CheckpointStore.ts";
import { readLegacyWorkspaceDiff } from "./LegacyWorkspaceDiff.ts";

it.effect(
  "old API/app summaries do not acquire later mounts and keep one diff when another fails",
  () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const store = yield* CheckpointStore;
      const checkpoint: OrchestrationCheckpointSummary = {
        turnId: TurnId.make("old"),
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("refs/old"),
        status: "ready",
        files: ["api/main.ts", "app/main.ts"].map((path) => ({
          path,
          kind: "modified",
          additions: 1,
          deletions: 0,
        })),
        assistantMessageId: null,
        completedAt: "2026-09-07T10:00:00.000Z",
      };
      const result = yield* readLegacyWorkspaceDiff(
        {
          ...store,
          diffCheckpoints: (input) => {
            calls.push(input.cwd);
            return input.cwd.endsWith("/api")
              ? Effect.fail(
                  new VcsProcessExitError({
                    cwd: input.cwd,
                    operation: "test",
                    command: "ssh",
                    exitCode: 255,
                    detail: "unreachable",
                  }),
                )
              : Effect.succeed("diff --git a/main.ts b/main.ts\n");
          },
        },
        {
          cwd: "/var/www",
          repositories: {
            _tag: "available",
            repositories: ["api", "app", "newservice"].map((host) => ({
              host,
              mountPath: `/var/www/${host}`,
              remotePath: "/var/www",
            })),
          },
          checkpoints: [checkpoint],
          fromCheckpointRef: CheckpointRef.make("refs/before"),
          toCheckpointRef: CheckpointRef.make("refs/after"),
          ignoreWhitespace: false,
        },
      );
      expect(calls).toEqual(["/var/www/api", "/var/www/app"]);
      expect(result.diff).toContain("app/main.ts");
      expect(result.coverage).toBe("unknown");
      expect(result.roots.map((r) => r.status)).toEqual(["unavailable", "available"]);
    }).pipe(Effect.provide(Layer.mock(CheckpointStore)({}))),
);

it.effect("an unmounted legacy service is unresolved, never a new local Git target", () =>
  Effect.gen(function* () {
    const store = yield* CheckpointStore;
    const result = yield* readLegacyWorkspaceDiff(store, {
      cwd: "/var/www",
      repositories: { _tag: "available", repositories: [] },
      checkpoints: [],
      fromCheckpointRef: CheckpointRef.make("refs/before"),
      toCheckpointRef: CheckpointRef.make("refs/after"),
      ignoreWhitespace: false,
    });
    expect(result.diff).toBe("");
    expect(result.roots[0]?.status).toBe("identity-unresolved");
    expect(result.coverage).toBe("unknown");
  }).pipe(
    Effect.provide(
      Layer.mock(CheckpointStore)({ diffCheckpoints: () => Effect.die("must not run local git") }),
    ),
  ),
);
