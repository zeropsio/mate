import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

describe("Decision: restore pre-regression behaviour; no test weakened; titles kept.", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const state of ["plain", "notice", "stack", "review"] as const)
      it.effect(
        `the last row ends above the docked composer and history never paints below it (${state})`,
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario([installArea]);
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            if (state === "review") yield* changeFixture(s);
            else yield* s.given.project("Ada", { mate: true });
            const chat = mateChat(s);
            const wire = chat.fixture();
            wire.history("Read this long conversation");
            for (let i = 0; i < 25; i++)
              wire.exchange(
                `Earlier question ${i}`,
                "> Important: keep this conversation readable.\n\n".repeat(8),
              );
            wire.exchange("Finish here", "The last answer is above the composer.");
            if (state === "notice" || state === "stack") {
              wire.claudeLoginFacts("ready");
              wire.activity("context-window.updated", "Context used", { usedTokens: 180_000 });
              wire.snapshot({
                modelSelection: {
                  instanceId: ProviderInstanceId.make("claudeAgent"),
                  model: "sonnet",
                },
              });
              if (state === "stack") {
                const primary = wire.mate.thread;
                wire.run("other-work", "running");
                wire.threadCollection(primary, [
                  { ...wire.mate.thread, id: ThreadId.make("other-chat"), title: "Other work" },
                ]);
              }
            }
            yield* s.given.signedIn;
            yield* chat.when.open("Ada", "Finish here");
            yield* chat.then.text("The last answer is above the composer.");
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => {
                  const list = document.querySelector<HTMLElement>(".timeline-legend-list");
                  return (
                    list &&
                    !document.querySelector(
                      '[data-conversation-opening]:not([data-conversation-opening="complete"])',
                    ) &&
                    !document.querySelector("[data-timeline-placing]") &&
                    Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 2
                  );
                },
                { polling: "raf", timeout: 8000 },
              ),
            );
            if (state === "notice" || state === "stack")
              yield* chat.then.text("Resume with less context");
            if (state === "review") yield* chat.then.text("Ada is waiting for your review of #1");
            if (state === "stack") {
              yield* chat.when.type("Keep this draft");
              yield* Effect.promise(async () => {
                const edge = await s.page.waitForSelector(
                  'button[aria-label="Show 1 more notice"]',
                  { visible: true },
                );
                const box = (await edge!.boundingBox())!;
                await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                await s.page.waitForSelector('button[aria-expanded="true"]');
              });
              yield* chat.then.control("Collapse notices");
            }
            // End placement includes the attached notice frame. The pixel witness below
            // compares the same rendered frame with and without timeline paint; no colour golden.
            const end = yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const rows = [
                  ...document.querySelectorAll(".timeline-legend-list [data-timeline-root]"),
                ];
                return {
                  count: rows.length,
                  row: Math.max(...rows.map((row) => row.getBoundingClientRect().bottom)),
                  composer: document
                    .querySelector("[data-chat-composer-overlay]")!
                    .getBoundingClientRect().top,
                };
              }),
            );
            expect(end.count, "ASSERTION: real timeline rows are rendered").toBeGreaterThan(0);
            expect(
              end.row,
              "ASSERTION: the last row ends above the docked composer",
            ).toBeLessThanOrEqual(end.composer);
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
