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
import { AtomRegistry } from "effect/reactivity";

import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "../engineLive.ts";
import {
  engineConversationId,
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
  thoughtItem,
} from "../__fixtures__/mateEngine.ts";
import { engineCardPaging, engineThread } from "../projections/mateEngine.ts";
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
  readonly after?: number;
  readonly only?: "outcome";
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
  const pages: Array<Parameters<Pager>[0]> = [];
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
      readRun: (_key, runId, at) => {
        const request = {
          runId,
          before: at.before ?? null,
          ...(at.after === undefined ? {} : { after: at.after }),
          ...(at.only === undefined ? {} : { only: at.only }),
        };
        pages.push(request);
        return pager(request);
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
    allow: () => access?.(null),
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

  it.live("takes a header change from the first part of a split commit", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      yield* r.send(
        changes(12, 12, {
          header: engineHeader("thread-ada", { model: "claude-opus-4-1" }),
          runs: [engineRun("thread-ada", 2, { rev: 13, state: "running", end: null })],
        }),
        changes(12, 15, { items: [personItem(run2, 1, "And the worker", { rev: 15 })] }),
        synchronized(15),
      );
      const conversation = r.read().fact("mateEngineConversation", engineConversationId(ada));
      expect(conversation).toMatchObject({ value: { header: { model: "claude-opus-4-1" } } });
      expect(r.item(`${run2}/i/1`).kind).toBe("known");
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
    "subscribes again when held after its Mate's access came back while it was released",
    () =>
      Effect.gen(function* () {
        const r = rig();
        const release = r.conversations.hold(ada);
        yield* settle;
        yield* r.send(snapshot(), synchronized(12));
        r.deny({ outcome: "authoritative-denial", message: "No longer yours." });
        yield* settle;
        release();
        r.allow();
        yield* settle;
        r.conversations.hold(ada);
        yield* settle;
        expect(r.opens).toHaveLength(2);
        yield* r.send(snapshot(), synchronized(12));
        expect(r.read().stream(engineConversationLink(ada)).phase).toBe("live");
        expect(r.item(`${run1}/i/2`).kind).toBe("known");
        r.close();
      }),
  );

  it.live(
    "reopens a held conversation when its Mate's access comes back, whatever was told meanwhile",
    () =>
      Effect.gen(function* () {
        const r = rig();
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send(snapshot(), synchronized(12));
        r.deny({ outcome: "access-unverified", message: "Sign in again." });
        yield* settle;
        r.deny({ outcome: "access-unverified", message: "Sign in again." });
        yield* settle;
        r.allow();
        yield* settle;
        expect(r.opens).toHaveLength(2);
        yield* r.send(snapshot(), synchronized(12));
        expect(r.read().stream(engineConversationLink(ada)).phase).toBe("live");
        r.close();
      }),
  );

  it.live("keeps nothing of a denied conversation, not even a frame already on its way", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12));
      const frames = r.opens.at(-1)!.frames;
      r.deny({ outcome: "authoritative-denial", message: "No longer yours." });
      Queue.offerUnsafe(frames, snapshot({ head: 14 }));
      yield* settle;
      expect(r.item(`${run1}/i/2`).kind).toBe("unknown");
      expect(r.read().fact("mateEngineRun", engineFactId(ENV, run1)).kind).toBe("unknown");
      r.close();
    }),
  );

  it.live("drops an item's streamed text when its record arrives closed after a drop", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot(), synchronized(12), {
        type: "live.open",
        itemId: `${run1}/i/3` as ItemId,
        stream: "text",
        text: "On it",
      });
      yield* Queue.fail(r.opens[0]!.frames, { outcome: "transient", message: "socket closed" });
      yield* settle;
      r.conversations.retry(ada);
      yield* settle;
      yield* r.send(
        changes(12, 13, { items: [noteItem(run1, 3, "On it.", { rev: 13 })] }),
        synchronized(13),
      );
      expect(r.live.read(ENV, `${run1}/i/3`, "text")).toBeNull();
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
  const run = (ordinal: number, items: number, patch = {}, calls: Record<string, number> = {}) =>
    engineRun("thread-ada", ordinal, {
      rev: ordinal,
      summary: { items, calls, answerItemId: null, lastItemSeq: null },
      ...patch,
    });
  const deploy = (runId: string, ordinal: number) =>
    callItem(runId, ordinal, {
      step: "mcp",
      tool: { name: "zerops_deploy", server: "zerops" },
      result: { toolName: "zerops_deploy" },
    } as never);
  const itemsOf = (r: ReturnType<typeof rig>) =>
    [...r.read().index("engineItemsIn", engineFactId(ENV, "thread-ada"))]
      .flatMap((id) => {
        const fact = r.read().fact("mateEngineItem", id);
        return fact.kind === "known" ? [fact.value.id] : [];
      })
      .sort();
  const drawn = (r: ReturnType<typeof rig>) => engineThread.derive(r.read(), ada);

  it.live("draws a run its window holds in part only once what its closed card draws is read", () =>
    Effect.gen(function* () {
      const answered = yield* Queue.unbounded<EnginePage>();
      const r = rig(() => Queue.take(answered));
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({
          runs: [run(1, 4, {}, { command: 1, mcp: 1 })],
          items: [personItem(run1, 1, "Deploy the api"), noteItem(run1, 4, "Deployed.")],
        }),
        synchronized(12),
      );
      expect(drawn(r).data).toEqual(Option.none());
      // Its deploy, never its command: the command is behind "Show work".
      expect(r.pages).toEqual([{ runId: run1, before: null, after: 0, only: "outcome" }]);
      Queue.offerUnsafe(answered, page({ items: [deploy(run1, 3)] }));
      yield* settle;
      expect(itemsOf(r)).toEqual([`${run1}/i/1`, `${run1}/i/3`, `${run1}/i/4`]);
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
          before === 5
            ? page({ items: [callItem(run1, 3), callItem(run1, 4)], more: true })
            : page({ items: [callItem(run1, 2)], more: false }),
        ),
      );
      r.conversations.hold(ada);
      yield* settle;
      // A live run: its window carries its newest item; its card scrolls up to the rest.
      yield* r.send(
        snapshot({
          runs: [run(1, 5, { state: "running", end: null, endedAt: null })],
          items: [personItem(run1, 1, "Deploy"), callItem(run1, 5)],
        }),
        synchronized(12),
      );
      expect(r.pages).toEqual([]);
      for (let read = 0; read < 3; read++) {
        r.conversations.readRunPage(ada, run1, "earlier");
        yield* settle;
      }
      expect(r.pages).toEqual([
        { runId: run1, before: 5 },
        { runId: run1, before: 3 },
      ]);
      expect(itemsOf(r)).toHaveLength(5);
      r.close();
    }),
  );

  it.live("draws what it holds of a run whose items could not be read", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({
          runs: [run(1, 3, {}, { mcp: 1 })],
          items: [personItem(run1, 1, "Deploy")],
        }),
        synchronized(12),
      );
      expect(r.pages).toHaveLength(1);
      expect(itemsOf(r)).toEqual([`${run1}/i/1`]);
      expect(Option.isSome(drawn(r).data)).toBe(true);
      r.close();
    }),
  );

  it.live(
    "loads earlier run groups into the conversation, each run with what its card draws, saying while it loads",
    () =>
      Effect.gen(function* () {
        const answered = yield* Queue.unbounded<EnginePage>();
        const r = rig(({ runId }) =>
          runId === null
            ? Queue.take(answered)
            : Effect.succeed(page({ items: [deploy("thread-ada/r/2", 2)] })),
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
            runs: [run(1, 1), run(2, 2, {}, { mcp: 1 })],
            items: [personItem(run1, 1, "First"), personItem("thread-ada/r/2", 1, "Second")],
          }),
        );
        yield* settle;
        expect(r.pages).toEqual([
          { runId: null, before: 3 },
          { runId: "thread-ada/r/2", before: null, after: 0, only: "outcome" },
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

  it.live(
    "draws every group its window holds whole: the person's words and the agent's answer",
    () =>
      Effect.gen(function* () {
        const r = rig();
        r.conversations.hold(ada);
        yield* settle;
        const ordinals = [3, 4, 5, 6];
        yield* r.send(
          snapshot({
            runs: ordinals.map((ordinal) =>
              run(ordinal, 2, {
                summary: {
                  items: 2,
                  calls: {},
                  answerItemId: `thread-ada/r/${ordinal}/i/2`,
                  lastItemSeq: null,
                },
              }),
            ),
            items: ordinals.flatMap((ordinal) => [
              personItem(`thread-ada/r/${ordinal}`, 1, `Request ${ordinal}`, {
                seq: ordinal * 10 + 1,
                rev: ordinal * 10 + 1,
              }),
              noteItem(`thread-ada/r/${ordinal}`, 2, `Answer ${ordinal}`, {
                seq: ordinal * 10 + 2,
                rev: ordinal * 10 + 2,
              }),
            ]),
            window: { oldestOrdinal: 3, earlier: true },
          }),
          synchronized(12),
        );
        expect(r.pages).toEqual([]);
        expect(Option.getOrNull(drawn(r).data)?.messages.map((message) => message.text)).toEqual(
          ordinals.flatMap((ordinal) => [`Request ${ordinal}`, `Answer ${ordinal}`]),
        );
        r.close();
      }),
  );

  // Catches "Load earlier" that never goes: an import that failed on its first batch reserved
  // ordinals 1..3 that hold nothing, and the Mate's window says so.
  it.live("offers nothing earlier when the Mate says its window holds its oldest run", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({
          runs: [run(4, 1)],
          items: [personItem("thread-ada/r/4", 1, "Fourth")],
          window: { oldestOrdinal: 4, earlier: false },
        }),
        synchronized(12),
      );
      expect(drawn(r).page).toEqual(Option.none());
      expect(r.conversations.readEarlier(ada)).toBe(false);
      r.close();
    }),
  );

  it.live("offers nothing more once a page says nothing earlier is left", () =>
    Effect.gen(function* () {
      const r = rig(({ runId }) =>
        Effect.succeed(
          runId === null
            ? page({
                runs: [run(5, 1)],
                items: [personItem("thread-ada/r/5", 1, "Fifth")],
                window: { oldestOrdinal: 5, earlier: false },
                more: false,
              })
            : page(),
        ),
      );
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({
          runs: [run(6, 1)],
          items: [personItem("thread-ada/r/6", 1, "Sixth")],
          window: { oldestOrdinal: 6, earlier: true },
        }),
        synchronized(12),
      );
      expect(r.conversations.readEarlier(ada)).toBe(true);
      yield* settle;
      expect(drawn(r).page).toEqual(Option.none());
      expect(r.conversations.readEarlier(ada)).toBe(false);
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

describe("an engine run its card does not hold whole when it paints", () => {
  /**
   * A run of `total` items as the server holds it: the person's words first, the answer last, a
   * deploy with its result every 50th item, notes and commands between; read as the wire reads it.
   */
  const longRun = (
    total: number,
    end: "settled" | "live" = "settled",
    /** A run that continues the first (a restart's continuation): no person's words, later. */
    continues = false,
  ) => {
    const runId = continues ? run2 : run1;
    const items = Array.from({ length: total }, (_, index): Item => {
      const ordinal = index + 1;
      const item = ((): Item => {
        if (ordinal === 1)
          return continues
            ? noteItem(runId, 1, "Picking up where it stopped")
            : personItem(runId, 1, "Bring the whole stack up");
        if (ordinal === total && end === "settled") return noteItem(runId, ordinal, "All up.");
        if (ordinal % 50 === 0)
          return callItem(runId, ordinal, {
            step: "mcp",
            tool: { name: "zerops_deploy", server: "zerops" },
            result: { toolName: "zerops_deploy" },
          } as never);
        return ordinal % 2 === 0
          ? callItem(runId, ordinal)
          : noteItem(runId, ordinal, `Step ${ordinal}`);
      })();
      return continues ? ({ ...item, at: item.at + 100_000 } as Item) : item;
    });
    const record = engineRun("thread-ada", continues ? 2 : 1, {
      rev: continues ? 2 : 1,
      ...(continues
        ? {
            joins: run1,
            trigger: { kind: "wake", cause: "restart", wakeId: null },
            queuedAt: 1_760_000_100_000,
          }
        : {}),
      ...(end === "live" ? { state: "running", end: null, endedAt: null } : {}),
      summary: {
        items: total,
        calls: { command: total / 2, mcp: total / 50 },
        answerItemId: end === "settled" ? (`${runId}/i/${total}` as ItemId) : null,
        lastItemSeq: total,
      },
    } as never);
    const outcome = (item: Item) =>
      item.kind === "work" || (item.kind === "call" && item.result !== undefined);
    const pager: Pager = ({ before, after, only }) => {
      const of = items.filter((item) => only !== "outcome" || outcome(item));
      if (after !== undefined) {
        const later = of.filter((item) => item.seq > after);
        return Effect.succeed(
          page({ runs: [record], items: later.slice(0, 200), more: later.length > 200 }),
        );
      }
      const earlier = of.filter((item) => before === null || item.seq < before);
      return Effect.succeed(
        page({ runs: [record], items: earlier.slice(-200), more: earlier.length > 200 }),
      );
    };
    const window = [
      ...(continues ? [] : [items[0]!]),
      ...(end === "settled" ? [items.at(-1)!] : items.slice(-40)),
    ];
    return { items, record, pager, window };
  };
  const heldSeqs = (r: ReturnType<typeof rig>, runId = run1) =>
    [...r.read().index("engineItemsOfRun", engineFactId(ENV, runId))]
      .flatMap((id) => {
        const fact = r.read().fact("mateEngineItem", id);
        return fact.kind === "known" ? [fact.value.seq] : [];
      })
      .sort((a, b) => a - b);
  const span = (r: ReturnType<typeof rig>) => {
    const fact = r.read().fact("mateEngineSpan", engineFactId(ENV, run1));
    return fact.kind === "known"
      ? { from: fact.value.from, to: fact.value.to, reading: fact.value.reading }
      : null;
  };

  it.live.each([1_700, 5_000])(
    "draws a finished run of %i items on its first paint from what its result shows alone",
    (total) =>
      Effect.gen(function* () {
        const long = longRun(total);
        const r = rig(long.pager);
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send(snapshot({ runs: [long.record], items: long.window }), synchronized(12));
        // One read, however long the run: what its result draws from. Its lines wait for its card.
        expect(r.pages).toEqual([{ runId: run1, before: null, after: 0, only: "outcome" }]);
        const deploys = long.items.filter((item) => item.seq % 50 === 0 && item.seq < total);
        expect(heldSeqs(r)).toEqual([1, ...deploys.map((item) => item.seq), total]);
        expect(span(r)).toEqual({ from: null, to: 0, reading: null });
        expect(Option.isSome(engineThread.derive(r.read(), ada).data)).toBe(true);
        r.close();
      }),
  );

  it.live("reads nothing before it paints a finished run that made no calls", () =>
    Effect.gen(function* () {
      const r = rig();
      r.conversations.hold(ada);
      yield* settle;
      const record = engineRun("thread-ada", 1, {
        summary: { items: 3, calls: {}, answerItemId: null, lastItemSeq: 3 },
      });
      yield* r.send(
        snapshot({ runs: [record], items: [personItem(run1, 1, "Hi"), noteItem(run1, 3, "Hi!")] }),
        synchronized(12),
      );
      expect(r.pages).toEqual([]);
      expect(span(r)).toEqual({ from: null, to: 0, reading: null });
      r.close();
    }),
  );

  it.live(
    "reads a finished run's pages as its card opens and scrolls, until it holds it whole",
    () =>
      Effect.gen(function* () {
        const long = longRun(1_700);
        const answered = yield* Queue.unbounded<EnginePage>();
        let gated = true;
        const r = rig((request) =>
          gated && request.only === undefined ? Queue.take(answered) : long.pager(request),
        );
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send(snapshot({ runs: [long.record], items: long.window }), synchronized(12));
        expect(r.conversations.readRunPage(ada, run1, "later")).toBe(true);
        expect(span(r)?.reading).toBe("later");
        // Asked again while it reads: one read.
        expect(r.conversations.readRunPage(ada, run1, "later")).toBe(false);
        expect(r.conversations.readRunPage(ada, run1, "earlier")).toBe(false);
        gated = false;
        Queue.offerUnsafe(answered, yield* long.pager({ runId: run1, before: null, after: 0 }));
        yield* settle;
        expect(r.pages.at(-1)).toEqual({ runId: run1, before: null, after: 0 });
        expect(span(r)).toEqual({ from: null, to: 200, reading: null });
        for (let read = 0; read < 10 && span(r)?.to !== null; read++) {
          r.conversations.readRunPage(ada, run1, "later");
          yield* settle;
        }
        expect(span(r)).toEqual({ from: null, to: null, reading: null });
        expect(heldSeqs(r)).toHaveLength(1_700);
        expect(r.conversations.readRunPage(ada, run1, "later")).toBe(false);
        r.close();
      }),
  );

  it.live(
    "holds a live run from the newest its window carries, earlier pages as its scroll asks",
    () =>
      Effect.gen(function* () {
        const long = longRun(1_700, "live");
        const r = rig(long.pager);
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send(snapshot({ runs: [long.record], items: long.window }), synchronized(12));
        expect(r.pages).toEqual([]);
        expect(span(r)).toEqual({ from: 1_661, to: null, reading: null });
        expect(r.conversations.readRunPage(ada, run1, "earlier")).toBe(true);
        yield* settle;
        expect(r.pages.at(-1)).toEqual({ runId: run1, before: 1_661 });
        expect(span(r)).toEqual({ from: 1_461, to: null, reading: null });
        expect(r.conversations.readRunPage(ada, run1, "later")).toBe(false);
        r.close();
      }),
  );

  // Catches a card that read one of its runs: a run a restart cut and the run that continues it
  // share a card, and both lie outside the window on a cold open.
  it.live("pages through every run its card draws, in order, until it holds them whole", () =>
    Effect.gen(function* () {
      const cut = longRun(1_700);
      const next = longRun(600, "settled", true);
      const r = rig((request) =>
        request.runId === run2 ? next.pager(request) : cut.pager(request),
      );
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({ runs: [cut.record, next.record], items: [...cut.window, ...next.window] }),
        synchronized(12),
      );
      const read: Array<string> = [];
      for (let page = 0; page < 20; page++) {
        const card = engineCardPaging.derive(r.read(), ada)[run1];
        const runId = card?.pageRuns.later ?? null;
        if (runId === null) break;
        read.push(runId);
        expect(r.conversations.readRunPage(ada, runId, "later")).toBe(true);
        yield* settle;
      }
      // The cut run's nine pages, then its continuation's three.
      expect(read).toEqual([...Array(9).fill(run1), ...Array(3).fill(run2)]);
      expect(heldSeqs(r, run1)).toHaveLength(1_700);
      expect(heldSeqs(r, run2)).toHaveLength(600);
      expect(engineCardPaging.derive(r.read(), ada)[run1]).toMatchObject({
        since: null,
        through: null,
      });
      r.close();
    }),
  );

  it.live("keeps what a run holds when a page fails, and reads it again when asked", () =>
    Effect.gen(function* () {
      const long = longRun(1_700);
      let failing = false;
      const r = rig((request) =>
        failing ? Effect.fail({ outcome: "transient", message: "offline" }) : long.pager(request),
      );
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot({ runs: [long.record], items: long.window }), synchronized(12));
      const held = heldSeqs(r);
      failing = true;
      expect(r.conversations.readRunPage(ada, run1, "later")).toBe(true);
      yield* settle;
      expect(span(r)).toEqual({ from: null, to: 0, reading: null });
      expect(heldSeqs(r)).toEqual(held);
      failing = false;
      expect(r.conversations.readRunPage(ada, run1, "later")).toBe(true);
      yield* settle;
      expect(span(r)?.to).toBe(200);
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

describe("an engine thought longer than its preview", () => {
  const thought = "I'm weighing the api's deploy against the worker's: ".repeat(12);
  const preview = thought.slice(0, 280);
  const cutThought = () => thoughtItem(run1, 2, preview, { length: thought.length });
  const whole: Detailer = () =>
    Effect.succeed({
      _tag: "Detail",
      text: thought,
      from: 0,
      to: thought.length,
      total: thought.length,
    });

  it.live("holds the whole thought, read before it is drawn, as V1 holds it", () =>
    Effect.gen(function* () {
      const r = rig(undefined, whole);
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(
        snapshot({ items: [personItem(run1, 1, "Deploy the api"), cutThought()] }),
        synchronized(12),
      );
      expect(r.details).toEqual([`${run1}/i/2 detail`]);
      expect(r.item(`${run1}/i/2`)).toMatchObject({
        kind: "known",
        value: { kind: "thought", preview: thought, length: thought.length },
      });
      r.close();
    }),
  );

  it.live(
    "keeps its preview when its whole cannot be read, and reads nothing for a whole one",
    () =>
      Effect.gen(function* () {
        const r = rig();
        r.conversations.hold(ada);
        yield* settle;
        yield* r.send(
          snapshot({
            items: [
              personItem(run1, 1, "Deploy the api"),
              cutThought(),
              thoughtItem(run1, 3, "Short"),
            ],
          }),
          synchronized(12),
        );
        expect(r.details).toEqual([`${run1}/i/2 detail`]);
        expect(r.item(`${run1}/i/2`)).toMatchObject({ kind: "known", value: { preview } });
        r.close();
      }),
  );
});
