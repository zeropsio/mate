import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { SessionId, type TurnHandle } from "@t3tools/contracts";

import { hostEvent, makeHostHarness } from "../testing/pump/hostHarness.ts";
import type { CallPictures } from "./callPictures.ts";
import type { SendEvidence } from "./toCore.ts";

const S1 = SessionId.make("mate/s/1.1");
const H1 = "mate/r/1" as TurnHandle;
/** A 1×1 PNG, as a Zerops tool returns a screenshot. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PICTURE_ASSET = {
  id: "asset-1",
  threadId: "mate/s/1",
  ownerId: "call-1",
  name: "tool-image",
  provenance: "capture",
  original: { status: "ready", digest: "a".repeat(64), mimeType: "image/png", sizeBytes: 68 },
} as never;
const PAGE_ASSET = {
  id: "asset-3",
  threadId: "mate/s/1",
  ownerId: "call-1",
  name: "page-0123456789abcdef.html",
  provenance: "capture",
  original: { status: "ready", digest: "b".repeat(64), mimeType: "text/html", sizeBytes: 13 },
} as never;

/** A host with session S1 open and the send of H1 taken by the driver as native turn T1. */
const sending = (options: Parameters<typeof makeHostHarness>[0] = {}) =>
  Effect.gen(function* () {
    const harness = yield* makeHostHarness(options);
    const { host } = harness;
    yield* host.begin(S1);
    yield* host.record({ kind: "start", session: S1, from: "fresh" });
    yield* host.record({ kind: "started" });
    yield* host.openGate(S1);
    const evidence = yield* host.beginSend(H1, "new");
    return { ...harness, evidence };
  });

/** A Codex turn whose one call closes with `item`; the call's closing signal and what was stored. */
const turnWith = (item: Record<string, unknown>) =>
  Effect.gen(function* () {
    const stored: Array<string> = [];
    const pictures: CallPictures = {
      results: (_thread, key, images) =>
        Effect.sync(() => {
          stored.push(`${key}: ${images.length} picture`);
          return {
            images: images.map((image) => ({
              mimeType: image.mimeType,
              asset: PICTURE_ASSET,
              width: 1,
              height: 1,
            })),
            dropped: false,
          };
        }),
      looked: (_thread, key, path) =>
        Effect.sync(() => {
          stored.push(`${key}: ${path}`);
          return { imagePath: "mate-asset:asset-2", imageName: "home.png" };
        }),
      page: (_thread, key, file) =>
        Effect.sync(() => {
          stored.push(`${key}: page ${file}`);
          return { asset: PAGE_ASSET, bytes: 13 };
        }),
    };
    const { host, told } = yield* sending({ pictures });
    yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
    yield* host.offer(hostEvent("turn.started", { turnId: "T1" }));
    yield* host.offer(
      hostEvent("item.completed", {
        turnId: "T1",
        itemId: "call-1",
        payload: { status: "completed", ...item },
      }),
    );
    yield* host.settled;
    const call = told
      .flat()
      .find((signal) => signal.kind === "item-closed" && signal.body.kind === "call");
    const body = call?.kind === "item-closed" && call.body.kind === "call" ? call.body : undefined;
    return { body, stored };
  });

// witness: apps/server/src/engine/pump/SessionHost.ts | if (sessionCalls > 0) blockers.push("live provider call"); → if (sessionCalls > 1) blockers.push("live provider call");
it.effect(
  "PU1: A provider call the host is making (a deferred interrupt, a session close nobody asked for) holds a Mate update back until the call settles, then lets it go; breaks: an update kills the server in the middle of a provider call",
  () =>
    Effect.gen(function* () {
      for (const call of ["deferred interrupt", "unasked session close"] as const) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const started = yield* Deferred.make<void>();
            const finish = yield* Deferred.make<void>();
            const changes = yield* PubSub.unbounded<void>();
            const providerCall = Deferred.succeed(started, void 0).pipe(
              Effect.andThen(Deferred.await(finish)),
            );
            const options = {
              interruptTurn: providerCall,
              stopSession: providerCall,
              changed: Effect.asVoid(PubSub.publish(changes, void 0)),
            };
            const { host } =
              call === "deferred interrupt"
                ? yield* sending(options)
                : yield* makeHostHarness(options);
            if (call === "deferred interrupt") {
              // A Stop before the driver named the turn: sent the moment the send's answer names it.
              yield* host.interruptOrDefer(H1);
              yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
            } else {
              yield* host.offer(hostEvent("session.started"));
            }
            yield* host.settled;
            yield* Deferred.await(started);
            const blockers = host.updateBlockers;
            assert.ok(blockers, call);
            const held = (yield* blockers).length;
            assert.isFalse(yield* host.idle, call);
            // Nothing else changes while the call is held: the next change is the call settling.
            const subscription = yield* PubSub.subscribe(changes);
            yield* Deferred.succeed(finish, void 0);
            yield* Stream.fromSubscription(subscription).pipe(Stream.take(1), Stream.runDrain);
            assert.strictEqual((yield* blockers).length, held - 1, call);
            if (call === "unasked session close") assert.isTrue(yield* host.idle, call);
          }),
        );
      }
    }),
);

// witness: apps/server/src/engine/pump/SessionHost.ts | return Effect.interruptible(Deferred.await(done)); → return Effect.interruptible(Effect.suspend(() => (waiting.has(turn) ? Deferred.await(done) : Effect.never)));
it.effect(
  "PU2: A send's evidence reaches it even when the driver answered before the send waited; breaks: the send waits for an answer that already came",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, evidence } = yield* sending();
        yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
        // The driver took it, and the host folded that, before the send waits.
        yield* host.settled;
        const waited = yield* Effect.forkChild(Effect.timeoutOption(evidence, "1 second"));
        yield* TestClock.adjust("1 second");
        assert.deepStrictEqual(
          yield* Fiber.join(waited),
          Option.some<SendEvidence>({ _tag: "Accepted", as: "opened", into: null }),
        );
      }),
    ),
);

// witness: apps/server/src/engine/pump/SessionHost.ts | for (let attempt = 1; ; attempt++) { → for (let attempt = 1; attempt <= 3; attempt++) {
it.effect(
  "PU3: A batch the actor fails to take is told again until it takes it, so a turn's end is never lost; breaks: the run shows running for good",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host, told } = yield* sending({ failFirst: 8 });
        yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
        yield* host.offer(
          hostEvent("turn.completed", { turnId: "T1", payload: { state: "completed" } }),
        );
        const settled = yield* Effect.forkChild(host.settled);
        // Eight refusals back off 0.1 s, 0.2 s, … 12.8 s: each step reaches the next attempt.
        for (let step = 0; step < 20; step++) yield* TestClock.adjust("30 seconds");
        yield* Fiber.join(settled);
        assert.deepStrictEqual(
          told.flat().map((signal) => signal.kind),
          ["turn-started", "turn-ended"],
        );
      }),
    ),
);

// witness: apps/server/src/engine/pump/SessionHost.ts | ...(stored.images.length === 0 ? {} : { images: stored.images }), → ...(stored.images.length === 0 ? {} : { images }),
it.effect(
  "PU4: A Zerops result's pictures reach the record as references to the Mate's assets, never as bytes; breaks: picture bytes swell the record and every client's frame",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { body, stored } = yield* turnWith({
          itemType: "mcp_tool_call",
          title: "zerops_browser",
          data: {
            item: {
              type: "mcpToolCall",
              id: "call-1",
              server: "zerops",
              tool: "zerops_browser",
              status: "completed",
              arguments: { url: "https://api.example" },
              result: {
                content: [
                  { type: "text", text: '{"status":"ok"}' },
                  { type: "image", data: PIXEL, mimeType: "image/png" },
                ],
              },
            },
          },
        });
        assert.deepStrictEqual(stored, ["mate/r/1.i1: 1 picture"]);
        assert.deepStrictEqual(body?.result, {
          toolName: "zerops_browser",
          resultText: '{"status":"ok"}',
          images: [{ mimeType: "image/png", asset: PICTURE_ASSET, width: 1, height: 1 }],
        });
        assert.notProperty(body?.result?.images?.[0], "data");
      }),
    ),
);

// witness: apps/server/src/engine/pump/SessionHost.ts | if (kept !== null && body.result !== undefined) { → if (kept === null && body.result !== undefined) {
it.effect(
  "PU5: A page the Mate publishes is recorded on its call by reference, with its title, size and time; breaks: the call card cannot open the page",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = "/var/www/.zcp/state/pages/page-0123456789abcdef.html";
        const { body, stored } = yield* turnWith({
          itemType: "mcp_tool_call",
          title: "zerops_publish_page",
          data: {
            item: {
              type: "mcpToolCall",
              id: "call-1",
              server: "zerops",
              tool: "zerops_publish_page",
              status: "completed",
              arguments: { title: "Plan", path: "plan.html" },
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      page: { id: "page-0123456789abcdef", title: "Plan", file, bytes: 13 },
                      message: "Published",
                    }),
                  },
                ],
              },
            },
          },
        });
        assert.deepStrictEqual(stored, [`mate/r/1.i1: page ${file}`]);
        assert.deepStrictEqual(body?.result?.page, {
          asset: PAGE_ASSET,
          title: "Plan",
          bytes: 13,
          publishedAt: body?.endedAt ?? -1,
        });
      }),
    ),
);

// witness: apps/server/src/engine/pump/SessionHost.ts | if (picture !== null) body = { ...body, shows: { ...body.shows, ...picture } }; → if (picture !== null) body = { ...body, shows: { ...picture, ...body.shows } };
it.effect(
  "PU6: A workspace picture a call looked at is named by its asset; breaks: the call card shows a path the browser cannot read",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { body, stored } = yield* turnWith({
          itemType: "image_view",
          title: "Image view",
          data: { item: { type: "imageView", id: "call-1", path: "shots/home.png" } },
        });
        assert.deepStrictEqual(stored, ["mate/r/1.i1: shots/home.png"]);
        assert.strictEqual(body?.shows?.imagePath, "mate-asset:asset-2");
        assert.strictEqual(body?.shows?.imageName, "home.png");
      }),
    ),
);

// witness: apps/server/src/engine/pump/SessionHost.ts | if (!asked) exited = { session, words }; → if (asked) exited = { session, words };
it.effect(
  "PU7: A session that ended without the engine asking keeps the words it ended in for a send that then finds it gone, while a live session and a close the engine asked for give none; breaks: a send into a Claude session that failed before its first turn says only that the session was not live (live check, 2026-11-20)",
  () =>
    Effect.gen(function* () {
      // Claude Code's words for a resume it refused, as the bridge reports its exit.
      const WORDS = "No conversation found with session ID: 88888888-0000-0000-0000-000000000001";
      const exit = () =>
        hostEvent("session.exited", {
          provider: "claudeAgent",
          payload: { exitKind: "error", reason: WORDS },
        });
      const opened = Effect.gen(function* () {
        const { host } = yield* makeHostHarness({ driver: "claudeAgent" });
        yield* host.begin(S1);
        yield* host.record({ kind: "start", session: S1, from: "fresh" });
        yield* host.record({ kind: "started" });
        yield* host.openGate(S1);
        return host;
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const host = yield* opened;
          assert.strictEqual(yield* host.exitWords(S1), undefined);
          yield* host.offer(exit());
          assert.strictEqual(yield* host.exitWords(S1), WORDS);
        }),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const host = yield* opened;
          yield* host.record({ kind: "stop", cause: "asked" });
          yield* host.offer(exit());
          assert.strictEqual(yield* host.exitWords(S1), undefined);
        }),
      );
    }),
);
