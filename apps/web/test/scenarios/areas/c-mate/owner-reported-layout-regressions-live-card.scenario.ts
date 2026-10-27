import type { Page } from "puppeteer-core";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";
import { ownerMenu, quoted, pictureConversation } from "./ownerReportedLayout.ts";

describe("owner-reported layout regressions", () => {
  describe("Decision: geometry relations only; no style pins.", () => {
    const shapes = [
      { name: "small", width: 160, height: 80 },
      { name: "wide", width: 1200, height: 300 },
      { name: "tall", width: 300, height: 1200 },
      { name: "square", width: 640, height: 640 },
    ];

    describe("Decision: restore correct proportions; no test weakened.", () => {
      describe("C: image viewer proportions", () => {
        it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
          for (const shape of shapes) {
            it.effect(
              `the ${shape.name} picture keeps its natural proportions before and after zoom and resizing`,
              () =>
                Effect.gen(function* () {
                  const s = yield* pictureConversation(shape);
                  yield* Effect.promise(async () => {
                    await s.page.click('button[aria-label="Open picture 1"]');
                    await s.page
                      .waitForFunction(() => {
                        const image = document.querySelector<HTMLImageElement>(
                          '[role="dialog"] img[data-image-src]',
                        );
                        return (
                          image && image.naturalWidth > 0 && getComputedStyle(image).opacity === "1"
                        );
                      })
                      .catch(async (cause) => {
                        throw new Error(
                          JSON.stringify(
                            await s.page.evaluate(() => ({
                              text: document.body.innerText,
                              images: [...document.querySelectorAll("img")].map((image) => ({
                                src: image.src,
                                width: image.naturalWidth,
                                opacity: getComputedStyle(image).opacity,
                              })),
                            })),
                          ),
                          { cause },
                        );
                      });
                    for (const viewport of [
                      { width: 1786, height: 1000 },
                      { width: 390, height: 844 },
                    ]) {
                      if (viewport.width === 390) {
                        await s.page.setViewport(viewport);
                        await s.page.waitForFunction(
                          () =>
                            document.querySelector('[role="dialog"] [aria-live]')?.textContent ===
                            "100% zoom",
                        );
                      }
                      await s.page.focus('[role="dialog"] [role="region"]');
                      for (const [key, zoom] of [
                        ["0", 100],
                        ["Enter", 200],
                        ["+", 300],
                        ["+", 450],
                        ["+", 675],
                        ["+", 800],
                      ] as const) {
                        await s.page.keyboard.press(key);
                        await s.page
                          .waitForFunction(
                            (zoom) =>
                              document.querySelector('[role="dialog"] [aria-live]')?.textContent ===
                              `${zoom}% zoom`,
                            {},
                            zoom,
                          )
                          .catch(async (cause) => {
                            throw new Error(
                              `Zoom ${zoom}: ${await s.page.$eval('[role="dialog"]', (node) => node.textContent)}`,
                              { cause },
                            );
                          });
                        const geometry = await s.page.$eval(
                          '[role="dialog"] img[data-image-src]',
                          (node) => {
                            const image = node as HTMLImageElement;
                            const box = image.getBoundingClientRect();
                            return {
                              width: box.width,
                              height: box.height,
                              naturalWidth: image.naturalWidth,
                              naturalHeight: image.naturalHeight,
                            };
                          },
                        );
                        if (
                          process.env.MATE_IMAGE_ASPECT_EVIDENCE &&
                          shape.name === "small" &&
                          viewport.width === 390 &&
                          zoom === 300
                        ) {
                          await s.page.screenshot({
                            path: `${process.env.MATE_IMAGE_ASPECT_EVIDENCE}.png`,
                          });
                        }
                        expect(geometry.naturalWidth).toBe(shape.width);
                        expect(geometry.naturalHeight).toBe(shape.height);
                        expect(geometry.width).toBeGreaterThan(0);
                        expect(
                          Math.abs(
                            geometry.width / geometry.height / (shape.width / shape.height) - 1,
                          ),
                          `ASSERTION: ${shape.name} picture preserves its natural aspect ratio within 1% at ${zoom}% zoom in ${viewport.width}x${viewport.height}`,
                        ).toBeLessThanOrEqual(0.01);
                      }
                    }
                    await s.page.keyboard.press("Escape");
                    await s.page.waitForSelector('[role="dialog"]', { hidden: true });
                  });
                  yield* s.then.noExternalNetwork;
                }),
            );
          }
        });
      });
    });

    describe("C: image viewer backdrop", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect("an opened picture covers the conversation with its dark backdrop", () =>
          Effect.gen(function* () {
            const s = yield* pictureConversation({ name: "square", width: 640, height: 640 });
            const cover = yield* Effect.promise(async () => {
              await s.page.click('button[aria-label="Open picture 1"]');
              await s.page.waitForFunction(() => {
                const image = document.querySelector<HTMLImageElement>(
                  '[role="dialog"] img[data-image-src]',
                );
                return image && image.naturalWidth > 0 && getComputedStyle(image).opacity === "1";
              });
              await waitForStillFrames(s.page);
              return s.page.evaluate(() => {
                const picture = document
                  .querySelector('[role="dialog"] img[data-image-src]')!
                  .getBoundingClientRect();
                // Beside the picture, over the conversation's column (the menu ends at 435 px).
                const beside = { x: picture.left - 40, y: picture.top + picture.height / 2 };
                const stack = document.elementsFromPoint(beside.x, beside.y);
                const backdrop = document.querySelector('[data-slot="dialog-backdrop"]');
                const root = document.getElementById("root")!;
                const box = backdrop?.getBoundingClientRect();
                const style = backdrop === null ? null : getComputedStyle(backdrop);
                return {
                  beside,
                  viewport: { width: innerWidth, height: innerHeight },
                  backdrop:
                    box === undefined
                      ? null
                      : { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
                  backdropAt: backdrop === null ? -1 : stack.indexOf(backdrop),
                  conversationAt: stack.findIndex((element) => root.contains(element)),
                  shown:
                    style !== null &&
                    style.opacity === "1" &&
                    style.backgroundColor !== "transparent" &&
                    !/\/ 0\)$|, 0\)$/u.test(style.backgroundColor),
                };
              });
            });
            const reading = quoted(cover);
            expect(
              cover.backdrop,
              `ASSERTION: an opened picture has a backdrop: ${reading}`,
            ).toEqual({
              left: 0,
              top: 0,
              right: cover.viewport.width,
              bottom: cover.viewport.height,
            });
            expect(
              cover.backdropAt >= 0 &&
                (cover.conversationAt === -1 || cover.backdropAt < cover.conversationAt),
              `ASSERTION: beside the picture, the backdrop lies over the conversation: ${reading}`,
            ).toBe(true);
            expect(
              cover.shown,
              `ASSERTION: the backdrop is drawn, not see-through: ${reading}`,
            ).toBe(true);
          }),
        );
      });
    });

    describe("Decision: Aleš's direction; keep existing fold behaviour and titles otherwise.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect(
          "work appears inline with the first log row and a folded run has no empty region or divider",
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(async () => {
                await s.page.setViewport({ width: 1786, height: 1000 });
                await s.page.emulateMediaFeatures([
                  { name: "prefers-color-scheme", value: "light" },
                ]);
              });
              yield* s.given.project("Ada", { mate: true });
              const chat = mateChat(s);
              const wire = chat.fixture();
              wire.history("Watch the work control");
              wire.history("Inspect the build", "work-run");
              wire.run("work-run", "running");
              yield* s.given.signedIn;
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* chat.when.open("Ada", "Inspect the build");
              const cardSelector = "[data-run-chat][data-run-live]";
              yield* Effect.promise(() => s.page.waitForSelector(`${cardSelector} [data-run-now]`));
              const inspect = () =>
                Effect.promise(async () => {
                  await s.page.waitForFunction(
                    (selector) => {
                      const card = document.querySelector(selector);
                      if (!card || card.closest("[data-timeline-placing]")) return false;
                      for (let node: Element | null = card; node; node = node.parentElement) {
                        const style = getComputedStyle(node);
                        if (style.visibility !== "visible" || style.opacity !== "1") return false;
                      }
                      return document
                        .getAnimations()
                        .every(
                          (animation) =>
                            animation.effect?.getTiming().iterations === Infinity ||
                            animation.playState !== "running",
                        );
                    },
                    { polling: "raf" },
                    cardSelector,
                  );
                  return s.page.$eval(cardSelector, (card) => {
                    const line = [...card.querySelectorAll<HTMLElement>("[data-run-now]")].find(
                      (node) => node.getBoundingClientRect().height > 0,
                    )!;
                    const toggle = card.querySelector<HTMLButtonElement>(".run-now-fold");
                    const lineBox = line.getBoundingClientRect();
                    const buttonBox = toggle?.getBoundingClientRect();
                    return {
                      toggle: toggle?.textContent ?? null,
                      inline:
                        toggle !== null &&
                        line.contains(toggle) &&
                        buttonBox !== undefined &&
                        buttonBox.top >= lineBox.top &&
                        buttonBox.bottom <= lineBox.bottom,
                      divider: line.clientTop > 0,
                      emptyRegion: lineBox.top - card.getBoundingClientRect().top > 1,
                    };
                  });
                });
              const capture = (state: string) =>
                Effect.promise(async () => {
                  const output = process.env.MATE_RUN_CARD_EVIDENCE;
                  if (output) {
                    const card = await s.page.$(cardSelector);
                    await card!.screenshot({ path: `${output}/${state}.png` });
                  }
                });
              expect(
                yield* inspect(),
                "ASSERTION: a run without work is only its status line",
              ).toEqual({
                toggle: null,
                inline: false,
                divider: false,
                emptyRegion: false,
              });
              yield* capture("empty");
              wire.call(
                "work-first",
                "done",
                {
                  toolName: "Bash",
                  command: "echo ready",
                  input: { command: "echo ready", description: "Check the build" },
                },
                "work-run",
              );
              yield* Effect.promise(() => s.page.waitForSelector(`${cardSelector} .run-now-fold`));
              expect(
                yield* inspect(),
                "ASSERTION: the first work row enables an inline Hide work",
              ).toMatchObject({
                toggle: "Hide work",
                inline: true,
              });
              yield* capture("first-row");
              yield* Effect.promise(() =>
                s.page.waitForSelector(`${cardSelector} [data-run-scroll]`),
              );
              expect(yield* inspect()).toMatchObject({ toggle: "Hide work", inline: true });
              yield* capture("open");
              yield* chat.when.activateLast("Hide work");
              expect(
                yield* inspect(),
                "ASSERTION: a folded run has only its status line and inline Show work",
              ).toEqual({
                toggle: "Show work",
                inline: true,
                divider: false,
                emptyRegion: false,
              });
              yield* capture("closed");
              yield* chat.when.activateLast("Show work");
              expect(yield* inspect()).toMatchObject({ toggle: "Hide work", inline: true });
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    // Milo's stress run 4 (2026-10-10, engine): at the usage limit the notice stood at the top of a
    // viewport-tall row with ~520 px blank under it, then scrolled half out of view; a message sent
    // while paused sat a viewport below it with no sign it was held. Then the owner's pick on the
    // "Answer Then More Work" board (B5, 2026-10-12): the card waits through the pause, its face
    // asleep and its head saying when it goes on; no notice stands under it.
    describe("Decision: the card waits through the pause; what waits for the reset sits under it.", () => {
      interface LimitFrame {
        /** When the frame was sampled (ms, the page's clock). */
        readonly at: number;
        readonly listTop: number;
        readonly scroll: number;
        /** How far the view stands from the list's end. */
        readonly end: number;
        readonly composer: number;
        /** The run's card the limit cut: its edges. */
        readonly card: { readonly top: number; readonly bottom: number } | null;
        /** The top of the held message's words; null off screen. */
        readonly message: number | null;
        /** What its head says. */
        readonly head: string | null;
      }
      const HELD = "Then write the table of every helper and job";
      const startTrace = (page: Page) =>
        page.evaluate((text) => {
          const frames: LimitFrame[] = [];
          const state = { active: true };
          // The card the limit cut: the one that holds the Mate's command.
          let cut: Element | null = null;
          const read = (): LimitFrame | null => {
            const list = document.querySelector<HTMLElement>(".timeline-legend-list");
            const composer = document.querySelector('[data-slot="composer-shell"]');
            if (!list || !composer) return null;
            if (cut === null || !cut.isConnected)
              cut =
                [...list.querySelectorAll("[data-run-chat]")].find((node) =>
                  node.textContent?.includes("sleep 25"),
                ) ?? null;
            const box = cut?.getBoundingClientRect();
            let message: number | null = null;
            const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent?.includes(text)) continue;
              const rect = walker.currentNode.parentElement?.getBoundingClientRect();
              if (rect && rect.height > 0) message = rect.top;
              break;
            }
            return {
              at: performance.now(),
              listTop: list.getBoundingClientRect().top,
              scroll: list.scrollTop,
              end: list.scrollHeight - list.clientHeight - list.scrollTop,
              composer: composer.getBoundingClientRect().top,
              card: box && box.height > 0 ? { top: box.top, bottom: box.bottom } : null,
              message,
              head: cut?.querySelector(":scope > [data-run-head]")?.textContent ?? null,
            };
          };
          const sample = () => {
            const frame = read();
            if (frame) frames.push(frame);
            if (state.active) requestAnimationFrame(sample);
          };
          (window as unknown as { limitTrace: unknown }).limitTrace = { frames, state };
          sample();
        }, HELD);
      const stopTrace = (page: Page) =>
        waitForStillFrames(page, { stillFrames: 24 }).then(() =>
          page.evaluate(() => {
            const held = (
              window as unknown as {
                limitTrace: { frames: LimitFrame[]; state: { active: boolean } };
              }
            ).limitTrace;
            held.state.active = false;
            return held.frames;
          }),
        );
      const pausedMilo = Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* Effect.promise(() =>
          s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
        );
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        for (const round of [1, 2, 3])
          chat
            .fixture()
            .exchange(
              `How did deploy ${round} go?`,
              "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                12,
              ),
            );
        chat.fixture().exchange("And now?", "The existing conversation is still here");
        const wire = chat.fixture().wire;
        const engine = wire.engine;
        yield* s.given.signedIn;
        yield* Effect.promise(() => ownerMenu(s.page));
        yield* chat.when.open();
        // The person starts the run, as on Milo: its records carry the wall clock from here.
        yield* chat.when.send("Live stress test 4A: start two helpers");
        const run = [...engine.runs.values()].at(-1)!.id;
        engine.item(run, {
          kind: "call",
          step: "command",
          tool: { name: "Bash" },
          words: "Command run",
          state: "done",
          endedAt: yield* Clock.currentTimeMillis,
          input: "Bash: sleep 25 && echo helper-job-done",
        });
        // Claude's words: the run's end carried its answer empty, its words came 154 ms later.
        const said = engine.item(run, { kind: "note", text: "", streaming: false, answer: false });
        yield* Effect.promise(() => waitForStillFrames(s.page));
        yield* Effect.promise(() => startTrace(s.page));
        engine.limit(run, (yield* Clock.currentTimeMillis) + 18 * 3_600_000);
        yield* Effect.promise(() => waitForStillFrames(s.page));
        engine.update(said, { text: "You've hit your weekly limit · resets 1pm (UTC)" });
        yield* Effect.promise(() =>
          s.page.waitForSelector('[data-run-head][data-run-now="paused"]'),
        );
        const frames = yield* Effect.promise(() => stopTrace(s.page));
        return { s, chat, engine, frames };
      });

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect(
          "at the usage limit the card stays where it stands, and the conversation stays at its end, fully visible above the composer",
          () =>
            Effect.gen(function* () {
              const { s, frames } = yield* pausedMilo;
              const shown = frames.filter((frame) => frame.card !== null);
              expect(shown.length, "ASSERTION: the card was sampled").toBeGreaterThan(20);
              const last = shown.at(-1)!;
              expect(last.head, "ASSERTION: its head says when it goes on").toMatch(
                /limit · goes on /,
              );
              expect(last.end, "ASSERTION: the conversation stays at its end").toBeLessThanOrEqual(
                1,
              );
              expect(
                last.composer - last.card!.bottom,
                "ASSERTION: no blank stands between the card and the composer",
              ).toBeLessThan(80);
              expect(
                last.card!.bottom <= last.composer,
                "ASSERTION: the card ends fully visible above the composer",
              ).toBe(true);
              const tops = shown.map((frame) => frame.card!.top + frame.scroll);
              expect(
                Math.max(...tops) - Math.min(...tops),
                "ASSERTION: the card keeps its place in the conversation as it starts to wait",
              ).toBeLessThanOrEqual(1);
              expect(
                yield* Effect.promise(() =>
                  s.page.$$eval('[data-timeline-row-kind="pause"]', (nodes) => nodes.length),
                ),
                "ASSERTION: no notice stands under the card",
              ).toBe(0);
              yield* s.then.noExternalNetwork;
            }),
        );

        // Milo's stress runs 4 and 5: while paused, the composer stood 61 px taller than at work, an
        // empty band at its top reserved for a review its Mate, in no application, could never get.
        it.effect("while a pause holds a message the composer holds no empty band at its top", () =>
          Effect.gen(function* () {
            const { s, chat } = yield* pausedMilo;
            yield* chat.when.send(HELD);
            yield* Effect.promise(() => s.page.waitForSelector('[data-message-receipt="held"]'));
            yield* Effect.promise(() => waitForStillFrames(s.page));
            const band = yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const shell = document.querySelector('[data-slot="composer-shell"]')!;
                const editor = shell.querySelector('[data-testid="composer-editor"]')!;
                return editor.getBoundingClientRect().top - shell.getBoundingClientRect().top;
              }),
            );
            expect(
              band,
              "ASSERTION: the composer's words start at its own padding, no band above them",
            ).toBeLessThan(32);
            yield* s.then.noExternalNetwork;
          }),
        );

        // Milo's stress run 5: as the pause lifted the conversation moved 33 px. Above the new run
        // nothing changed, yet the view followed it up, then sank back.
        it.effect(
          "when the pause lifts nothing above the live tail moves and the view only follows the run",
          () =>
            Effect.gen(function* () {
              const { s, chat, engine } = yield* pausedMilo;
              yield* chat.when.send(HELD);
              yield* Effect.promise(() => s.page.waitForSelector('[data-message-receipt="held"]'));
              yield* Effect.promise(() => waitForStillFrames(s.page));
              yield* Effect.promise(() => startTrace(s.page));
              engine.lift();
              const frames = (yield* Effect.promise(() => stopTrace(s.page))).filter(
                (frame) => frame.card !== null,
              );
              const first = frames[0]!;
              expect(
                Math.max(
                  ...frames.map((frame) =>
                    Math.abs(frame.card!.top + frame.scroll - (first.card!.top + first.scroll)),
                  ),
                ),
                "ASSERTION: the card the limit cut keeps its place in the conversation",
              ).toBeLessThanOrEqual(1);
              expect(
                Math.max(
                  ...frames
                    .slice(1)
                    .map((frame, index) => frame.card!.top - frames[index]!.card!.top),
                ),
                "ASSERTION: the view never sinks back: what stands above the new run only rises with it",
              ).toBeLessThanOrEqual(1);
              expect(
                Math.max(...frames.map((frame) => Math.abs(frame.composer - first.composer))),
                "ASSERTION: the composer stands still as the pause lifts",
              ).toBeLessThanOrEqual(1);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "a message sent while paused sits right under the card, held until the reset, and goes in place when the pause lifts",
          () =>
            Effect.gen(function* () {
              const { s, chat, engine } = yield* pausedMilo;
              yield* chat.when.send(HELD);
              const receipt = yield* Effect.promise(() =>
                s.page.waitForSelector('[data-message-receipt="held"]'),
              );
              expect(
                yield* Effect.promise(() => receipt!.evaluate((node) => node.ariaLabel)),
              ).toMatch(/^Sends when the limit resets /);
              yield* Effect.promise(() => waitForStillFrames(s.page));
              yield* Effect.promise(() => startTrace(s.page));
              const held = (yield* Effect.promise(() => stopTrace(s.page))).at(-1)!;
              expect(held.end, "ASSERTION: the conversation stays at its end").toBeLessThanOrEqual(
                1,
              );
              expect(held.card, "ASSERTION: the card stays in view").not.toBeNull();
              expect(held.head, "ASSERTION: the card still waits").toMatch(/limit · goes on /);
              expect(
                held.message! - held.card!.bottom,
                "ASSERTION: the held message sits right under the card",
              ).toBeLessThan(96);
              expect(
                held.message!,
                "ASSERTION: the held message stands above the composer",
              ).toBeLessThan(held.composer);

              // Slowed tenfold while sampled: a CI runner that stalls for a few frames still samples
              // a glide mid-way, and a cut still has no mid-way.
              yield* Effect.promise(() => startTrace(s.page));
              engine.lift();
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () => !document.querySelector('[data-message-receipt="held"]'),
                  { polling: "raf" },
                ),
              );
              const frames = (yield* Effect.promise(() => stopTrace(s.page))).filter(
                (frame) => frame.card !== null && frame.message !== null,
              );
              expect(frames.length, "ASSERTION: the lift was sampled").toBeGreaterThan(10);
              const steps = (of: (frame: LimitFrame) => number) =>
                Math.max(
                  ...frames
                    .slice(1)
                    .map((frame, index) => Math.abs(of(frame) - of(frames[index]!))),
                );
              expect(
                steps((frame) => frame.message!),
                "ASSERTION: the message moves by a glide as its run starts, never a jump",
              ).toBeLessThan(60);
              expect(
                Math.max(
                  ...frames.map((frame) =>
                    Math.abs(
                      frame.message! -
                        frame.card!.bottom -
                        (frames[0]!.message! - frames[0]!.card!.bottom),
                    ),
                  ),
                ),
                "ASSERTION: the message keeps its place under the card as its mark clears",
              ).toBeLessThanOrEqual(2);
              expect(
                [...engine.runs.values()].at(-1)!.state,
                "ASSERTION: the held message's run starts",
              ).toBe("running");
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    describe("Decision: the live card's head is its one line of controls; the Mate's words are read as they are written.", () => {
      interface FootFrame {
        readonly card: {
          readonly top: number;
          readonly bottom: number;
          readonly left: number;
          readonly right: number;
        };
        /** The boxes of the working line's words. */
        readonly words: ReadonlyArray<{ readonly top: number; readonly bottom: number }>;
        readonly controls: ReadonlyArray<{
          readonly name: string;
          readonly top: number;
          readonly bottom: number;
          readonly left: number;
          readonly right: number;
        }>;
      }
      const readFoot = (page: Page) =>
        page.evaluate((): FootFrame | null => {
          const card = [
            ...document.querySelectorAll<HTMLElement>("[data-run-chat][data-run-live]"),
          ].at(-1);
          const line = card?.querySelector<HTMLElement>(":scope > [data-run-now]:not([hidden])");
          if (!card || !line) return null;
          const box = card.getBoundingClientRect();
          const bubbles = [...line.querySelectorAll<HTMLElement>("[data-chat-bubble]")];
          const words = bubbles.map((bubble) => {
            const rect = bubble.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          });
          const controls = [...card.querySelectorAll<HTMLButtonElement>("button")]
            .filter((button) =>
              ["Hide work", "Show work", "Stop"].includes(button.textContent ?? ""),
            )
            .map((button) => {
              const rect = button.getBoundingClientRect();
              return {
                name: button.textContent ?? "",
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
              };
            });
          return {
            card: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
            words,
            controls,
          };
        });
      const settledFoot = (page: Page, wanted: ReadonlyArray<string>) =>
        page.waitForFunction(
          (names: ReadonlyArray<string>) => {
            const card = [...document.querySelectorAll("[data-run-chat][data-run-live]")].at(-1);
            if (!card) return false;
            const shown = new Set(
              [...card.querySelectorAll("button")].map((button) => button.textContent),
            );
            return (
              names.every((name) => shown.has(name)) &&
              document
                .getAnimations()
                .every(
                  (animation) =>
                    animation.effect?.getTiming().iterations === Infinity ||
                    animation.playState !== "running",
                )
            );
          },
          { polling: "raf" },
          wanted,
        );

      /** Milo at work in a run: held in no application, or placed in `app`; a command run first. */
      interface LastLineFrame {
        /** The time of the frame it shows (the page's clock). */
        readonly at: number;
        /** The top of the very last line line wherever it is drawn, null when it is out of view. */
        readonly top: number | null;
        /** The live words' box height, null once it is gone. */
        readonly box: number | null;
      }
      const startLastLineTrace = (page: Page) =>
        page.evaluate(() => {
          const frames: LastLineFrame[] = [];
          const state = { active: true };
          const read = (): LastLineFrame => {
            const list = document.querySelector<HTMLElement>(".timeline-legend-list");
            const view = list?.getBoundingClientRect();
            let top: number | null = null;
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent?.includes("the very last line")) continue;
              const rect = walker.currentNode.parentElement!.getBoundingClientRect();
              if (rect.height === 0 || !view) continue;
              if (rect.bottom <= view.top || rect.top >= view.bottom) continue;
              top = rect.top;
            }
            const box = [
              ...document.querySelectorAll<HTMLElement>(
                '[data-run-chat][data-run-live] [data-chat-kind="note"] [data-capped]',
              ),
            ].at(-1);
            return {
              // The frame's time, not the read's: the read runs late on a loaded machine (43 ms
              // after its frame, seen at 4x CPU throttling), and a time-based glide shows where it
              // stands at its frame's time.
              at: document.timeline.currentTime as number,
              top,
              box: box ? box.getBoundingClientRect().height : null,
            };
          };
          // After the frame's paint: a rAF alone reads before the list's own frame work.
          const sample = () =>
            setTimeout(() => {
              frames.push(read());
              if (state.active) requestAnimationFrame(sample);
            }, 0);
          (window as unknown as { lastLineTrace: unknown }).lastLineTrace = { frames, state };
          requestAnimationFrame(sample);
        });
      const stopLastLineTrace = (page: Page) =>
        waitForStillFrames(page, { stillFrames: 24 }).then(() =>
          page.evaluate(() => {
            const held = (
              window as unknown as {
                lastLineTrace: { frames: LastLineFrame[]; state: { active: boolean } };
              }
            ).lastLineTrace;
            held.state.active = false;
            return held.frames;
          }),
        );

      const miloAtWork = (app?: string, command = true) =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          yield* s.given.project("Ada", app === undefined ? { mate: true } : { mate: true, app });
          const chat = mateChat(s);
          chat.fixture().exchange("How did the deploy go?", "It built and the storefront answers.");
          chat.fixture().exchange("And now?", "The existing conversation is still here");
          const wire = chat.fixture().wire;
          const engine = wire.engine;
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerMenu(s.page));
          yield* chat.when.open();
          yield* chat.when.send("Live stress test 4A: start two helpers");
          const run = [...engine.runs.values()].at(-1)!.id;
          if (command)
            engine.item(run, {
              kind: "call",
              step: "command",
              tool: { name: "Bash" },
              words: "Command run",
              state: "done",
              endedAt: yield* Clock.currentTimeMillis,
              input: "Bash: sleep 25 && echo helper-job-done",
            });
          return { s, engine, run };
        });

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect("a live card spends no line on controls", () =>
          Effect.gen(function* () {
            const { s, engine, run } = yield* miloAtWork();
            engine.note(run, "The Mate is reading the live work.");
            yield* mateChat(s).then.text("The Mate is reading the live work.");
            const controlsOnTheHead = (what: string) =>
              Effect.gen(function* () {
                const read = yield* Effect.promise(() =>
                  s.page.evaluate(() => {
                    const card = [
                      ...document.querySelectorAll<HTMLElement>("[data-run-chat][data-run-live]"),
                    ].at(-1)!;
                    const head = card.querySelector<HTMLElement>(":scope > [data-run-head]")!;
                    const line = head.getBoundingClientRect();
                    const controls = [...card.querySelectorAll<HTMLButtonElement>("button")]
                      .filter((button) => button.closest("[data-chat-row]") === null)
                      .map((button) => {
                        const rect = button.getBoundingClientRect();
                        return {
                          name: button.textContent ?? "",
                          top: rect.top,
                          bottom: rect.bottom,
                        };
                      });
                    return {
                      head: { top: line.top, bottom: line.bottom },
                      controls,
                      composerStop:
                        document.querySelector('button[aria-label="Stop background work"]') !==
                        null,
                    };
                  }),
                );
                expect(
                  read.controls.map((control) => control.name),
                  `ASSERTION: the card's controls are its head's toggle (${what})`,
                ).toEqual(["Hide work"]);
                for (const control of read.controls)
                  expect(
                    control.top >= read.head.top - 0.5 && control.bottom <= read.head.bottom + 0.5,
                    `ASSERTION: ${control.name} stands on the head's line (${what})`,
                  ).toBe(true);
                return read;
              });
            yield* Effect.promise(() => settledFoot(s.page, ["Hide work"]));
            yield* controlsOnTheHead("the Mate's words");
            yield* s.then.noExternalNetwork;
          }),
        );

        /** Milo's turn ends with its answer, with or without a helper still at work. */
        /** Its answer streamed into the slot first, or arriving whole with the run's end. */

        // Run engine-final (seg E +0:17.6): a turn that ended with a background job running drew
        // its answer in the card and under it for 1.1 s; then the card shrank and the page moved.

        // Recheck on 0.15.41 (+32:54.1): its short answer came with the end, the job ran on; the job's
        // strip left and snapped back 32 px, and the answer rose in twice.

        interface RestFrame {
          /** Empty card under the card's last drawn line, to its edge. */
          readonly band: number;
          /** One line of the card's head, an independent bound on empty room at its foot. */
          readonly headHeight: number;
          /** The conversation's last row's foot, a screen y. */
          readonly lastRow: number;
          readonly composerTop: number;
          /** How far the view stands from its end. */
          readonly fromEnd: number;
        }
        const readRest = (page: Page) =>
          page.evaluate((): RestFrame => {
            const card = [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1)!;
            const record = card.closest<HTMLElement>("[data-timeline-row-id]")!;
            const rows = [...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")];
            const from = rows.indexOf(record);
            const end = rows.findIndex(
              (row, index) => index > from && row.dataset.timelineRowId?.startsWith("card-end:"),
            );
            const slices = rows.slice(from, end === -1 ? from + 1 : end + 1);
            const edge = Math.max(...slices.map((row) => row.getBoundingClientRect().bottom));
            let drawn = -Infinity;
            for (const row of slices.slice(0, end === -1 ? undefined : -1)) {
              const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT);
              while (walker.nextNode()) {
                const element = walker.currentNode as HTMLElement;
                if (element.closest("[hidden], .sr-only, [aria-hidden='true']") !== null) continue;
                const box = element.getBoundingClientRect();
                const leaf =
                  element.children.length === 0 &&
                  ((element.textContent ?? "").trim() !== "" ||
                    ["IMG", "svg", "BUTTON"].includes(element.tagName));
                if (leaf && box.height > 0 && box.width > 0) {
                  drawn = Math.max(drawn, box.bottom);
                }
              }
            }
            const list = document.querySelector<HTMLElement>(".timeline-legend-list")!;
            // The room a closing panel lent the card's edge (`holdCardRoom`), drawn as card.
            const lent =
              Number.parseFloat(
                record
                  .querySelector<HTMLElement>(".run-tray")
                  ?.style.getPropertyValue("--card-room") ?? "",
              ) || 0;
            return {
              band: Math.max(edge, edge + lent) - drawn,
              headHeight: card.querySelector("[data-run-head]")!.getBoundingClientRect().height,
              lastRow: rows.at(-1)!.getBoundingClientRect().bottom,
              composerTop: document
                .querySelector("[data-chat-composer-overlay]")!
                .getBoundingClientRect().top,
              fromEnd: list.scrollHeight - list.clientHeight - list.scrollTop,
            };
          });
        /**
         * The owner, 0.15.44 (Milo, "a couple of times"): a settled card, folded or open, kept an
         * empty band at its foot that ran under the composer, and the view rested short of its end.
         * After the settle the card and the conversation's end read as a reload draws them.
         */
        const restsAtItsEnd = (ending: "stopped with its helpers" | "completed") =>
          Effect.gen(function* () {
            const { s, engine, run } = yield* miloAtWork();
            const chat = mateChat(s);
            const helpers = ["work-helper-a", "work-helper-b"].map((work, index) =>
              engine.item(run, {
                kind: "work",
                work,
                workKind: "helper",
                status: "running",
                title: `Helper ${index + 1}: 90-second tick loop`,
              }),
            );
            engine.item(run, {
              kind: "thought",
              preview: "Both helpers run their loops in the foreground; I wait for them.",
              length: 64,
              streaming: false,
            });
            yield* Effect.promise(() => waitForStillFrames(s.page));
            const words = "Both helpers reported their last tick, 90.";
            if (ending === "stopped with its helpers") {
              // As on Milo: the Stop ends the helpers first, the run a moment after.
              for (const helper of helpers) engine.update(helper, { status: "stopped" });
              yield* Effect.promise(() => waitForStillFrames(s.page));
              engine.end(run, { kind: "stopped", by: { kind: "person", subject: "owner" } });
            } else {
              for (const helper of helpers) engine.update(helper, { status: "completed" });
              engine.item(run, { kind: "note", text: words, streaming: false, answer: false });
              engine.end(run);
            }
            // The last note becomes the answer outside the card: its arrival alone is not that handoff.
            if (ending === "completed")
              yield* Effect.promise(async () => {
                const started = await s.page.waitForFunction(
                  (words) => {
                    const rows = [
                      ...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
                    ];
                    const end = rows.findLastIndex(
                      (row) => row.dataset.timelineRowKind === "card-end",
                    );
                    return (
                      end !== -1 &&
                      rows.findIndex(
                        (row) =>
                          row.dataset.timelineRowKind === "message" &&
                          row.textContent?.includes(words),
                      ) > end
                    );
                  },
                  { polling: "raf" },
                  words,
                );
                await started.dispose();
              });
            const settled = (open: boolean) =>
              Effect.gen(function* () {
                yield* Effect.promise(() => waitForStillFrames(s.page));
                const folded = yield* Effect.promise(() => readRest(s.page));
                yield* chat.when.activateLast(open ? "Show work" : "Hide work");
                yield* Effect.promise(() => waitForStillFrames(s.page));
                const other = yield* Effect.promise(() => readRest(s.page));
                return open ? { folded, open: other } : { folded: other, open: folded };
              });
            const live = yield* settled(true);
            yield* chat.when.reload("Ada", "Live stress test 4A");
            const drawn = yield* settled(true);
            const said = (rest: { folded: RestFrame; open: RestFrame }) =>
              (["folded", "open"] as const)
                .map((state) => `${state} ${quoted(rest[state])}`)
                .join(", ");
            const seen = `live: ${said(live)}; reloaded: ${said(drawn)}`;
            for (const [phase, rest] of Object.entries({ live, reloaded: drawn }))
              for (const state of ["folded", "open"] as const) {
                const frame = rest[state];
                expect(
                  frame.band,
                  `ASSERTION: ${phase} ${state} card holds its drawn content: ${seen}`,
                ).toBeGreaterThanOrEqual(-1);
                expect(
                  frame.band,
                  `ASSERTION: ${phase} ${state} card's empty foot fits within one head line: ${seen}`,
                ).toBeLessThanOrEqual(frame.headHeight);
                expect(
                  frame.lastRow,
                  `ASSERTION: ${phase} ${state} conversation ends above the composer: ${seen}`,
                ).toBeLessThanOrEqual(frame.composerTop);
                expect(
                  Math.abs(frame.fromEnd),
                  `ASSERTION: ${phase} ${state} view rests at its end: ${seen}`,
                ).toBeLessThanOrEqual(1);
              }
            for (const state of ["folded", "open"] as const)
              expect(
                Math.abs(live[state].band - drawn[state].band),
                `ASSERTION: the settled card hugs its content, ${state}: ${seen}`,
              ).toBeLessThanOrEqual(2);
            expect(
              Math.abs(live.folded.lastRow - drawn.folded.lastRow),
              `ASSERTION: the conversation rests at its end above the composer: ${seen}`,
            ).toBeLessThanOrEqual(2);
            expect(
              live.folded.fromEnd,
              `ASSERTION: the view stands at its end: ${seen}`,
            ).toBeLessThanOrEqual(1);
            yield* s.then.noExternalNetwork;
          });

        it.effect(
          "after a run settles, its card hugs its content and the conversation rests at its end above the composer",
          () =>
            Effect.gen(function* () {
              yield* restsAtItsEnd("stopped with its helpers");
            }),
        );
        it.effect(
          "after a run completes, its card hugs its content and the conversation rests at its end above the composer",
          () => restsAtItsEnd("completed"),
        );

        // Recheck on 0.15.45: opening a settled card at the conversation's end held the card where
        // it was clicked and pushed its answer under the composer.
        it.effect(
          "opening a settled card at the conversation's end keeps the end in sight, the card growing upward",
          () =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* miloAtWork();
              const chat = mateChat(s);
              for (let index = 0; index < 6; index += 1)
                engine.item(run, {
                  kind: "call",
                  step: "command",
                  tool: { name: "Bash" },
                  words: "Command run",
                  state: "done",
                  endedAt: yield* Clock.currentTimeMillis,
                  input: `Bash: echo step-${index}`,
                });
              yield* Effect.promise(() => waitForStillFrames(s.page));
              engine.note(
                run,
                "All six steps ran; the last one printed its marker, as you noted.",
                {
                  kind: "completed",
                },
              );
              yield* Effect.promise(() => waitForStillFrames(s.page));
              const read = () =>
                s.page.evaluate(() => {
                  const list = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                  let line: number | null = null;
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                  while (walker.nextNode()) {
                    const element = walker.currentNode.parentElement!;
                    if (!(walker.currentNode.textContent ?? "").includes("as you noted")) continue;
                    if (element.closest("[data-run-chat], .sr-only") !== null) continue;
                    line = element.getBoundingClientRect().bottom;
                  }
                  const card = [...document.querySelectorAll("[data-run-chat]")].at(-1)!;
                  const rows = [
                    ...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]"),
                  ];
                  const start = rows.indexOf(card.closest<HTMLElement>("[data-timeline-row-id]")!);
                  const end = rows.findIndex(
                    (row, index) => index > start && row.dataset.timelineRowKind === "card-end",
                  );
                  const slices = rows
                    .slice(start, end + 1)
                    .map((row) => row.getBoundingClientRect());
                  return {
                    line,
                    cardTop: Math.min(...slices.map((box) => box.top)),
                    cardBottom: Math.max(...slices.map((box) => box.bottom)),
                    fromEnd: list.scrollHeight - list.clientHeight - list.scrollTop,
                    foot: document.querySelector("form")?.getBoundingClientRect().top ?? null,
                  };
                });
              const before = yield* Effect.promise(read);
              yield* chat.when.activateLast("Show work");
              const frames: Array<Awaited<ReturnType<typeof read>>> = [];
              yield* Effect.promise(() =>
                waitForStillFrames(s.page, {
                  stillFrames: 30,
                  sample: async () => {
                    frames.push(await read());
                  },
                }),
              );
              const after = frames.at(-1)!;
              const seen = quoted({ before, after });
              expect(
                after.cardBottom - after.cardTop,
                `ASSERTION: opening the card increases its height: ${seen}`,
              ).toBeGreaterThan(before.cardBottom - before.cardTop);
              expect(
                after.cardTop,
                `ASSERTION: the opened card's head grows upward: ${seen}`,
              ).toBeLessThan(before.cardTop);
              expect(
                frames.every(
                  (frame) =>
                    frame.cardTop <= before.cardTop + 1 &&
                    frame.cardBottom <= before.cardBottom + 16,
                ),
                `ASSERTION: the card grows above its foot throughout opening: ${seen}`,
              ).toBe(true);
              expect(before.line, "ASSERTION: the answer stood in view before").not.toBeNull();
              expect(
                Math.max(
                  ...frames.map((frame) =>
                    frame.line === null ? Infinity : Math.abs(frame.line - before.line!),
                  ),
                ),
                `ASSERTION: the conversation's last line stays where it stood as the card opens: ${seen}`,
              ).toBeLessThanOrEqual(16);
              expect(
                frames.every(
                  (frame) => frame.line !== null && frame.foot !== null && frame.line <= frame.foot,
                ),
                `ASSERTION: the conversation's end never goes under the composer: ${seen}`,
              ).toBe(true);
              expect(
                after.fromEnd,
                `ASSERTION: the view stands at its end: ${seen}`,
              ).toBeLessThanOrEqual(1);
              yield* s.then.noExternalNetwork;
            }),
        );

        // Recheck on 0.15.41 (+40:10.7): the slot said Thinking, the short answer came with the
        // run's end, and the head travelled 120 px down as the card closed under it.

        it.effect("words arriving in a burst grow their box by a glide, never a leap", () =>
          Effect.gen(function* () {
            const { s, engine, run } = yield* miloAtWork();
            const note = engine.item(run, {
              kind: "note",
              text: "",
              streaming: true,
              answer: false,
            });
            engine.stream(note, "Line 1 of the table.\n\nLine 2 of the table.");
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () =>
                  [
                    ...document.querySelectorAll(
                      '[data-run-chat][data-run-live] [data-chat-kind="note"]',
                    ),
                  ]
                    .at(-1)
                    ?.textContent?.includes("Line 2 of"),
                { polling: "raf" },
              ),
            );
            yield* Effect.promise(() => waitForStillFrames(s.page));
            yield* Effect.promise(() => startLastLineTrace(s.page));
            engine.stream(
              note,
              Array.from({ length: 30 }, (_, index) => `\n\nLine ${index + 3} of the table.`).join(
                "",
              ),
            );
            const frames = yield* Effect.promise(() => stopLastLineTrace(s.page));
            const heights = frames.flatMap((frame) => (frame.box === null ? [] : [frame.box]));
            // The glide runs on time, so what it grows between two drawn frames is paced per 60 Hz
            // frame of the time between them: its first step is ~61-64 px. A frame the machine
            // drops shows two of its steps at once (57 -> 172 px across a 33 ms frame at 4x CPU
            // throttling, read 12 ms after the frame before it). Run 5's leap was 372 px in a frame.
            const drawn = frames.filter((frame) => frame.box !== null);
            const steps = drawn.slice(1).map((frame, index) => {
              const before = drawn[index]!;
              return (frame.box! - before.box!) / Math.max(1, (frame.at - before.at) / (1000 / 60));
            });
            expect(heights.at(-1)! - heights[0]!, "ASSERTION: the box grew").toBeGreaterThan(200);
            expect(
              Math.max(...steps),
              "ASSERTION: no frame grows the box by more than a glide's step",
            ).toBeLessThan(80);
            // However long its frames run, a glide is seen on its way: a leap shows no height
            // between where the box stood and where it ends.
            expect(
              heights.filter((height) => height > heights[0]! + 1 && height < heights.at(-1)! - 1)
                .length,
              "ASSERTION: the box is seen on its way, frame by frame",
            ).toBeGreaterThanOrEqual(2);
            yield* s.then.noExternalNetwork;
          }),
        );
        it.effect(
          "a long answer being written grows to the item height and is readable while it is written",
          () =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* miloAtWork();
              const note = engine.item(run, {
                kind: "note",
                text: "",
                streaming: true,
                answer: false,
              });
              const lines = Array.from(
                { length: 32 },
                (_, index) => `Line ${index + 1} of the table of every helper and job.`,
              );
              engine.stream(note, lines.join("\n\n"));
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () => {
                    const card = [
                      ...document.querySelectorAll("[data-run-chat][data-run-live]"),
                    ].at(-1);
                    return card
                      ?.querySelector('[data-chat-kind="note"]')
                      ?.textContent?.includes("Line 32");
                  },
                  { polling: "raf" },
                ),
              );
              yield* Effect.promise(() => settledFoot(s.page, ["Hide work"]));
              const read = yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const card = [...document.querySelectorAll("[data-run-chat][data-run-live]")].at(
                    -1,
                  )!;
                  const bubble = card.querySelector<HTMLElement>('[data-chat-kind="note"]')!;
                  const item = bubble.querySelector<HTMLElement>("[data-capped]")!;
                  const box = item.getBoundingClientRect();
                  const contentHeight = item.firstElementChild!.getBoundingClientRect().height;
                  const itemHeight = Number.parseFloat(getComputedStyle(item).maxHeight);
                  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
                  let last: { top: number; bottom: number } | null = null;
                  while (walker.nextNode()) {
                    if (!walker.currentNode.textContent?.includes("Line 32")) continue;
                    const rect = walker.currentNode.parentElement!.getBoundingClientRect();
                    last = { top: rect.top, bottom: rect.bottom };
                  }
                  return {
                    top: box.top,
                    bottom: box.bottom,
                    height: box.height,
                    contentHeight,
                    itemHeight,
                    last,
                  };
                }),
              );
              expect(
                read.height,
                "ASSERTION: the words grow past four lines toward the run scroll's height",
              ).toBeGreaterThan(300);
              expect(
                read.contentHeight,
                `ASSERTION: the streamed words fill more than the item's allowed height: ${quoted(read)}`,
              ).toBeGreaterThan(read.itemHeight);
              expect(
                Math.abs(read.height - read.itemHeight),
                `ASSERTION: the words' box grows to the full item height while being written: ${quoted(read)}`,
              ).toBeLessThanOrEqual(1);
              expect(
                read.last !== null &&
                  read.last.bottom <= read.bottom + 1 &&
                  read.last.top >= read.top - 1,
                "ASSERTION: the newest words stand in view at the box's foot while written",
              ).toBe(true);
              const foot = (yield* Effect.promise(() => readFoot(s.page)))!;
              for (const control of foot.controls)
                expect(
                  foot.words.every(
                    (words) =>
                      control.bottom <= words.top + 0.5 || control.top >= words.bottom - 0.5,
                  ),
                  `ASSERTION: ${control.name} stands clear of the words being written`,
                ).toBe(true);
              yield* s.then.noExternalNetwork;
            }),
        );

        // Run 5 (C +0:15.29): at its last words the live box showed lines 11-25 at its foot; the
        // answer then landed from its first line and the page glided 1033 px in 431 ms.
        /** The landing, with Milo held in no application or placed in one (its review band). */

        // Recheck on 0.15.44 (+settle of the story): a long answer's card went above it in one
        // frame (−1,138 px), its head out of the view at once; in the harness 849 px with no work
        // done, 869 px with a command run.
        it.effect.each([
          { case: "no work done", command: false },
          { case: "a command run", command: true },
        ])(
          "a long answer unrolls upward where its card stood, what stood above travelling, never a cut: $case",
          ({ command }) =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* miloAtWork(undefined, command);
              const note = engine.item(run, {
                kind: "note",
                text: "",
                streaming: true,
                answer: false,
              });
              const text = Array.from({ length: 40 }, (_, index) =>
                index === 39
                  ? "Line 40, the very last line."
                  : `Line ${index + 1} of the story of the night the river froze.`,
              ).join("\n\n");
              engine.stream(note, text);
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    [
                      ...document.querySelectorAll(
                        '[data-run-chat][data-run-live] [data-chat-kind="note"]',
                      ),
                    ]
                      .at(-1)
                      ?.textContent?.includes("the very last line"),
                  { polling: "raf" },
                ),
              );
              yield* Effect.promise(() => waitForStillFrames(s.page));
              yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const frames: Array<{ at: number; asked: number | null; last: number | null }> =
                    [];
                  const state = { active: true };
                  const topOf = (words: string) => {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    let top: number | null = null;
                    while (walker.nextNode()) {
                      if (!walker.currentNode.textContent?.includes(words)) continue;
                      const rect = walker.currentNode.parentElement!.getBoundingClientRect();
                      if (rect.height > 0) top = rect.top;
                    }
                    return top;
                  };
                  // After the frame's paint: a rAF alone reads before the list's own frame work.
                  const sample = () =>
                    setTimeout(() => {
                      frames.push({
                        // The frame's time, as in the last line's trace.
                        at: document.timeline.currentTime as number,
                        asked: topOf("Live stress test 4A"),
                        last: topOf("the very last line"),
                      });
                      if (state.active) requestAnimationFrame(sample);
                    }, 0);
                  (window as unknown as { unrollTrace: unknown }).unrollTrace = { frames, state };
                  requestAnimationFrame(sample);
                }),
              );
              yield* Effect.promise(() => waitForStillFrames(s.page));
              engine.settle(note);
              yield* Effect.promise(() => waitForStillFrames(s.page));
              engine.update(note, { text, streaming: false });
              yield* Effect.promise(() => waitForStillFrames(s.page));
              engine.end(run);
              const frames = yield* Effect.promise(() =>
                waitForStillFrames(s.page, { stillFrames: 24 }).then(() =>
                  s.page.evaluate(() => {
                    const held = (
                      window as unknown as {
                        unrollTrace: {
                          frames: Array<{ at: number; asked: number | null; last: number | null }>;
                          state: { active: boolean };
                        };
                      }
                    ).unrollTrace;
                    held.state.active = false;
                    return held.frames;
                  }),
                ),
              );
              const first = frames[0]!;
              expect(
                first.asked,
                "ASSERTION: the person's message stood in the page",
              ).not.toBeNull();
              const moved = frames.findIndex(
                (frame) => Math.abs(frame.asked! - first.asked!) > 0.5,
              );
              expect(
                moved,
                "ASSERTION: what stood above went up as the answer landed",
              ).toBeGreaterThan(0);
              expect(
                Math.abs(frames[moved]!.asked! - first.asked!),
                "ASSERTION: in the frame the answer lands, what stood above stands where it stood",
              ).toBeLessThan(16);
              // Its pace per 60 Hz frame: a slow runner paints half as often.
              const pace = Math.max(
                ...frames.slice(1).map((frame, index) => {
                  const before = frames[index]!;
                  return (
                    Math.abs(frame.asked! - before.asked!) /
                    Math.max(1, (frame.at - before.at) / (1000 / 60))
                  );
                }),
              );
              expect(pace, "ASSERTION: what stood above travels up, never a cut").toBeLessThan(200);
              expect(
                first.asked! - frames.at(-1)!.asked!,
                "ASSERTION: the whole answer stands above its last line once unrolled",
              ).toBeGreaterThan(600);
              expect(
                frames.every(
                  (frame) => frame.last !== null && Math.abs(frame.last - first.last!) <= 4,
                ),
                "ASSERTION: the answer's last line stands where it was read throughout",
              ).toBe(true);
              yield* s.then.noExternalNetwork;
            }),
        );

        // Run 5 (C +0:09.6): a big chunk of words grew the live box 125 -> 497 px in one frame.
      });
    });
  });
});
