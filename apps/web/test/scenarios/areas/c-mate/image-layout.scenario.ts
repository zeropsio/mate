// @effect-diagnostics nodeBuiltinImport:off -- actual picture files in the isolated Mate workspace.
import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import { createScenario } from "../../harness/scenario.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { waitForStillFrames } from "../../harness/stillFrames.ts";

function readColumns() {
  const list = document.querySelector<HTMLElement>(".timeline-legend-list")!;
  const table = list.querySelector("table")!;
  return {
    end: list.scrollHeight - list.clientHeight - list.scrollTop,
    width: table.getBoundingClientRect().width,
    available: table.parentElement!.clientWidth,
    columns: [...table.querySelectorAll("td")].map((cell) => cell.getBoundingClientRect().width),
  };
}

describe("C: image tables at the conversation end", () => {
  scenarioSuite((it) => {
    it.effect("picture decoding keeps columns stable and the conversation end settles", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        // Demand the 640 px source rather than a smaller production preview.
        yield* Effect.promise(() =>
          s.page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 4 }),
        );
        yield* s.given.project("Ada", { mate: true });
        const mate = s.drivers.realMates.get("Ada")!;
        const pictures = yield* Effect.promise(() =>
          s.page.evaluate(() =>
            [520, 420].map((height) => {
              const canvas = document.createElement("canvas");
              canvas.width = 640;
              canvas.height = height;
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          ),
        );
        const [before, after] = ["before.png", "after.png"].map((name) =>
          NodePath.join(mate.server.root, "workspace", name),
        );
        yield* Effect.promise(() =>
          Promise.all(
            [before!, after!].map((path, i) =>
              NodeFSP.writeFile(path, Buffer.from(pictures[i]!, "base64")),
            ),
          ),
        );
        const held = mate.gate.holdHttp((path) => path.includes("/api/assets/"));
        yield* Effect.addFinalizer(() => Effect.sync(held.release));
        const conversationId = ConversationId.make("image-layout-history");
        yield* mate.server.engine.assignAgent(conversationId, {
          instanceId: "opencode",
          driver: "opencode",
          model: "gpt-5.4",
          profile: { kind: "mate" },
        });
        const protocol = MATE_ENGINE_PROTOCOLS[0]!;
        const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
        const frames = yield* Queue.unbounded<EngineConversationFrame>();
        yield* mate.server.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
          Stream.runForEach((frame) => Queue.offer(frames, frame)),
          Effect.forkScoped,
        );
        while ((yield* Queue.take(frames)).type !== "synchronized") {}
        yield* mate.provider.turn([
          {
            kind: "say",
            text: `${"A paragraph above the comparison.\n\n".repeat(30)}| Screenshot before UI | Screenshot after updates |\n| --- | --- |\n| ![Before overview](before.png) | ![After the layout update](after.png) |`,
          },
        ]);
        const sent = yield* mate.server.engine.wire.send(
          {
            protocol,
            conversationId,
            commandId: CommandId.make("image-layout-send"),
            text: "Compare the screenshots",
          },
          caller,
        );
        expect(sent._tag).toBe("Accepted");
        // Open finished real history, as the original fixture did; await the engine's terminal receipt.
        while (true) {
          const frame = yield* Queue.take(frames);
          if (frame.type === "changes" && frame.runs.some((run) => run.state === "ended")) break;
        }
        yield* s.given.signedIn;
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.showsMessage("Screenshot before UI");
        yield* Effect.promise(async () => {
          await s.page.waitForSelector(".chat-markdown-table-container img");
          const viewport = await s.page.$(".timeline-legend-list");
          const box = (await viewport!.boundingBox())!;
          await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await s.page.mouse.wheel({ deltaY: 10000 });
          await held.held;
          const settle = () =>
            waitForStillFrames(s.page, {
              selector: ".timeline-legend-list, table, td, table img",
              stillFrames: 30,
            });
          await settle();
          const pending = await s.page.evaluate(readColumns);
          expect(pending.end, "ASSERTION: the held-picture conversation reaches its end").toBe(0);
          held.release();
          await s.page.waitForFunction(() => {
            const images = [
              ...document.querySelectorAll<HTMLImageElement>(".chat-markdown-table-container img"),
            ];
            return images.length === 2 && images.every((image) => image.naturalWidth === 640);
          });
          await settle();
          const decoded = await s.page.evaluate(readColumns);
          expect(decoded.columns, "ASSERTION: decoding preserves both table columns").toEqual(
            pending.columns,
          );
          expect(decoded.width, "ASSERTION: the image table fits its column").toBeLessThanOrEqual(
            decoded.available,
          );
          expect(decoded.end, "ASSERTION: decoding leaves the conversation at its end").toBe(0);
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
