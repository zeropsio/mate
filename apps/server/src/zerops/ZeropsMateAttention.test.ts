import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationThreadShell,
  ProjectId,
  type MateAttention,
  type ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  type AttentionEvent,
  makeZeropsMateAttention,
  MATE_ATTENTION_MOVED_MAX,
} from "./ZeropsMateAttention.ts";

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
    /** How often the project was looked up. */
    lookups: { project: 0 },
    /** The chats whose read fails. */
    failing: new Set<string>(),
    /** Held until opened: the whole read waits on it. */
    gate: {
      whole: undefined as Deferred.Deferred<void> | undefined,
      /** Held until opened: a read of one chat waits on it. */
      one: undefined as Deferred.Deferred<void> | undefined,
    },
  };
};

/** The service over `projection`, started by a first read unless `idle` says to leave it be. */
const attentionFor = (projection: ReturnType<typeof projectionOf>, idle = false) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<AttentionEvent>();
    const attention = yield* makeZeropsMateAttention({
      environmentId: EnvironmentId.make("env-1"),
      incarnation: "boot-1",
      project: Effect.sync(() => {
        projection.lookups.project += 1;
        return projection.project.current;
      }),
      threadsOf: (projectId) =>
        Effect.gen(function* () {
          if (projection.gate.whole !== undefined) yield* Deferred.await(projection.gate.whole);
          projection.asked.whole += 1;
          return [...projection.rows.values()].filter((thread) => thread.projectId === projectId);
        }),
      thread: (threadId: ThreadId) =>
        Effect.gen(function* () {
          if (projection.gate.one !== undefined) yield* Deferred.await(projection.gate.one);
          projection.asked.one.push(threadId);
          if (projection.failing.has(threadId)) return yield* Effect.fail("projection unavailable");
          return Option.fromNullishOr(projection.rows.get(threadId));
        }),
      domainEvents: Stream.fromPubSub(events),
    });
    const threadMoved = (threadId: string) =>
      PubSub.publish(events, { aggregateKind: "thread", aggregateId: threadId as ThreadId });
    if (!idle) yield* attention.current;
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

  it.effect("reads and follows nothing until a reader asks", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a")]);
      projection.project.current = Option.none();
      const { attention, threadMoved } = yield* attentionFor(projection, true);
      yield* threadMoved("a");
      yield* threadMoved("a");
      yield* Effect.yieldNow;
      const before = { lookups: projection.lookups.project, whole: projection.asked.whole };
      projection.project.current = Option.some(PROJECT);
      const first = yield* attention.current;
      assert.deepStrictEqual(
        { before, after: projection.asked.whole, revision: first.source.revision },
        { before: { lookups: 0, whole: 0 }, after: 1, revision: 0 },
      );
    }),
  );

  it.effect("finishes its start for the next reader when the first one goes away mid-start", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a")]);
      const gate = yield* Deferred.make<void>();
      projection.gate.whole = gate;
      const { attention } = yield* attentionFor(projection, true);
      const first = yield* Effect.forkChild(attention.current, { startImmediately: true });
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(gate, undefined);
      const next = yield* attention.current;
      assert.deepStrictEqual(
        { last: next.lastThreadId, revision: next.source.revision, whole: projection.asked.whole },
        { last: "a", revision: 0, whole: 1 },
      );
    }),
  );

  it.effect("reads each chat that moved once, however many events it had meanwhile", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a")]);
      const { attention, threadMoved } = yield* attentionFor(projection);
      const gate = yield* Deferred.make<void>();
      projection.gate.one = gate;
      yield* threadMoved("a");
      yield* Effect.yieldNow;
      for (const id of ["b", "b", "b", "c", "b"]) yield* threadMoved(id);
      projection.rows.set("c", shell("c", { createdAt: "2026-10-02T00:00:00Z" }));
      yield* Deferred.succeed(gate, undefined);
      yield* atRevision(attention.changes, 1);
      assert.deepStrictEqual(projection.asked.one.toSorted(), ["a", "b", "c"]);
    }),
  );

  it.effect("reads every chat whole again once more chats moved than it follows one by one", () =>
    Effect.gen(function* () {
      const projection = projectionOf([shell("a")]);
      const { attention, threadMoved } = yield* attentionFor(projection);
      const gate = yield* Deferred.make<void>();
      projection.gate.one = gate;
      yield* threadMoved("a");
      yield* Effect.yieldNow;
      for (let n = 0; n <= MATE_ATTENTION_MOVED_MAX; n += 1) yield* threadMoved(`m-${n}`);
      projection.rows.set("z", shell("z", { createdAt: "2026-10-02T00:00:00Z" }));
      yield* Deferred.succeed(gate, undefined);
      const next = yield* atRevision(attention.changes, 1);
      assert.deepStrictEqual(
        { last: next.lastThreadId, whole: projection.asked.whole, one: projection.asked.one },
        { last: "z", whole: 2, one: ["a"] },
      );
    }),
  );
});
