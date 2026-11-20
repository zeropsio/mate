import type { Item } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { expect, it } from "@effect/vitest";
import { it as plainIt } from "vite-plus/test";

import { makeTestEngineHost } from "./__fixtures__/engineHost.ts";
import {
  engineRow,
  engineRun,
  noteItem,
  personItem,
  thoughtItem,
} from "./__fixtures__/mateEngine.ts";
import {
  engineShellChanges,
  engineThreadChanges,
  withEngineLiveText,
} from "./engineThreadChanges.ts";
import type { EnvironmentShellState } from "./adapters/mateShellReplay.ts";
import type { EngineConversationKey } from "./families/mateEngine.ts";
import { readsOfState } from "./store.ts";
import { engineThread } from "./projections/mateEngine.ts";
import type { EnvironmentThreadState } from "../state/threadState.ts";

const ENV = "env-ada";
const key: EngineConversationKey = { environmentId: ENV, conversationId: "thread-ada" };
const run1 = "thread-ada/r/1";

const textsOf = (state: EnvironmentThreadState): ReadonlyArray<string> =>
  Option.match(state.data, {
    onNone: () => [],
    onSome: (thread) => thread.messages.map(({ role, text }) => `${role}: ${text}`),
  });

/** Reads the stream until a state passes, then lets it go. */
const until = (
  stream: Stream.Stream<EnvironmentThreadState>,
  predicate: (state: EnvironmentThreadState) => boolean,
) => stream.pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow));

// witness: packages/client-runtime/src/data/engineThreadChanges.ts | host.live.read(key.environmentId, itemId, stream) → host.live.read(key.conversationId, itemId, stream)
it.effect(
  "ST57: A note's words show as they stream, before its record holds any, then the record's once it settles",
  () =>
    Effect.gen(function* () {
      const h = makeTestEngineHost();
      const running = engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null });
      h.deliver({
        runs: [running],
        items: [personItem(run1, 1, "Deploy the api"), noteItem(run1, 2, "", { streaming: true })],
      });
      const started = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(
        engineThreadChanges(h.host, key).pipe(
          Stream.filter((next) => Option.isSome(next.data)),
          Stream.tap(() => Deferred.succeed(started, undefined)),
          Stream.drop(1),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        ),
      );
      yield* Deferred.await(started);
      h.live.open(key, `${run1}/i/2`, "text", "Deploying");
      h.live.append(key, `${run1}/i/2`, "text", 9, " the");
      const streaming = yield* Fiber.join(fiber);
      expect(textsOf(streaming)).toEqual(["user: Deploy the api", "assistant: Deploying the"]);

      h.deliver({
        runs: [engineRun("thread-ada", 1)],
        items: [noteItem(run1, 2, "Deployed the api.")],
      });
      const settled = yield* until(engineThreadChanges(h.host, key), (next) =>
        Option.isSome(next.data),
      );
      expect(textsOf(settled)).toEqual(["user: Deploy the api", "assistant: Deployed the api."]);
    }),
);

{
  const it = plainIt;

  // witness: packages/client-runtime/src/data/engineThreadChanges.ts | role === "reasoning" ? "reasoning" : "text" → role === "thought" ? "reasoning" : "text"
  it("ST58: A streaming note or thought reads its live text while that holds more than its record; a settled message reads its record, whatever live text is still held", () => {
    const streamingState = (items: ReadonlyArray<Item>) => {
      const h = makeTestEngineHost();
      h.deliver({
        runs: [engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null })],
        items,
      });
      return engineThread.derive(readsOfState(h.host.store.state()), key);
    };

    for (const { items, live, texts } of [
      {
        items: [noteItem(run1, 2, "Dep", { streaming: true })],
        live: { [`${run1}/i/2:text`]: "Deploying" },
        texts: ["assistant: Deploying"],
      },
      {
        items: [thoughtItem(run1, 2, "", { streaming: true })],
        live: { [`${run1}/i/2:reasoning`]: "Checking the build" },
        texts: ["reasoning: Checking the build"],
      },
      {
        items: [noteItem(run1, 2, "Deployed.")],
        live: { [`${run1}/i/2:text`]: "Deplo" },
        texts: ["assistant: Deployed."],
      },
      {
        items: [noteItem(run1, 2, "Dep", { streaming: true })],
        live: {},
        texts: ["assistant: Dep"],
      },
    ]) {
      const state = withEngineLiveText(
        streamingState(items),
        (itemId, stream) => (live as Record<string, string>)[`${itemId}:${stream}`] ?? null,
      );
      expect(textsOf(state)).toEqual(texts);
    }
  });
}

// witness: packages/client-runtime/src/data/engineThreadChanges.ts | overlayEngineShell(shell, rows, held) → overlayEngineShell(shell, rows.filter((row) => held[row.conversationId] !== undefined), held)
it.effect(
  "ST59: Each conversation's menu row lies over its thread shell: working on its run, on the model it runs",
  () =>
    Effect.gen(function* () {
      const shell = {
        snapshot: Option.some({
          snapshotSequence: 1,
          projects: [],
          threads: [
            {
              id: "thread-ada",
              projectId: "project-ada",
              title: "Ada",
              modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-4-5" },
              runtimeMode: "full-access",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              latestTurn: null,
              createdAt: "2026-10-01T00:00:00.000Z",
              updatedAt: "2026-10-01T00:00:00.000Z",
              archivedAt: null,
              settledOverride: null,
              settledAt: null,
              session: null,
              latestUserMessageAt: null,
              hasPendingApprovals: false,
              hasPendingUserInput: false,
              hasActionableProposedPlan: false,
            },
          ],
          updatedAt: "2026-10-01T00:00:00.000Z",
        }),
        status: "live",
        error: Option.none(),
      } as unknown as EnvironmentShellState;
      const threadOf = (state: EnvironmentShellState) =>
        Option.getOrThrow(state.snapshot).threads[0]!;

      const h = makeTestEngineHost();
      h.deliverRows([
        engineRow(ENV, "thread-ada", {
          state: { kind: "working" } as never,
          activeRunId: run1 as never,
          agent: { ...engineRow(ENV, "thread-ada").agent!, model: "claude-opus-4-1" },
        }),
      ]);
      const overlay = yield* engineShellChanges(h.host, ENV).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      const thread = threadOf(overlay(shell));
      expect(thread.session?.status).toBe("running");
      expect(thread.session?.activeTurnId).toBe(run1);
      expect(thread.modelSelection.model).toBe("claude-opus-4-1");
    }),
);
