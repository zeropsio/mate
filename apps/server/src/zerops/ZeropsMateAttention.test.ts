import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationThreadShell,
  ProjectId,
  type MateAttention,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { type AttentionEvent, makeZeropsMateAttention } from "./ZeropsMateAttention.ts";

const decodeShell = Schema.decodeUnknownSync(OrchestrationThreadShell);

const PROJECT = ProjectId.make("project-1");

const shell = (id: string, extra: object = {}) =>
  decodeShell({
    id,
    projectId: PROJECT,
    title: id,
    modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5" },
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...extra,
  });

/**
 * A projection the service reads, its chats by id, and what it was asked: `whole` counts the reads
 * of every chat of the project, `one` names each chat read alone.
 */
const projectionOf = (threads: ReadonlyArray<OrchestrationThreadShell>) => {
  const rows = new Map(threads.map((thread) => [thread.id as string, thread]));
  const asked = { whole: 0, one: [] as Array<string> };
  return {
    rows,
    asked,
    project: { current: Option.some(PROJECT) as Option.Option<ProjectId> },
    /** The chats whose read fails. */
    failing: new Set<string>(),
  };
};

const attentionFor = (projection: ReturnType<typeof projectionOf>) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<AttentionEvent>();
    const attention = yield* makeZeropsMateAttention({
      environmentId: EnvironmentId.make("env-1"),
      incarnation: "boot-1",
      project: Effect.sync(() => projection.project.current),
      threadsOf: (projectId) =>
        Effect.sync(() => {
          projection.asked.whole += 1;
          return [...projection.rows.values()].filter((thread) => thread.projectId === projectId);
        }),
      thread: (threadId: ThreadId) =>
        Effect.suspend(() => {
          projection.asked.one.push(threadId);
          return projection.failing.has(threadId)
            ? Effect.fail("projection unavailable")
            : Effect.succeed(Option.fromNullishOr(projection.rows.get(threadId)));
        }),
      domainEvents: Stream.fromPubSub(events),
    });
    const threadMoved = (threadId: string) =>
      PubSub.publish(events, { aggregateKind: "thread", aggregateId: threadId as ThreadId });
    return { attention, threadMoved };
  });

/** The first value the service publishes at `revision`. */
const atRevision = (changes: Stream.Stream<MateAttention>, revision: number) =>
  changes.pipe(
    Stream.filter((value) => value.source.revision === revision),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

describe("ZeropsMateAttention", () => {
  it.effect("raises its revision for a new chat, reading that chat alone", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a")]);
      const { attention, threadMoved } = yield* attentionFor(projection);
      const first = yield* attention.current;
      projection.rows.set("b", shell("b", { createdAt: "2026-10-02T00:00:00Z" }));
      yield* threadMoved("b");
      const next = yield* atRevision(attention.changes, 1);
      assert.deepStrictEqual(
        {
          first: first.source,
          next: { source: next.source, last: next.lastThreadId, working: next.working },
          asked: projection.asked,
        },
        {
          first: { environmentId: "env-1", incarnation: "boot-1", revision: 0 },
          next: {
            source: { environmentId: "env-1", incarnation: "boot-1", revision: 1 },
            last: "b",
            working: 0,
          },
          asked: { whole: 1, one: ["b"] },
        },
      );
    }),
  );

  it.effect.each([
    { name: "it is no longer active", now: undefined },
    { name: "it is another project's", now: { projectId: "project-2" } },
  ])("lets a chat go once $name", ({ now }) =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a", { hasPendingApprovals: true })]);
      const { attention, threadMoved } = yield* attentionFor(projection);
      if (now === undefined) projection.rows.delete("a");
      else projection.rows.set("a", shell("a", { hasPendingApprovals: true, ...now }));
      yield* threadMoved("a");
      const next = yield* atRevision(attention.changes, 1);
      assert.deepStrictEqual(
        { waiting: next.waiting, questions: next.questions, last: next.lastThreadId },
        { waiting: 0, questions: [], last: null },
      );
    }),
  );

  it.effect("keeps a chat as held when its read fails", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a", { hasPendingApprovals: true })]);
      const { attention, threadMoved } = yield* attentionFor(projection);
      projection.rows.delete("a");
      projection.failing.add("a");
      yield* threadMoved("a");
      projection.rows.set("b", shell("b", { createdAt: "2026-10-02T00:00:00Z" }));
      yield* threadMoved("b");
      const next = yield* atRevision(attention.changes, 1);
      assert.deepStrictEqual(
        { waiting: next.waiting, asked: projection.asked.one },
        { waiting: 1, asked: ["a", "b"] },
      );
    }),
  );

  it.effect("reads the project's chats whole once the project is there", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a"), shell("b")]);
      projection.project.current = Option.none();
      const { attention, threadMoved } = yield* attentionFor(projection);
      const first = yield* attention.current;
      projection.project.current = Option.some(PROJECT);
      yield* threadMoved("b");
      const next = yield* atRevision(attention.changes, 1);
      assert.deepStrictEqual(
        { first: first.lastThreadId, next: next.mainThreadId !== null, asked: projection.asked },
        { first: null, next: true, asked: { whole: 1, one: [] } },
      );
    }),
  );

  it.effect("publishes each revision once: an event that changes nothing publishes nothing", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a")]);
      const { attention, threadMoved } = yield* attentionFor(projection);
      const seen = yield* attention.changes.pipe(
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      projection.rows.set("a", shell("a", { title: "renamed" }));
      yield* threadMoved("a");
      projection.rows.set("b", shell("b", { createdAt: "2026-10-02T00:00:00Z" }));
      yield* threadMoved("b");
      const revisions = Array.from(yield* Fiber.join(seen), (value) => value.source.revision);
      assert.deepStrictEqual(revisions, [0, 1]);
    }),
  );
});
