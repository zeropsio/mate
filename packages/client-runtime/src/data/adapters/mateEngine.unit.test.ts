import type { Cause } from "effect";
import type {
  EngineConversationFrame,
  EngineCursor,
  EngineDetail,
  ItemId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/reactivity";
import { engineHeader, engineRun, noteItem, personItem } from "../__fixtures__/mateEngine.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "../engineLive.ts";
import {
  engineConversationLink,
  engineFactId,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { engineThread } from "../projections/mateEngine.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { makeMateEngineConversations } from "./mateEngine.ts";

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

type Detailer = () => Effect.Effect<EngineDetail, StreamFault>;

function rig(
  readDetail: Detailer = () => Effect.fail({ outcome: "transient", message: "no details" }),
) {
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
    setTimer,
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
      subscribeRows: () => Stream.empty,
      readEarlier: () => Effect.fail({ outcome: "transient", message: "no pages" }),
      readRun: () => Effect.fail({ outcome: "transient", message: "no pages" }),
      readDetail,
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
    live,
    conversations,
    opens,
    send,
    read,
    item,
    deny: (fault: StreamFault) => access?.(fault),
    close: () => {
      conversations.close();
      store.close();
      registry.dispose();
    },
  };
}

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | wire.subscribe(key, cursors.get(id) ?? null) → wire.subscribe(key, cursors.get(key.conversationId) ?? null)
it.effect(
  "AD15: A Mate's conversation whose subscription drops resumes from its cursor, keeping what it held",
  () =>
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

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | case "reset": → case "reset": if (frame.reason === "gap") return Effect.fail(RESUBSCRIBE);
it.effect(
  "AD16: A reset makes a conversation forget what it held, then take the next snapshot whole",
  () =>
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

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | cursor.origin !== frame.origin || frame.epoch < cursor.epoch → cursor.origin !== frame.origin && frame.epoch < cursor.epoch
it.effect(
  "AD17: A snapshot from another sequence space or an older epoch makes a conversation forget what it held first",
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

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | live.forget(key); → live.forget({ ...key, conversationId: key.environmentId });
it.effect("AD18: An authoritative denial forgets the conversation and its streamed text", () =>
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

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | return { ...uncut, text: detail.text }; → return { ...uncut, text: item.text };
it.effect("AD19: A message longer than 16,384 characters can be read to its end", () =>
  Effect.gen(function* () {
    const answer = "a".repeat(16_385);
    const whole: Detailer = () =>
      Effect.succeed({
        _tag: "Detail",
        text: answer,
        from: 0,
        to: answer.length,
        total: answer.length,
      });
    const cases = [
      {
        who: "the Mate's",
        item: noteItem(run1, 2, answer.slice(0, 16_384), {
          cut: { part: "text", total: answer.length },
        }),
      },
      {
        who: "the person's",
        item: personItem(run1, 2, answer.slice(0, 16_384), {
          cut: { part: "text", total: answer.length },
        }),
      },
    ];
    for (const { who, item } of cases) {
      const r = rig(whole);
      r.conversations.hold(ada);
      yield* settle;
      yield* r.send(snapshot({ items: [item] }), synchronized(12));
      const held = r.item(`${run1}/i/2`);
      expect(held, who).toMatchObject({ kind: "known", value: { text: answer } });
      expect(held.kind === "known" && "cut" in held.value, who).toBe(false);
      r.close();
    }
  }),
);

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | ...rowsOf(key, frame.epoch, whole, frame.window), → ...rowsOf(key, frame.epoch, whole, { ...frame.window, earlier: frame.window.oldestOrdinal !== null }),
it.effect("AD20: A conversation whose window starts at the first run offers nothing earlier", () =>
  Effect.gen(function* () {
    const r = rig();
    r.conversations.hold(ada);
    yield* settle;
    yield* r.send(snapshot(), synchronized(12));
    expect(engineThread.derive(r.read(), ada).page).toEqual(Option.none());
    expect(r.conversations.readEarlier(ada)).toBe(false);
    r.close();
  }),
);

// witness: packages/client-runtime/src/data/adapters/mateEngine.ts | unserved.reason === "protocol" ? "update" → unserved.reason !== "protocol" ? "update"
it.effect(
  "AD21: A conversation its Mate serves on another protocol is refused, naming the update route",
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
