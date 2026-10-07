import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import type { WireResponse } from "../../harness/http.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

describe("C: image tables at the conversation end", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("picture decoding keeps columns stable and the conversation end settles", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        let afterPicture: Buffer | undefined;
        let release!: (value: WireResponse) => void;
        const bytes = new Promise<WireResponse>((resolve) => {
          release = resolve;
        });
        yield* Effect.addFinalizer(() => Effect.sync(() => release({ status: 404 })));
        s.drivers.onMate.push((mate) => {
          const handle = mate.handle;
          mate.handle = (request) =>
            request.url.pathname.includes("/api/chat-assets/")
              ? bytes.then((response) =>
                  request.url.pathname.endsWith("after.png") && afterPicture
                    ? { ...response, bytes: afterPicture }
                    : response,
                )
              : handle(request);
        });
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history();
        wire.message(
          "comparison",
          "assistant",
          `${"A paragraph above the comparison.\n\n".repeat(30)}| Screenshot before UI | Screenshot after updates |\n| --- | --- |\n| ![Before overview](before.png) | ![After the layout update](after.png) |`,
        );
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Screenshot before UI");
        yield* Effect.promise(async () => {
          await s.page.waitForSelector(".chat-markdown-table-container img");
          const viewport = await s.page.$(".timeline-legend-list");
          const box = (await viewport!.boundingBox())!;
          await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await s.page.mouse.wheel({ deltaY: 10000 });
          const sample = () =>
            s.page.evaluate(async () => {
              const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
              const table = scroll.querySelector("table")!;
              const readings: number[][] = [];
              const deliveries: number[][] = [];
              const observer = new ResizeObserver((entries) => {
                for (const entry of entries)
                  if (entry.target === table)
                    deliveries.push([entry.contentRect.width, entry.contentRect.height]);
              });
              for (const node of scroll.querySelectorAll("*")) observer.observe(node);
              for (let frame = 0; frame < 120; frame += 1) {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                readings.push([
                  scroll.scrollTop,
                  scroll.scrollHeight,
                  scroll.clientHeight,
                  table.getBoundingClientRect().height,
                  table.getBoundingClientRect().width,
                  table.parentElement!.clientWidth,
                  ...[...table.querySelectorAll("td")].map(
                    (cell) => cell.getBoundingClientRect().width,
                  ),
                ]);
              }
              observer.disconnect();
              return { readings, deliveries };
            });
          const { readings, deliveries } = await sample();
          expect(
            new Set(deliveries.slice(-30).map((reading) => JSON.stringify(reading))).size,
          ).toBeLessThanOrEqual(1);
          // With no bytes or new messages arriving, neither column sizing nor
          // the conversation end may alternate after placement.
          expect(new Set(readings.slice(-30).map((reading) => JSON.stringify(reading))).size).toBe(
            1,
          );
          const [top, height, client] = readings.at(-1)!;
          expect(top! + client!).toBe(height);
          const pictures = await s.page.evaluate(() =>
            [520, 420].map((height) => {
              const canvas = document.createElement("canvas");
              canvas.width = 640;
              canvas.height = height;
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          );
          afterPicture = Buffer.from(pictures[1]!, "base64");
          release({
            bytes: Buffer.from(pictures[0]!, "base64"),
            headers: { "content-type": "image/png" },
          });
          await s.page.waitForFunction(
            () => {
              const images = [
                ...document.querySelectorAll<HTMLImageElement>(
                  ".chat-markdown-table-container img",
                ),
              ];
              return images.length === 2 && images.every((image) => image.naturalWidth === 640);
            },
            { timeout: 8000 },
          );
          const { readings: loaded, deliveries: decodedDeliveries } = await sample();
          expect(
            new Set(decodedDeliveries.slice(-30).map((reading) => JSON.stringify(reading))).size,
          ).toBeLessThanOrEqual(1);
          expect(new Set(loaded.slice(-30).map((reading) => JSON.stringify(reading))).size).toBe(1);
          expect(loaded.at(-1)!.slice(6)).toEqual(readings.at(-1)!.slice(6));
          expect(loaded.at(-1)![4]!).toBeLessThanOrEqual(loaded.at(-1)![5]!);
          const [loadedTop, loadedHeight, loadedClient] = loaded.at(-1)!;
          expect(loadedTop! + loadedClient!).toBe(loadedHeight);
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
