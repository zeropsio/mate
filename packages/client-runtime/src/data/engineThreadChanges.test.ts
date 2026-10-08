import { EnvironmentId, ThreadId, type Item } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";

import { requestOlderThreadTurns } from "./adapters/mateThreadReplay.ts";
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

describe("an engine Mate's conversation, for a reader that draws thread states", () => {
  it.effect(
    "reads the conversation's records as the thread: the person's words and the agent's answer",
    () =>
      Effect.gen(function* () {
        const h = makeTestEngineHost();
        h.deliver({
          runs: [engineRun("thread-ada", 1)],
          items: [personItem(run1, 1, "Deploy the api"), noteItem(run1, 2, "Deployed.")],
        });
        const state = yield* until(engineThreadChanges(h.host, key), (next) =>
          Option.isSome(next.data),
        );
        expect(textsOf(state)).toEqual(["user: Deploy the api", "assistant: Deployed."]);
      }),
  );

  it.effect(
    "shows a note's words as they stream, before its record holds any, then the record's once it settles",
    () =>
      Effect.gen(function* () {
        const h = makeTestEngineHost();
        const running = engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null });
        h.deliver({
          runs: [running],
          items: [
            personItem(run1, 1, "Deploy the api"),
            noteItem(run1, 2, "", { streaming: true }),
          ],
        });
        const fiber = yield* Effect.forkChild(
          until(engineThreadChanges(h.host, key), (next) =>
            textsOf(next).includes("assistant: Deploying the"),
          ),
        );
        yield* Effect.yieldNow;
        h.live.open(key, `${run1}/i/2`, "text", "Deploying");
        h.live.append(key, `${run1}/i/2`, "text", 9, " the");
        const streaming = yield* Fiber.join(fiber);
        expect(textsOf(streaming)).toEqual(["user: Deploy the api", "assistant: Deploying the"]);

        h.deliver({
          runs: [engineRun("thread-ada", 1)],
          items: [noteItem(run1, 2, "Deployed the api.")],
        });
        const settled = yield* until(engineThreadChanges(h.host, key), (next) =>
          textsOf(next).includes("assistant: Deployed the api."),
        );
        expect(textsOf(settled)).toEqual(["user: Deploy the api", "assistant: Deployed the api."]);
      }),
  );

  it.effect("holds the conversation while it is read and lets it go when the reader leaves", () =>
    Effect.gen(function* () {
      const h = makeTestEngineHost();
      h.deliver({ runs: [engineRun("thread-ada", 1)], items: [personItem(run1, 1, "Hi")] });
      yield* until(engineThreadChanges(h.host, key), (next) => {
        expect(h.counts.held).toBe(1);
        return Option.isSome(next.data);
      });
      expect(h.counts.held).toBe(0);
    }),
  );

  it.effect("loads earlier run groups when the reader asks for older turns", () =>
    Effect.gen(function* () {
      const h = makeTestEngineHost();
      h.deliver({
        runs: [engineRun("thread-ada", 3)],
        items: [personItem("thread-ada/r/3", 1, "Hi")],
      });
      yield* until(engineThreadChanges(h.host, key), (next) => {
        if (Option.isNone(next.data)) return false;
        expect(Option.isSome(next.page)).toBe(true);
        requestOlderThreadTurns(EnvironmentId.make(ENV), ThreadId.make("thread-ada"));
        return true;
      });
      expect(h.counts.earlier).toBe(1);
    }),
  );
});

describe("a streaming message's words so far", () => {
  const streamingState = (items: ReadonlyArray<Item>) => {
    const h = makeTestEngineHost();
    h.deliver({
      runs: [engineRun("thread-ada", 1, { state: "running", end: null, endedAt: null })],
      items,
    });
    return engineThread.derive(readsOfState(h.host.store.state()), key);
  };

  it.each([
    {
      name: "a streaming note reads the live text when it holds more than its record",
      items: [noteItem(run1, 2, "Dep", { streaming: true })],
      live: { [`${run1}/i/2:text`]: "Deploying" },
      texts: ["assistant: Deploying"],
    },
    {
      name: "a thought's reasoning reads as it streams",
      items: [thoughtItem(run1, 2, "", { streaming: true })],
      live: { [`${run1}/i/2:reasoning`]: "Checking the build" },
      texts: ["reasoning: Checking the build"],
    },
    {
      name: "a settled message reads its record, whatever live text is still held",
      items: [noteItem(run1, 2, "Deployed.")],
      live: { [`${run1}/i/2:text`]: "Deplo" },
      texts: ["assistant: Deployed."],
    },
    {
      name: "a streaming message whose live text is not held reads as its record says",
      items: [noteItem(run1, 2, "Dep", { streaming: true })],
      live: {},
      texts: ["assistant: Dep"],
    },
  ])("$name", ({ items, live, texts }) => {
    const state = withEngineLiveText(
      streamingState(items),
      (itemId, stream) => (live as Record<string, string>)[`${itemId}:${stream}`] ?? null,
    );
    expect(textsOf(state)).toEqual(texts);
  });
});

describe("an engine Mate's menu, for a reader that draws its V1 shell", () => {
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
  const threadOf = (state: EnvironmentShellState) => Option.getOrThrow(state.snapshot).threads[0]!;

  it.effect(
    "lays each conversation's row over its thread shell: working on its run, on the model it runs",
    () =>
      Effect.gen(function* () {
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

  it.effect("holds the Mate's rows while its menu is read and lets them go after", () =>
    Effect.gen(function* () {
      const h = makeTestEngineHost();
      yield* engineShellChanges(h.host, ENV).pipe(
        Stream.tap(() =>
          Effect.sync(() => {
            expect(h.counts.rowsHeld).toBe(1);
          }),
        ),
        Stream.runHead,
      );
      expect(h.counts.rowsHeld).toBe(0);
    }),
  );

  it.effect("leaves the shell as it is while the Mate has no rows", () =>
    Effect.gen(function* () {
      const h = makeTestEngineHost();
      const overlay = yield* engineShellChanges(h.host, ENV).pipe(
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      expect(overlay(shell)).toBe(shell);
    }),
  );
});
