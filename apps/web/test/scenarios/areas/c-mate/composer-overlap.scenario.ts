import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { composerLayout, composerStates } from "./composerLayout.ts";

// Paint comparison complements geometry: transparent surfaces still have the same boxes.
describe("Decision: restore pre-regression behaviour; no test weakened; titles kept.", () => {
  scenarioSuite((it) => {
    for (const state of composerStates)
      it.effect(`history does not paint through the composer footer (${state})`, () =>
        Effect.gen(function* () {
          const { s } = yield* composerLayout(state);
          yield* Effect.promise(async () => {
            const list = await s.page.$(".timeline-legend-list");
            const bounds = (await list!.boundingBox())!;
            await s.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
            await s.page.mouse.wheel({ deltaY: -350 });
            await s.page.waitForFunction(
              () => !document.querySelector("[data-timeline-follows-end]"),
              { polling: "raf" },
            );
            const clip = await s.page.$eval('[data-slot="composer-shell"]', (node) => {
              const box = node.getBoundingClientRect();
              const overlay = document
                .querySelector("[data-chat-composer-overlay]")!
                .getBoundingClientRect();
              return {
                x: overlay.left,
                y: Math.ceil(box.bottom),
                width: overlay.width,
                height: 1000 - Math.ceil(box.bottom),
              };
            });
            if (process.env.MATE_COMPOSER_FRAMES)
              await s.page.screenshot({
                path: `${process.env.MATE_COMPOSER_FRAMES}/${state}.png`,
              });
            const visible = await s.page.screenshot({ clip });
            await list!.evaluate((node) => {
              (node as HTMLElement).style.visibility = "hidden";
            });
            const hidden = await s.page.screenshot({ clip });
            // Since the list ends where it stops (0a481af341), compositing under the footer's blur
            // differs by a level in a channel; history painting through differs by tens.
            const difference = await s.page.evaluate(
              async (shots) => {
                const pixels = (data: string) =>
                  new Promise<Uint8ClampedArray>((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => {
                      const canvas = document.createElement("canvas");
                      canvas.width = image.width;
                      canvas.height = image.height;
                      const context = canvas.getContext("2d")!;
                      context.drawImage(image, 0, 0);
                      resolve(context.getImageData(0, 0, image.width, image.height).data);
                    };
                    image.onerror = reject;
                    image.src = `data:image/png;base64,${data}`;
                  });
                const [a, b] = await Promise.all(shots.map(pixels));
                let most = 0;
                for (let index = 0; index < a!.length; index++)
                  most = Math.max(most, Math.abs(a![index]! - b![index]!));
                return most;
              },
              [Buffer.from(visible).toString("base64"), Buffer.from(hidden).toString("base64")],
            );
            expect(
              difference,
              "ASSERTION: conversation content never paints below the docked composer",
            ).toBeLessThanOrEqual(2);
          });
        }),
      );
  });
});
