import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { SessionId, type TurnHandle } from "@t3tools/contracts";

import { PIXEL } from "../testing/bridge/callHeavy.ts";
import { hostEvent, makeHostHarness } from "../testing/pump/hostHarness.ts";
import type { CallPictures } from "./callPictures.ts";

const S1 = SessionId.make("mate/s/1.1");
const H1 = "mate/r/1" as TurnHandle;

describe("SessionHost", () => {
  it.effect("a send's evidence reaches it even when the driver answered before it waited", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { host } = yield* makeHostHarness();
        yield* host.begin(S1);
        yield* host.record({ kind: "start", session: S1, from: "fresh" });
        yield* host.record({ kind: "started" });
        yield* host.openGate(S1);
        const evidence = yield* host.beginSend(H1, "new");
        yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
        // The driver took it, and the host folded that, before the handler waits.
        yield* host.settled;
        assert.deepStrictEqual(yield* evidence, { _tag: "Accepted", as: "opened", into: null });
      }),
    ),
  );

  it.effect(
    "a batch the actor fails to take is told again until it takes it, so a turn's end is never lost",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { host, told } = yield* makeHostHarness({ failFirst: 8 });
          yield* host.begin(S1);
          yield* host.record({ kind: "start", session: S1, from: "fresh" });
          yield* host.record({ kind: "started" });
          yield* host.openGate(S1);
          yield* Effect.asVoid(host.beginSend(H1, "new"));
          yield* host.record({ kind: "sent", turn: H1, nativeTurn: "T1" });
          yield* host.offer(
            hostEvent("turn.completed", { turnId: "T1", payload: { state: "completed" } }),
          );
          const settled = yield* Effect.forkChild(host.settled);
          for (let i = 0; i < 20; i++) yield* TestClock.adjust("30 seconds");
          yield* Fiber.join(settled);
          assert.deepStrictEqual(
            told.flat().map((signal) => signal.kind),
            ["turn-started", "turn-ended"],
          );
        }),
      ),
  );

  describe("a call's pictures", () => {
    /** A Codex turn whose one call is a Zerops screenshot, or a look at a workspace picture. */
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
                  asset: {
                    id: "asset-1",
                    threadId: "mate/s/1",
                    ownerId: "call-1",
                    name: "tool-image",
                    provenance: "capture",
                    original: {
                      status: "ready",
                      digest: "a".repeat(64),
                      mimeType: "image/png",
                      sizeBytes: 68,
                    },
                  } as never,
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
        };
        const { host, told } = yield* makeHostHarness({ pictures });
        yield* host.begin(S1);
        yield* host.record({ kind: "start", session: S1, from: "fresh" });
        yield* host.record({ kind: "started" });
        yield* host.openGate(S1);
        yield* Effect.asVoid(host.beginSend(H1, "new"));
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
        return { call: call?.kind === "item-closed" ? call : undefined, stored };
      });

    it.effect(
      "a Zerops result's pictures reach the record as references to the Mate's assets, never bytes",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { call, stored } = yield* turnWith({
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
            assert.deepStrictEqual(call?.body.kind === "call" ? call.body.result : undefined, {
              toolName: "zerops_browser",
              resultText: '{"status":"ok"}',
              images: [
                {
                  mimeType: "image/png",
                  asset: {
                    id: "asset-1",
                    threadId: "mate/s/1",
                    ownerId: "call-1",
                    name: "tool-image",
                    provenance: "capture",
                    original: {
                      status: "ready",
                      digest: "a".repeat(64),
                      mimeType: "image/png",
                      sizeBytes: 68,
                    },
                  } as never,
                  width: 1,
                  height: 1,
                },
              ],
            });
            const shown = call?.body.kind === "call" ? call.body.result?.images?.[0] : undefined;
            assert.notProperty(shown, "data");
          }),
        ),
    );

    it.effect("a workspace picture a call looked at is named by its asset", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { call, stored } = yield* turnWith({
            itemType: "image_view",
            title: "Image view",
            data: { item: { type: "imageView", id: "call-1", path: "shots/home.png" } },
          });
          assert.deepStrictEqual(stored, ["mate/r/1.i1: shots/home.png"]);
          const shows = call?.body.kind === "call" ? call.body.shows : undefined;
          assert.strictEqual(shows?.imagePath, "mate-asset:asset-2");
          assert.strictEqual(shows?.imageName, "home.png");
        }),
      ),
    );

    it.effect("a completed call names its own record among the parts read on demand", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { call } = yield* turnWith({
            itemType: "file_change",
            title: "File change",
            data: { item: { type: "fileChange", id: "call-1", changes: [] } },
          });
          assert.deepStrictEqual(call?.body.kind === "call" ? call.body.parts : undefined, [
            "data",
          ]);
        }),
      ),
    );
  });
});
