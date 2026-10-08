import type { Cause } from "effect";
import type { EngineConversationFrame, EngineCursor, ItemId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";

import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "../engineLive.ts";
import {
  engineConversationId,
  engineConversationLink,
  engineConversationScopes,
  engineFactId,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { engineHeader, engineRun, noteItem, personItem } from "../__fixtures__/mateEngine.ts";
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

function rig() {
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
