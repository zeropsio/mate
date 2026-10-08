import type { Cause } from "effect";
import type {
  EngineConversationFrame,
  EngineCursor,
  EngineDetail,
  EnginePage,
  Item,
  ItemId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";

import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "../engineLive.ts";
import {
  engineConversationLink,
  engineConversationScopes,
  engineEarlierScope,
  engineFactId,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import {
  callItem,
  engineHeader,
  engineRun,
  noteItem,
  personItem,
} from "../__fixtures__/mateEngine.ts";
import { engineThread } from "../projections/mateEngine.ts";
import {
  ENGINE_FORGET_AFTER_MS,
  engineProtocol,
  makeMateEngineConversations,
} from "./mateEngine.ts";

const ENV = "env-ada";
const ada: EngineConversationKey = { environmentId: ENV, conversationId: "thread-ada" };
const run1 = "thread-ada/r/1";
const run2 = "thread-ada/r/2";

const snapshot = (
  patch: Partial<Extract<EngineConversationFrame, { type: "snapshot" }>> = {},
): EngineConversationFrame =>
  ({
    type: "snapshot",
    protocol: 1,
    epoch: 4,
    origin: "origin-a",
    head: 12,
    header: engineHeader("thread-ada"),
    runs: [engineRun("thread-ada", 1, { rev: 9 })],
    items: [personItem(run1, 1, "Deploy the api"), noteItem(run1, 2, "Deployed.", { rev: 9 })],
    requests: [],
    window: { oldestOrdinal: 1, earlier: false },
    ...patch,
  }) as EngineConversationFrame;

const changes = (
  from: number,
  to: number,
  patch: Partial<Extract<EngineConversationFrame, { type: "changes" }>> = {},
): EngineConversationFrame =>
  ({
    type: "changes",
    epoch: 4,
    from,
    to,
    runs: [],
    items: [],
    requests: [],
    ...patch,
  }) as EngineConversationFrame;

const synchronized = (head: number, epoch = 4): EngineConversationFrame => ({
  type: "synchronized",
  epoch,
  head,
});

type Pager = (request: {
  readonly runId: string | null;
  readonly before: number | null;
}) => Effect.Effect<EnginePage, StreamFault>;

const page = (patch: Partial<Extract<EnginePage, { _tag: "Page" }>> = {}): EnginePage =>
  ({
    _tag: "Page",
    runs: [],
    items: [],
    requests: [],
    window: { oldestOrdinal: 1, earlier: false },
    more: false,
    ...patch,
  }) as EnginePage;

type Detailer = (request: {
  readonly itemId: string;
  readonly part: string;
}) => Effect.Effect<EngineDetail, StreamFault>;

function rig(
  pager: Pager = () => Effect.fail({ outcome: "transient", message: "no pages" }),
  detailer: Detailer = () => Effect.fail({ outcome: "transient", message: "no details" }),
) {
  const details: Array<string> = [];
  const pages: Array<{ readonly runId: string | null; readonly before: number | null }> = [];
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const setTimer = (callback: () => void) => {
    const handle = nextTimer++;
    timers.set(handle, callback);
    return handle;
  };
  const clearTimer = (handle: unknown) => void timers.delete(handle as number);
  const live = makeEngineLiveText({ policy: ENGINE_LIVE_POLICY, setTimer, clearTimer });
  const opens: Array<{
    readonly after: EngineCursor | null;
    readonly frames: Queue.Queue<EngineConversationFrame, StreamFault | Cause.Done>;
  }> = [];
  let access: ((fault: StreamFault | null) => void) | null = null;
  const conversations = makeMateEngineConversations({
    store,
    live,
    setTimer: (callback, delayMs) => {
      expect(delayMs).toBe(ENGINE_FORGET_AFTER_MS);
      return setTimer(callback);
    },
    clearTimer,
    wire: {
      subscribe: (_key, after) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const frames = yield* Queue.unbounded<
              EngineConversationFrame,
              StreamFault | Cause.Done
            >();
            opens.push({ after, frames });
            return Stream.fromQueue(frames);
          }),
        ),
      subscribeRows: () => Stream.never,
      readEarlier: (_key, beforeOrdinal) => {
        pages.push({ runId: null, before: beforeOrdinal });
        return pager({ runId: null, before: beforeOrdinal });
      },
      readRun: (_key, runId, beforeSeq) => {
        pages.push({ runId, before: beforeSeq });
        return pager({ runId, before: beforeSeq });
      },
      readDetail: (_key, itemId, part) => {
        details.push(`${itemId} ${part}`);
        return detailer({ itemId, part });
      },
      watch: (_environmentId, receive) =>
        Effect.sync(() => {
          access = receive;
        }),
    },
  });
  const send = (...frames: ReadonlyArray<EngineConversationFrame>) =>
    Effect.gen(function* () {
      for (const frame of frames) Queue.offerUnsafe(opens.at(-1)!.frames, frame);
      yield* settle;
    });
  const read = () => readsOfState(store.state());
  const item = (id: string) => read().fact("mateEngineItem", engineFactId(ENV, id));
  return {
    store,
    live,
    conversations,
    pages,
    details,
    opens,
    send,
    read,
    item,
    expire: () => {
      const due = Array.from(timers.values());
      timers.clear();
      for (const callback of due) callback();
    },
    deny: (fault: StreamFault) => access?.(fault),
    close: () => {
      conversations.close();
      store.close();
      registry.dispose();
    },
  };
}

describe("an engine conversation's subscription", () => {
  it.live("opens on its window, goes live on synchronized, then takes each commit's changes", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      expect(r.opens.map((open) => open.after)).toEqual([null]);
      yield* r.send(snapshot(), synchronized(12));
      expect(r.item(`${run1}/i/2`)).toMatchObject({ kind: "known", value: { text: "Deployed." } });
      expect(r.read().stream(engineConversationScopes(ada).item).phase).toBe("live");
      expect(r.read().coverage(engineConversationScopes(ada).item)).toBe("partial");
      yield* r.send(
        changes(12, 14, {
          runs: [engineRun("thread-ada", 2, { rev: 14, state: "running", end: null })],
          items: [personItem(run2, 1, "And the worker", { rev: 13 })],
        }),
      );
      expect(r.item(`${run2}/i/1`)).toMatchObject({ value: { text: "And the worker" } });
      expect(r.conversations.cursor(ada)).toEqual({ epoch: 4, origin: "origin-a", seq: 14 });
      r.close();
    }),
  );

  it.live("resumes from its cursor when the subscription drops, keeping what it held", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      yield* Queue.fail(r.opens[0]!.frames, { outcome: "transient", message: "socket closed" });
      yield* settle;
      expect(r.item(`${run1}/i/2`).kind).toBe("known");
      r.conversations.retry(ada);
      yield* settle;
      expect(r.opens.at(-1)!.after).toEqual({ epoch: 4, origin: "origin-a", seq: 12 });
      yield* r.send(changes(12, 12, { epoch: 5 }), synchronized(12, 5));
      expect(r.conversations.cursor(ada)).toEqual({ epoch: 5, origin: "origin-a", seq: 12 });
      expect(r.item(`${run1}/i/2`).kind).toBe("known");
      r.close();
    }),
  );

  it.live("resubscribes from its cursor when changes do not follow it", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12), changes(13, 15));
      expect(r.opens.map((open) => open.after)).toEqual([
        null,
        { epoch: 4, origin: "origin-a", seq: 12 },
      ]);
      r.close();
    }),
  );

  it.live("forgets what it held on a reset, then takes the next snapshot whole", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      yield* r.send(
        { type: "reset", reason: "gap" },
        snapshot({
          head: 40,
          runs: [engineRun("thread-ada", 2, { rev: 40 })],
          items: [personItem(run2, 1, "Later", { rev: 40 })],
        }),
      );
      expect(r.item(`${run1}/i/2`).kind).toBe("unknown");
      expect(r.item(`${run2}/i/1`)).toMatchObject({ value: { text: "Later" } });
      r.close();
    }),
  );

  it.live(
    "forgets what it held before a snapshot from another sequence space or an older epoch",
    () =>
      Effect.gen(function* () {
        for (const other of [{ origin: "origin-b" }, { epoch: 3 }]) {
          const r = rig();
          r.conversations.hold(ada);
          yield* settle;
          yield* r.send(snapshot(), synchronized(12));
          yield* r.send(
            snapshot({
              ...other,
              head: 3,
              runs: [engineRun("thread-ada", 2, { rev: 3 })],
              items: [personItem(run2, 1, "Restored", { rev: 3 })],
            }),
          );
          expect(r.item(`${run1}/i/2`).kind).toBe("unknown");
          expect(r.item(`${run2}/i/1`)).toMatchObject({ value: { text: "Restored" } });
          r.close();
        }
      }),
  );

  it.live("keeps streamed text out of the store until the item's record replaces it", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      const factsBefore = r.store.state().facts;
      yield* r.send(
        { type: "live.open", itemId: `${run1}/i/3` as ItemId, stream: "text", text: "" },
        {
          type: "live.append",
          itemId: `${run1}/i/3` as ItemId,
          stream: "text",
          offset: 0,
          text: "On it",
        },
      );
      expect(r.store.state().facts).toBe(factsBefore);
      expect(r.live.read(ENV, `${run1}/i/3`, "text")).toBe("On it");
      yield* r.send(changes(12, 13, { items: [noteItem(run1, 3, "On it.", { rev: 13 })] }), {
        type: "live.settle",
        itemId: `${run1}/i/3` as ItemId,
      });
      expect(r.live.read(ENV, `${run1}/i/3`, "text")).toBeNull();
      expect(r.item(`${run1}/i/3`)).toMatchObject({ value: { text: "On it." } });
      r.close();
    }),
  );

  it.live("keeps a released conversation, resuming from its cursor when it is held again", () =>
    Effect.gen(function* () {
      const r = rig();
      const release = r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      release();
      yield* settle;
      expect(r.item(`${run1}/i/2`).kind).toBe("known");
      r.conversations.hold(ada);
      yield* settle;
      expect(r.opens.at(-1)!.after).toEqual({ epoch: 4, origin: "origin-a", seq: 12 });
      r.expire();
      expect(r.item(`${run1}/i/2`).kind).toBe("known");
      r.close();
    }),
  );

  it.live("forgets a conversation five minutes after its last release", () =>
    Effect.gen(function* () {
      const r = rig();
      const release = r.conversations.hold(ada);
      const again = r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      release();
      r.expire();
      expect(r.item(`${run1}/i/2`).kind).toBe("known");
      again();
      yield* settle;
      r.expire();
      expect(r.item(`${run1}/i/2`).kind).toBe("unknown");
      expect(r.conversations.cursor(ada)).toBeNull();
      r.conversations.hold(ada);
      yield* settle;
      expect(r.opens.at(-1)!.after).toBeNull();
      r.close();
    }),
  );

  it.live("forgets the conversation and its streamed text on an authoritative denial", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12), {
        type: "live.open",
        itemId: `${run1}/i/3` as ItemId,
        stream: "text",
        text: "secret",
      });
      r.deny({ outcome: "authoritative-denial", message: "No longer yours." });
      yield* settle;
      expect(r.item(`${run1}/i/2`).kind).toBe("unknown");
      expect(r.live.read(ENV, `${run1}/i/3`, "text")).toBeNull();
      expect(r.read().stream(engineConversationLink(ada)).phase).toBe("refused");
      r.close();
    }),
  );

  it.live(
    "refuses a conversation its Mate serves on another protocol, naming the update route",
    () =>
      Effect.gen(function* () {
        const r = rig();
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send({
          type: "unserved",
          reason: "protocol",
          protocols: [2],
          message: "Update Zerops Mate to keep talking to it.",
        });
        const link = r.read().stream(engineConversationLink(ada));
        expect(link.phase).toBe("refused");
        expect(link.fault).toMatchObject({ code: "update" });
        r.close();
      }),
  );
});

describe("the engine protocol a client speaks with a Mate", () => {
  it.each([
    { served: undefined, speaks: null, name: "a V1 Mate advertises none" },
    { served: 1, speaks: 1, name: "a Mate serving this build's protocol" },
    { served: [1, 2], speaks: 1, name: "a newer Mate that still serves this build's" },
    { served: 2, speaks: null, name: "a Mate serving only a newer protocol: update the app" },
  ])("$name", ({ served, speaks }) => {
    expect(engineProtocol(served)).toBe(speaks);
  });
});

describe("an engine conversation's older pages", () => {
  const run = (ordinal: number, items: number, patch = {}) =>
    engineRun("thread-ada", ordinal, {
      rev: ordinal,
      summary: { items, calls: {}, answerItemId: null, lastItemSeq: null },
      ...patch,
    });
  const itemsOf = (r: ReturnType<typeof rig>) =>
    [...r.read().index("engineItemsIn", engineFactId(ENV, "thread-ada"))]
      .flatMap((id) => {
        const fact = r.read().fact("mateEngineItem", id);
        return fact.kind === "known" ? [fact.value.id] : [];
      })
      .sort();
  const drawn = (r: ReturnType<typeof rig>) => engineThread.derive(r.read(), ada);

  it.live("draws a run its window holds in part only once its items are read whole", () =>
    Effect.gen(function* () {
      const answered = yield* Queue.unbounded<EnginePage>();
      const r = rig(() => Queue.take(answered));
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({
          runs: [run(1, 3)],
          items: [personItem(run1, 1, "Deploy the api"), noteItem(run1, 3, "Deployed.")],
        }),
        synchronized(12),
      );
      expect(drawn(r).data).toEqual(Option.none());
      expect(r.pages).toEqual([{ runId: run1, before: null }]);
      Queue.offerUnsafe(
        answered,
        page({
          items: [
            personItem(run1, 1, "Deploy the api"),
            callItem(run1, 2) as Item,
            noteItem(run1, 3, "Deployed."),
          ],
        }),
      );
      yield* settle;
      expect(itemsOf(r)).toEqual([`${run1}/i/1`, `${run1}/i/2`, `${run1}/i/3`]);
      expect(Option.getOrNull(drawn(r).data)?.activities.map((a) => a.kind)).toEqual([
        "tool.started",
        "tool.completed",
      ]);
      r.close();
    }),
  );

  it.live("reads a run longer than a page back page by page", () =>
    Effect.gen(function* () {
      const r = rig(({ before }) =>
        Effect.succeed(
          before === null
            ? page({ items: [callItem(run1, 3), callItem(run1, 4)], more: true })
            : page({ items: [callItem(run1, 2)], more: false }),
        ),
      );
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({ runs: [run(1, 4)], items: [personItem(run1, 1, "Deploy")] }),
        synchronized(12),
      );
      expect(r.pages).toEqual([
        { runId: run1, before: null },
        { runId: run1, before: 3 },
      ]);
      expect(itemsOf(r)).toHaveLength(4);
      r.close();
    }),
  );

  it.live("draws what it holds of a run whose items could not be read", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({ runs: [run(1, 3)], items: [personItem(run1, 1, "Deploy")] }),
        synchronized(12),
      );
      expect(itemsOf(r)).toEqual([`${run1}/i/1`]);
      expect(Option.isSome(drawn(r).data)).toBe(true);
      r.close();
    }),
  );

  it.live(
    "loads earlier run groups into the conversation, each run whole, saying while it loads",
    () =>
      Effect.gen(function* () {
        const answered = yield* Queue.unbounded<EnginePage>();
        const r = rig(({ runId }) =>
          runId === null
            ? Queue.take(answered)
            : Effect.succeed(page({ items: [callItem("thread-ada/r/2", 2)] })),
        );
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send(
          snapshot({
            runs: [run(3, 1)],
            items: [personItem("thread-ada/r/3", 1, "Third")],
            window: { oldestOrdinal: 3, earlier: true },
          }),
          synchronized(12),
        );
        expect(Option.getOrNull(drawn(r).page)).toEqual({
          beforeCursor: "3",
          hasMore: true,
          loadingOlder: false,
        });
        expect(r.conversations.readEarlier(ada)).toBe(true);
        expect(r.conversations.readEarlier(ada)).toBe(false);
        expect(Option.getOrNull(drawn(r).page)?.loadingOlder).toBe(true);
        Queue.offerUnsafe(
          answered,
          page({
            runs: [run(1, 1), run(2, 2)],
            items: [personItem(run1, 1, "First"), personItem("thread-ada/r/2", 1, "Second")],
          }),
        );
        yield* settle;
        expect(r.pages).toEqual([
          { runId: null, before: 3 },
          { runId: "thread-ada/r/2", before: null },
        ]);
        expect(itemsOf(r)).toEqual([
          `${run1}/i/1`,
          "thread-ada/r/2/i/1",
          "thread-ada/r/2/i/2",
          "thread-ada/r/3/i/1",
        ]);
        expect(drawn(r).page).toEqual(Option.none());
        expect(r.conversations.readEarlier(ada)).toBe(false);
        r.close();
      }),
  );

  it.live("offers to load earlier again when a read fails, keeping what it holds", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({
          runs: [run(2, 1)],
          items: [personItem("thread-ada/r/2", 1, "Second")],
          window: { oldestOrdinal: 2, earlier: true },
        }),
        synchronized(12),
      );
      expect(r.conversations.readEarlier(ada)).toBe(true);
      yield* settle;
      expect(Option.getOrNull(drawn(r).page)).toMatchObject({ hasMore: true, loadingOlder: false });
      expect(r.read().stream(engineEarlierScope(ada)).fault?.message).toBe("no pages");
      expect(r.conversations.readEarlier(ada)).toBe(true);
      expect(itemsOf(r)).toEqual(["thread-ada/r/2/i/1"]);
      r.close();
    }),
  );

  it.live("offers nothing earlier when its window starts at the first run", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      expect(drawn(r).page).toEqual(Option.none());
      expect(r.conversations.readEarlier(ada)).toBe(false);
      expect(r.pages).toEqual([]);
      r.close();
    }),
  );
});

describe("what an engine conversation says live and never records", () => {
  it.live("keeps the context's fullness and each call's progress, the latest of each", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot(),
        synchronized(12),
        { type: "context", usage: { usedTokens: 1_000, maxTokens: 200_000 } },
        { type: "progress", itemId: `${run1}/i/3` as ItemId, value: { step: "build" } },
        { type: "progress", itemId: `${run1}/i/3` as ItemId, value: { step: "deploy" } },
        { type: "context", usage: { usedTokens: 4_000, maxTokens: 200_000 } },
      );
      const gauge = () => r.read().fact("mateEngineGauge", engineFactId(ENV, "thread-ada"));
      expect(gauge()).toMatchObject({
        kind: "known",
        value: {
          usage: { usedTokens: 4_000 },
          progress: { [`${run1}/i/3`]: { step: "deploy" } },
        },
      });
      yield* r.send({ type: "progress", itemId: `${run1}/i/3` as ItemId, value: null });
      expect(gauge()).toMatchObject({ value: { progress: {} } });
      r.close();
    }),
  );
});

describe("an engine call whose result the wire cut", () => {
  const deployed = '{"status":"DEPLOYED","buildLogs":"…"}';
  const cutCall = (rev = 9) =>
    callItem(run1, 2, {
      rev,
      step: "mcp",
      tool: { name: "zerops_deploy", server: "zerops" },
      result: { toolName: "zerops_deploy" },
      cut: { part: "result", total: deployed.length },
    });
  const whole: Detailer = () =>
    Effect.succeed({
      _tag: "Detail",
      text: deployed,
      from: 0,
      to: deployed.length,
      total: deployed.length,
    });

  it.live("holds the result whole, read before the call is drawn", () =>
    Effect.gen(function* () {
      const r = rig(undefined, whole);
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({ items: [personItem(run1, 1, "Deploy the api"), cutCall()] }),
        synchronized(12),
      );
      expect(r.details).toEqual([`${run1}/i/2 result`]);
      const call = r.item(`${run1}/i/2`);
      expect(call).toMatchObject({
        kind: "known",
        value: { result: { toolName: "zerops_deploy", resultText: deployed } },
      });
      expect(call.kind === "known" && "cut" in call.value).toBe(false);
      r.close();
    }),
  );

  it.live("reads a result cut in a commit's changes before the change is held", () =>
    Effect.gen(function* () {
      const r = rig(undefined, whole);
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12), changes(12, 13, { items: [cutCall(13)] }));
      expect(r.item(`${run1}/i/2`)).toMatchObject({
        kind: "known",
        value: { result: { resultText: deployed } },
      });
      r.close();
    }),
  );

  it.live("says the result was too long to show when its whole cannot be read", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({ items: [personItem(run1, 1, "Deploy the api"), cutCall()] }),
        synchronized(12),
      );
      expect(r.item(`${run1}/i/2`)).toMatchObject({
        kind: "known",
        value: { result: { toolName: "zerops_deploy", truncated: true } },
      });
      r.close();
    }),
  );
});
