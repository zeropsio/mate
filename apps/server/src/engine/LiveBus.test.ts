import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ConversationId } from "@t3tools/contracts";

import { makeLiveBus } from "./LiveBus.ts";

const mate = ConversationId.make("mate");

describe("LiveBus", () => {
  it.effect("streamed text reaches a subscriber as it comes, after the text so far", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus();
        yield* bus.append(mate, "h1.i1", "text", 0, "Hel");
        const frames = yield* bus.subscribe(mate);
        yield* bus.append(mate, "h1.i1", "text", 3, "lo");
        const seen = yield* Stream.runCollect(Stream.take(frames, 2));
        assert.deepStrictEqual(seen, [
          { _tag: "Open", items: [{ key: "h1.i1", stream: "text", text: "Hel" }], liveSeq: 1 },
          { _tag: "Append", key: "h1.i1", stream: "text", offset: 3, text: "lo", liveSeq: 2 },
        ]);
      }),
    ),
  );

  it.effect("a closed item's text leaves the live plane: the record holds it now", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus();
        yield* bus.append(mate, "h1.i1", "text", 0, "Hel");
        yield* bus.append(mate, "h1.i1", "text", 3, "lo");
        yield* bus.append(mate, "h1.i1", "text", 3, "lo");
        assert.strictEqual(yield* bus.settle(mate, "h1.i1"), "Hello");
        const [open] = yield* Stream.runCollect(Stream.take(yield* bus.subscribe(mate), 1));
        assert.deepStrictEqual(open, { _tag: "Open", items: [], liveSeq: 3 });
      }),
    ),
  );

  it.effect("a subscriber that fell behind is told it missed frames, and its stream ends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus({ buffer: 2 });
        const frames = yield* bus.subscribe(mate);
        for (let i = 0; i < 5; i++) yield* bus.append(mate, "h1.i1", "text", i, "x");
        const seen = yield* Stream.runCollect(frames);
        assert.deepStrictEqual(
          seen.map((frame) => frame._tag),
          ["Open", "Gap"],
        );
      }),
    ),
  );

  it.effect("a call's progress is live under its item, the latest held for a late subscriber", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* makeLiveBus();
        yield* bus.progress(mate, "mate/r/1/i/2", { phase: "build" });
        const frames = yield* bus.subscribe(mate);
        yield* bus.progress(mate, "mate/r/1/i/2", { phase: "deploy" });
        const seen = yield* Stream.runCollect(Stream.take(frames, 2));
        assert.deepStrictEqual(seen, [
          {
            _tag: "Open",
            items: [],
            progress: [{ key: "mate/r/1/i/2", value: { phase: "build" } }],
            liveSeq: 1,
          },
          { _tag: "Progress", key: "mate/r/1/i/2", value: { phase: "deploy" }, liveSeq: 2 },
        ]);
        yield* bus.progress(mate, "mate/r/1/i/2", null);
        const [open] = yield* Stream.runCollect(Stream.take(yield* bus.subscribe(mate), 1));
        assert.deepStrictEqual(open, { _tag: "Open", items: [], liveSeq: 3 });
      }),
    ),
  );
});
