import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { composerLayout, composerStates } from "./composerLayout.ts";

// Paint comparison complements geometry: transparent surfaces still have the same boxes.
describe("Decision: restore pre-regression behaviour; no test weakened; titles kept.", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const state of composerStates)
      it.effect(`history does not paint through the composer footer (${state})`, () =>
        Effect.gen(function* () {
          const { s, chat } = yield* composerLayout(state);
          if (state === "stack") {
            yield* chat.when.type("Keep this draft");
            yield* Effect.promise(async () => {
              const edge = await s.page.waitForSelector('button[aria-label="Show 1 more notice"]', {
                visible: true,
              });
              const box = (await edge!.boundingBox())!;
              await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
              await s.page.waitForSelector('button[aria-expanded="true"]');
            });
            yield* chat.then.control("Collapse notices");
          }
          yield* Effect.promise(async () => {
            const list = await s.page.$(".timeline-legend-list");
            const bounds = (await list!.boundingBox())!;
            await s.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
            await s.page.mouse.wheel({ deltaY: -350 });
            await s.page.waitForFunction(
              () => !document.querySelector("[data-timeline-follows-end]"),
              { polling: "raf", timeout: 8000 },
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
            expect(
              Buffer.compare(visible, hidden),
              "ASSERTION: conversation content never paints below the docked composer",
            ).toBe(0);
          });
        }),
      );
  });
});
