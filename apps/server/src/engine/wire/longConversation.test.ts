// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  runId,
  type EngineSubscribeInput,
} from "@t3tools/contracts";

import { seedLongHistory } from "../testing/longHistory.ts";
import { makeEngineWorld, mate } from "../testing/pump/engineWorld.ts";
import { makeEngineWire, type EngineWireOptions, type WireCaller } from "./EngineWire.ts";

const protocol = MATE_ENGINE_PROTOCOLS[0]!;
const ana: WireCaller = { subject: "zerops-user:ana", environmentId: "env-1", epoch: 4 };
const agent = {
  instanceId: "claudeAgent",
  driver: "claudeAgent",
  model: "m1",
  profile: { kind: "mate" },
} as const;
/** A conversation whose every message and answer is long: its window is cut to its budget. */
const heavy = ConversationId.make("heavy");

/** A frame as the wire writes it, its sequence space's random origin named by a constant. */
const fingerprint = (frame: unknown) => {
  const json = JSON.stringify(frame, (key, value: unknown) =>
    key === "origin" && typeof value === "string" ? "origin" : value,
  );
  return `${json.length}:${NodeCrypto.createHash("sha256").update(json).digest("hex").slice(0, 16)}`;
};

const longWorld = Effect.gen(function* () {
  const w = yield* makeEngineWorld({ driver: "claudeAgent" });
  yield* w.boot;
  yield* w.tell({ _tag: "AssignAgent", agent });
  yield* w.within(
    seedLongHistory({ conversation: mate, runs: 60, itemsPerRun: 40, working: true }),
  );
  yield* w.tell({ _tag: "AssignAgent", agent }, undefined, heavy);
  yield* w.within(
    seedLongHistory({
      conversation: heavy,
      runs: 30,
      itemsPerRun: 12,
      working: true,
      longAnswerEvery: 1,
      longPersonEvery: 1,
      seed: 3,
    }),
  );
  for (let index = 1; index <= 4; index++) {
    const side = ConversationId.make(`side-${index}`);
    yield* w.tell({ _tag: "AssignAgent", agent }, undefined, side);
    yield* w.within(
      seedLongHistory({ conversation: side, runs: 8, itemsPerRun: 6, seed: 10 + index }),
    );
  }
  return w;
});

/** Every frame a client reads of the long record: opens, pages back, a run's pages, the rows. */
const framesOf = (options: EngineWireOptions) =>
  Effect.gen(function* () {
    const w = yield* longWorld;
    const wire = yield* w.within(makeEngineWire({ coalesce: 0, ...options }));
    const opening = (input: Partial<EngineSubscribeInput>, take = 2) =>
      wire
        .subscribe({ protocol, conversationId: mate, ...input }, ana)
        .pipe(Stream.take(take), Stream.runCollect);
    const frames: Array<readonly [string, unknown]> = [];
    const keep = (name: string, frame: unknown) => {
      frames.push([name, frame]);
      return frame;
    };
    for (const groups of [undefined, 1, 3, 20]) {
      for (const frame of yield* opening(groups === undefined ? {} : { groups }))
        keep(`open ${mate} groups=${groups ?? "default"}`, frame);
    }
    const heavyOpening = yield* opening({ conversationId: heavy });
    for (const frame of heavyOpening) keep(`open ${heavy}`, frame);
    // A resume from a cursor a few runs back: only what changed since.
    const [first] = yield* opening({}, 1);
    if (first?.type !== "snapshot") throw new Error("no snapshot");
    for (const frame of yield* opening({
      after: { origin: first.origin, epoch: ana.epoch, seq: first.head - 3_500 },
    }))
      keep("resume", frame);
    // Back to the first run group by group, in both conversations.
    for (const conversationId of [mate, heavy]) {
      const opened = conversationId === mate ? first : heavyOpening[0];
      let before = opened?.type === "snapshot" ? (opened.window.oldestOrdinal ?? 1) : 1;
      for (let page = 0; page < 12 && before > 1; page++) {
        const read = yield* wire.readEarlier({ protocol, conversationId, beforeOrdinal: before });
        keep(`earlier ${conversationId} before=${before}`, read);
        if (read._tag !== "Page" || read.window.oldestOrdinal === null) break;
        before = read.window.oldestOrdinal;
      }
    }
    // A run's items: the newest page, back page by page, forward from its start.
    for (const ordinal of [60, 59, 12]) {
      let beforeSeq: number | undefined;
      for (let page = 0; page < 4; page++) {
        const read = yield* wire.readRun({
          protocol,
          conversationId: mate,
          runId: runId(mate, ordinal),
          limit: 15,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
        });
        keep(`run ${ordinal} before=${beforeSeq ?? "newest"}`, read);
        if (read._tag !== "Page" || !read.more) break;
        beforeSeq = read.items[0]?.seq;
      }
      keep(
        `run ${ordinal} from start`,
        yield* wire.readRun({
          protocol,
          conversationId: mate,
          runId: runId(mate, ordinal),
          limit: 15,
          afterSeq: 0,
        }),
      );
    }
    const rows = yield* wire
      .subscribeRows({ protocol }, ana)
      .pipe(Stream.runHead, Effect.map(Option.getOrThrow));
    keep("rows", rows);
    yield* w.shutdown;
    return frames.map(([name, frame]) => `${name} ${fingerprint(frame)}`);
  });

// The open path's reads are made fast under frames that stay the bytes the hosted client reads:
// any change here is a change of the wire, made on purpose and said in its commit.
describe("a long, old conversation read over the wire", () => {
  it.effect("opens, pages back and lists in the frames the hosted client already reads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* framesOf({}), GOLDEN);
      }),
    ),
  );

  it.effect("opens within a tight budget in the frames the hosted client already reads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* framesOf({ snapshotBytes: 16 * 1024, changesBytes: 32 * 1024 }),
          GOLDEN_TIGHT,
        );
      }),
    ),
  );
});

const GOLDEN: ReadonlyArray<string> = [
  "open mate groups=default 102873:06f9ac60d3082c60",
  "open mate groups=default 46:2e3f7932b05d71c7",
  "open mate groups=1 48868:021f519863705a7e",
  "open mate groups=1 46:2e3f7932b05d71c7",
  "open mate groups=3 52328:a3f214f54cd10ed0",
  "open mate groups=3 46:2e3f7932b05d71c7",
  "open mate groups=20 130347:7beecdc4f81934b7",
  "open mate groups=20 46:2e3f7932b05d71c7",
  "open heavy 259794:147a6c5bce5a6362",
  "open heavy 46:4fa23367b5f0b0c9",
  "resume 122451:e9dacb7a75fe9d5b",
  "resume 46:2e3f7932b05d71c7",
  "earlier mate before=49 32375:54e0999902c199fe",
  "earlier mate before=37 50045:a777d5c2e6368650",
  "earlier mate before=24 32357:1bbf2544d1ddf207",
  "earlier mate before=12 28340:ceed7bb2875f0a7c",
  "earlier heavy before=23 198125:ebef54efbbe1a224",
  "earlier heavy before=17 214480:8781b6f673956253",
  "earlier heavy before=11 193690:50f8a5fcdc0b1724",
  "earlier heavy before=5 140654:6b962f62f7be6b9e",
  "run 60 before=newest 28249:7f7b0083cf23115a",
  "run 60 before=60052 20788:c2d54639a740b271",
  "run 60 before=60024 10372:a910ec39d087d06a",
  "run 60 from start 12348:80a1146e4d6667f2",
  "run 59 before=newest 7191:3846a139229be5d8",
  "run 59 before=59053 10305:1970d1a33d1e552d",
  "run 59 before=59023 19048:3317410f7653f9ca",
  "run 59 from start 21556:9da4ba012eea1e33",
  "run 12 before=newest 16547:d27938b0334c47f9",
  "run 12 before=12055 16821:3a5f5be86dd5ca5b",
  "run 12 before=12025 22686:350b049d65bdb07e",
  "run 12 from start 25968:3dd31197fa00dc1d",
  "rows 4767:e0aa096f69a68a0a",
];
const GOLDEN_TIGHT: ReadonlyArray<string> = [
  "open mate groups=default 10496:c765f9297e04dffe",
  "open mate groups=default 46:2e3f7932b05d71c7",
  "open mate groups=1 10496:c765f9297e04dffe",
  "open mate groups=1 46:2e3f7932b05d71c7",
  "open mate groups=3 10496:c765f9297e04dffe",
  "open mate groups=3 46:2e3f7932b05d71c7",
  "open mate groups=20 10496:c765f9297e04dffe",
  "open mate groups=20 46:2e3f7932b05d71c7",
  "open heavy 19993:5f98ff816acdc748",
  "open heavy 46:4fa23367b5f0b0c9",
  "resume 30400:888694e5701cfc2f",
  "resume 32265:05a7ba128432b0df",
  "earlier mate before=60 65255:c33333a48a6f5043",
  "earlier mate before=48 34030:1623558bd7aec661",
  "earlier mate before=35 44118:1f48f082fb13a54e",
  "earlier mate before=23 31917:d26c0aea1cf9b4a8",
  "earlier mate before=11 26703:d00f6ac17234f8fb",
  "earlier heavy before=30 232063:c7e26c08a911d766",
  "earlier heavy before=23 198125:ebef54efbbe1a224",
  "earlier heavy before=17 214480:8781b6f673956253",
  "earlier heavy before=11 193690:50f8a5fcdc0b1724",
  "earlier heavy before=5 140654:6b962f62f7be6b9e",
  "run 60 before=newest 28249:7f7b0083cf23115a",
  "run 60 before=60052 20788:c2d54639a740b271",
  "run 60 before=60024 10372:a910ec39d087d06a",
  "run 60 from start 12348:80a1146e4d6667f2",
  "run 59 before=newest 7191:3846a139229be5d8",
  "run 59 before=59053 10305:1970d1a33d1e552d",
  "run 59 before=59023 19048:3317410f7653f9ca",
  "run 59 from start 21556:9da4ba012eea1e33",
  "run 12 before=newest 16547:d27938b0334c47f9",
  "run 12 before=12055 16821:3a5f5be86dd5ca5b",
  "run 12 before=12025 22686:350b049d65bdb07e",
  "run 12 from start 25968:3dd31197fa00dc1d",
  "rows 4767:e0aa096f69a68a0a",
];
