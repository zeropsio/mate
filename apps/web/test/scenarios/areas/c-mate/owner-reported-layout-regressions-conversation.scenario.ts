// @effect-diagnostics nodeBuiltinImport:off -- a picture file in the isolated Mate workspace.
import { scenarioSuite } from "../../harness/suite.ts";
import liveSlotSteps from "./live-slot-order.fixture.json";
import { composerLayout } from "./composerLayout.ts";
import type { Page } from "puppeteer-core";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";
import { journey, sampled } from "./pageJourney.ts";
import { ownerMenu, quoted } from "./ownerReportedLayout.ts";

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    it.effect(
      "thoughts handing off to history keep source order and separate space from the next tool",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          chat
            .fixture()
            .exchange("Previous navigation", "The existing conversation is still here.");
          const engine = chat.fixture().wire.engine;
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerMenu(s.page));
          yield* chat.when.open();
          yield* chat.when.send(
            "OCT14-B: six separate read-only navigation calls with short commentary",
          );
          const run = [...engine.runs.values()].at(-1)!.id;
          // The real GG OCT14-B thought/call records, in received server order.

          const trace = yield* Effect.promise(() =>
            s.page.evaluateHandle(() => {
              const state = {
                active: true,
                frames: [] as Array<Array<{ key: string; top: number; bottom: number }>>,
              };
              const sample = () =>
                setTimeout(() => {
                  const rows = [
                    ...document.querySelectorAll<HTMLElement>(
                      "[data-run-chat][data-run-live] [data-chat-kind]",
                    ),
                  ]
                    .filter((row) =>
                      row.matches('[data-chat-kind="thought"], [data-chat-kind="step:command"]'),
                    )
                    .map((row) => {
                      const box = row.getBoundingClientRect();
                      let top = box.top;
                      let bottom = box.bottom;
                      for (
                        let parent = row.parentElement;
                        parent !== null;
                        parent = parent.parentElement
                      ) {
                        const style = getComputedStyle(parent);
                        if (
                          ["auto", "scroll", "hidden", "clip"].includes(style.overflowY) ||
                          style.clipPath !== "none"
                        ) {
                          const clip = parent.getBoundingClientRect();
                          top = Math.max(top, clip.top);
                          bottom = Math.min(bottom, clip.bottom);
                        }
                      }
                      return {
                        key: row.closest<HTMLElement>("[data-run-key]")?.dataset.runKey ?? "",
                        top,
                        bottom,
                      };
                    })
                    .filter((row) => row.bottom > row.top);
                  state.frames.push(rows);
                  if (state.active) requestAnimationFrame(sample);
                }, 0);
              requestAnimationFrame(sample);
              return state;
            }),
          );
          const order: string[] = [];
          for (const step of liveSlotSteps) {
            const thought = engine.item(run, {
              kind: "thought",
              preview: step.streaming ? "" : step.thought,
              length: step.streaming ? 0 : step.thought.length,
              streaming: step.streaming,
            });
            if (step.streaming) {
              engine.stream(thought, step.thought, "reasoning");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (text) => document.body.innerText.includes(text),
                  { polling: "raf" },
                  step.thought.split("\n")[0]!,
                ),
              );
              engine.update(thought, {
                preview: step.thought,
                length: step.thought.length,
                streaming: false,
              });
              engine.settle(thought);
            }
            const call = engine.item(run, { ...step.call, state: "running" });
            order.push(thought, call);
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                (id) =>
                  [...document.querySelectorAll("[data-run-key]")].some((row) =>
                    row.getAttribute("data-run-key")?.includes(id),
                  ),
                { polling: "raf" },
                call,
              ),
            );
            engine.update(call, { state: "done", endedAt: yield* Clock.currentTimeMillis });
            yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 24 }));
          }
          const frames = yield* Effect.promise(() =>
            trace.evaluate((state) => {
              state.active = false;
              return state.frames;
            }),
          );
          yield* Effect.promise(() => trace.dispose());
          const pairs = frames.flatMap((frame) => {
            const rows = order
              .map((id) => frame.find((row) => row.key.includes(id)))
              .filter((row) => row !== undefined);
            return rows.slice(1).map((row, i) => ({
              before: rows[i]!.key,
              after: row.key,
              gap: row.top - rows[i]!.bottom,
            }));
          });
          expect(pairs.length).toBeGreaterThan(0);
          expect(
            Math.min(...pairs.map((pair) => pair.gap)),
            `ASSERTION: every painted thought/tool pair stays in source order with non-overlapping geometry: ${quoted(pairs.toSorted((a, b) => a.gap - b.gap).slice(0, 3))}`,
          ).toBeGreaterThanOrEqual(0);
        }),
    );
  });

  describe("Decision: geometry relations only; no style pins.", () => {
    describe("Decision: a conversation opens in place; nothing it does overflows its column.", () => {
      scenarioSuite((it) => {
        // The owner (2026-10-12): "after mate is fully loaded (nad scrollbar is introduced I
        // think) there is layout / width shift that looks shit". The arrival's rise overflowed
        // the column for its frames: a scrollbar came and went, narrowing the column by its width.
        it.effect(
          "a conversation's opening never overflows its column, so no scrollbar narrows it",
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Sage", { mate: true });
              const chat = mateChat(s);
              const wire = chat.fixture("Sage");
              for (let index = 0; index < 12; index++)
                wire.exchange(
                  `Question ${index}`,
                  "An answer long enough to fill the column.\n\n".repeat(6),
                );
              const read = wire.engine.holdOpen();
              yield* Effect.addFinalizer(() => Effect.sync(() => read.release()));
              yield* s.given.signedIn;
              yield* chat.when.openReadOnly("Sage");
              yield* Effect.promise(() => read.requested());
              yield* Effect.promise(() =>
                s.page.waitForSelector('[data-conversation-opening="waiting"]'),
              );
              yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const samples: Array<{ phase: string | undefined; overflow: number }> = [];
                  Reflect.set(window, "openingOverflow", samples);
                  const tick = () => {
                    const column = document.querySelector<HTMLElement>(
                      "[data-chat-column-maximized-away]",
                    );
                    const phase =
                      document
                        .querySelector("[data-conversation-opening]")
                        ?.getAttribute("data-conversation-opening") ?? undefined;
                    if (column !== null)
                      samples.push({ phase, overflow: column.scrollHeight - column.clientHeight });
                    if (phase !== "complete") requestAnimationFrame(tick);
                  };
                  requestAnimationFrame(tick);
                }),
              );
              read.release();
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    (Reflect.get(window, "openingOverflow") as Array<{ phase?: string }>).at(-1)
                      ?.phase === "complete",
                ),
              );
              const samples = yield* Effect.promise(() =>
                s.page.evaluate(
                  () =>
                    Reflect.get(window, "openingOverflow") as Array<{
                      phase: string | undefined;
                      overflow: number;
                    }>,
                ),
              );
              const overflowing = samples.filter((sample) => sample.overflow > 0);
              expect(
                samples.some((sample) => sample.phase === "hand-off"),
                `ASSERTION: the opening handed over in sight: ${quoted(samples.slice(0, 8))}`,
              ).toBe(true);
              expect(
                overflowing,
                `ASSERTION: nothing in the opening overflows the column: ${quoted(overflowing.slice(0, 6))}`,
              ).toEqual([]);
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    describe("Decision: the end is where the list stops; a step short of it is the person's.", () => {
      scenarioSuite((it) => {
        // The owner (2026-10-12): "at this scroll (like 100px from bottom), a single tiny scroll to
        // bottom causes it to jump to bottom".
        it.effect(
          "a small step down short of the end moves the list by that step, never to its end",
          () =>
            Effect.gen(function* () {
              const { s } = yield* composerLayout("plain");
              yield* Effect.promise(() => ownerMenu(s.page));
              const short = () =>
                s.page.evaluate(() => {
                  const list = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                  return list.scrollHeight - list.clientHeight - list.scrollTop;
                });
              const settle = () => waitForStillFrames(s.page);
              const list = (yield* Effect.promise(() => s.page.$(".timeline-legend-list")))!;
              const box = (yield* Effect.promise(() => list.boundingBox()))!;
              yield* Effect.promise(async () => {
                await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
                await s.page.mouse.wheel({ deltaY: -120 });
                await settle();
              });
              const before = yield* Effect.promise(short);
              yield* Effect.promise(async () => {
                await s.page.mouse.wheel({ deltaY: 10 });
                await settle();
              });
              const after = yield* Effect.promise(short);
              const seen = quoted({ before, after });
              expect(before, `ASSERTION: the step up left the end: ${seen}`).toBeGreaterThan(60);
              expect(
                after,
                `ASSERTION: the step down moved the list by itself, short of the end: ${seen}`,
              ).toBeGreaterThan(before - 30);
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    // Run 9 (Milo, step 5): reloaded, a conversation ending in a recorded 369 px page landed
    // 320 px short of its end and glided there: the page's row was first measured in its 240 px
    // first box, before its width was read.
    describe("Decision: product fix; the 2 px bound stays.", () => {
      scenarioSuite((it) => {
        // Found moving the chat journeys onto a real Mate: the list's own scroll up was glided
        // back on the follow curve, as an arriving row is, and real history's 1,471 px still
        // stood 5 px off the end a second later.
        it.effect("a long real conversation never shows the list's own scroll off its end", () =>
          Effect.gen(function* () {
            const s = yield* createScenario([], { mate: "real" });
            yield* s.given.project("Ada", { mate: true });
            const ada = s.drivers.realMates.get("Ada")!;
            yield* s.given.signedIn;
            yield* s.when.menu.opensMate("Ada");
            yield* s.then.conversation.appears;
            const answer =
              "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                30,
              );
            for (const [question, reply] of [
              ["How did deploy 1 go?", answer],
              ["How did deploy 2 go?", answer],
              ["How did deploy 3 go?", answer],
              ["And now?", "The existing conversation is still here"],
            ] as const) {
              yield* ada.provider.turn([{ kind: "say", text: reply }]);
              yield* s.when.conversation.sends(question);
              expect((yield* ada.provider.received).input.input).toBe(question);
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () => !document.querySelector('button[aria-label="Stop generation"]'),
                  { polling: 100 },
                ),
              );
            }
            yield* Effect.promise(() => s.page.reload());
            yield* s.then.conversation.showsMessage("The existing conversation is still here");
            const fromEnd = () =>
              Effect.promise(() =>
                s.page.evaluate(async () => {
                  const readings: number[] = [];
                  for (let frame = 0; frame < 60; frame += 1) {
                    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                    const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                    readings.push(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
                  }
                  return readings;
                }),
              );
            const opened = yield* fromEnd();
            expect(
              opened.at(-1),
              `ASSERTION: the conversation opened at its end: ${opened.join(" ")}`,
            ).toBeLessThanOrEqual(2);
            // LegendList's initial scroll re-applied while its rows measure: the list's own move.
            const left = yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                scroll.scrollTo({ top: Math.round(scroll.scrollHeight * 0.45) });
                return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
              }),
            );
            const after = yield* fromEnd();
            expect(left, "ASSERTION: the list's own scroll went far up").toBeGreaterThan(1000);
            expect(
              Math.max(...after),
              `ASSERTION: the list's own scroll showed off the end: ${after.join(" ")}`,
            ).toBeLessThanOrEqual(2);
            yield* s.then.noExternalNetwork;
          }),
        );
      });
    });

    describe("Decision: product fix at the boundary; no witness weakening.", () => {
      scenarioSuite((it) => {
        it.effect("a draft becoming its conversation never hides the chat area", () =>
          Effect.gen(function* () {
            const s = yield* createScenario([], { mate: "real" });
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* s.given.project("Ada", { mate: true });
            yield* s.given.signedIn;
            yield* Effect.promise(() => ownerMenu(s.page));
            yield* s.when.menu.opensMate("Ada");
            yield* s.then.conversation.appears;
            expect(new URL(s.page.url()).pathname).toContain("/draft/");
            yield* Effect.promise(() => waitForStillFrames(s.page));
            const trace = yield* Effect.promise(() =>
              s.page.evaluateHandle(() => {
                const state = {
                  active: true,
                  frames: [] as Array<{
                    path: string;
                    width: number;
                    height: number;
                    hidden: boolean;
                  }>,
                };
                const tick = () => {
                  if (!state.active) return;
                  const areas = [...document.querySelectorAll('main[data-slot="sidebar-inset"]')];
                  const chat = areas.find((area) =>
                    area.querySelector('[data-slot="composer-shell"]'),
                  );
                  const rect = chat?.getBoundingClientRect();
                  state.frames.push({
                    path: location.pathname,
                    width: rect?.width ?? 0,
                    height: rect?.height ?? 0,
                    hidden: chat === undefined || getComputedStyle(chat).visibility === "hidden",
                  });
                  requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
                return state;
              }),
            );
            yield* s.drivers.realMates
              .get("Ada")!
              .provider.turn([{ kind: "say", text: "The conversation is here." }]);
            yield* s.when.conversation.sends("Keep the chat in sight");
            yield* s.then.conversation.showsMessage("The conversation is here.");
            yield* Effect.promise(() =>
              s.page.waitForFunction(() => !location.pathname.includes("/draft/"), {
                polling: "raf",
              }),
            );
            yield* Effect.promise(() => waitForStillFrames(s.page));
            const frames = yield* Effect.promise(async () => {
              const frames = await trace.evaluate((state) => {
                state.active = false;
                return state.frames;
              });
              await trace.dispose();
              return frames;
            });
            expect(frames.some((frame) => frame.path.includes("/draft/"))).toBe(true);
            expect(frames.some((frame) => !frame.path.includes("/draft/"))).toBe(true);
            expect(
              frames.filter((frame) => frame.hidden || frame.width <= 0 || frame.height <= 0),
              "ASSERTION: every frame keeps the chat area visible through draft promotion",
            ).toEqual([]);
            yield* s.then.noExternalNetwork;
          }),
        );
      });
    });

    describe("Decision: a reload paints nothing it takes back.", () => {
      scenarioSuite((it) => {
        it.effect(
          "a conversation ending in a full-height page, reloaded, is at its end from its first visible frame",
          () =>
            Effect.gen(function* () {
              const { s, measured, publish, reload } = yield* journey(369, { earlierPage: true });
              yield* sampled(
                s,
                Effect.sync(() => publish()),
              );
              // An earlier page may stay outside the viewport; only this page must be recorded.
              yield* measured;
              // Every frame from the reload: how far the view stands from its end, and whether its
              // rows are placed yet.
              yield* Effect.promise(() =>
                s.page.evaluateOnNewDocument(() => {
                  const frames: Array<{ shown: boolean; fromEnd: number }> = [];
                  (window as unknown as { reloadEnd: typeof frames }).reloadEnd = frames;
                  const tick = () => {
                    const list = document.querySelector<HTMLElement>(".timeline-legend-list");
                    if (list !== null) {
                      frames.push({
                        // Placed, the list is what shows: the opening stage over it may still be
                        // fading out, and on Milo it was seen gliding there (run 9).
                        shown: document.querySelector("[data-timeline-placing]") === null,
                        fromEnd: list.scrollHeight - list.clientHeight - list.scrollTop,
                      });
                    }
                    requestAnimationFrame(tick);
                  };
                  requestAnimationFrame(tick);
                }),
              );
              yield* reload;
              yield* Effect.promise(() => waitForStillFrames(s.page));
              const frames = yield* Effect.promise(() =>
                s.page.evaluate(
                  () =>
                    (window as unknown as { reloadEnd: Array<{ shown: boolean; fromEnd: number }> })
                      .reloadEnd,
                ),
              );
              const shown = frames.slice(frames.findIndex((frame) => frame.shown));
              expect(shown.length, "ASSERTION: the reloaded conversation was seen").toBeGreaterThan(
                20,
              );
              expect(
                Math.max(...shown.map((frame) => frame.fromEnd)),
                "ASSERTION: the view stands at its end in every frame it shows, nothing glides",
              ).toBeLessThanOrEqual(1);
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    describe("Decision: follow-bottom only at bottom; reader's scroll always wins; no animated jump while scrolled up.", () => {
      const OUTER = ".timeline-legend-list";
      const INNER = "[data-run-chat][data-run-live] [data-run-scroll]";
      interface ScrollFrame {
        readonly outerTop: number;
        readonly outerEnd: number;
        readonly innerTop: number | null;
        readonly innerFollows: boolean;
        /** Where the line the reader looked at in the conversation stands on screen. */
        readonly read: number | null;
        /** Every line in the Working card's scroll, by its top from the card's view. */
        readonly innerLines: Readonly<Record<string, number>>;
      }
      /** Each painted frame: both scrolls, and the lines under the reader in each. */
      const startScrollTrace = (page: Page) =>
        page.evaluate(
          (outerSelector: string, innerSelector: string) => {
            const outer = document.querySelector<HTMLElement>(outerSelector)!;
            const view = outer.getBoundingClientRect();
            const read = [...outer.querySelectorAll<HTMLElement>("[data-timeline-root]")].find(
              (row) => {
                const box = row.getBoundingClientRect();
                return box.height > 0 && box.top >= view.top && box.top < view.bottom - 200;
              },
            );
            const linesIn = (card: HTMLElement | undefined) => {
              if (card === undefined) return {};
              const shown = card.getBoundingClientRect();
              const lines: Record<string, number> = {};
              for (const line of card.querySelectorAll<HTMLElement>("[data-run-key]")) {
                const box = line.getBoundingClientRect();
                if (box.height > 0) lines[line.dataset.runKey!] = box.top - shown.top;
              }
              return lines;
            };
            const frames: ScrollFrame[] = [];
            const state = { active: true, frames };
            const sample = () =>
              setTimeout(() => {
                const card = [...document.querySelectorAll<HTMLElement>(innerSelector)].at(-1);
                frames.push({
                  outerTop: outer.scrollTop,
                  outerEnd: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
                  innerTop: card ? card.scrollTop : null,
                  innerFollows: card?.hasAttribute("data-follows") ?? false,
                  read: read?.isConnected ? read.getBoundingClientRect().top : null,
                  innerLines: linesIn(card),
                });
                if (state.active) requestAnimationFrame(sample);
              }, 0);
            (window as unknown as { scrollTrace: typeof state }).scrollTrace = state;
            requestAnimationFrame(sample);
          },
          OUTER,
          INNER,
        );
      /** Where the conversation's end stands in each frame, and whether the frame shows it. */
      const startOpenTrace = (page: Page) =>
        page.evaluate((outerSelector: string) => {
          const frames: { readonly shown: boolean; readonly end: number }[] = [];
          const state = { active: true, frames };
          const sample = () =>
            setTimeout(() => {
              const outer = document.querySelector<HTMLElement>(outerSelector);
              frames.push({
                shown: outer !== null && outer.closest("[data-timeline-placing]") === null,
                end: outer === null ? 0 : outer.scrollHeight - outer.clientHeight - outer.scrollTop,
              });
              if (state.active) requestAnimationFrame(sample);
            }, 0);
          (window as unknown as { openTrace: typeof state }).openTrace = state;
          requestAnimationFrame(sample);
        }, OUTER);
      const stopOpenTrace = (page: Page) =>
        page.evaluate(() => {
          const state = (
            window as unknown as {
              openTrace: { active: boolean; frames: { shown: boolean; end: number }[] };
            }
          ).openTrace;
          state.active = false;
          return state.frames;
        });
      const stopScrollTrace = (page: Page) =>
        page.evaluate(() => {
          const state = (
            window as unknown as { scrollTrace: { active: boolean; frames: ScrollFrame[] } }
          ).scrollTrace;
          state.active = false;
          return state.frames;
        });
      /** How far a reading strayed from the first frame's, over every frame it was read in. */
      const strayed = (values: ReadonlyArray<number | null>) => {
        const read = values.filter((value): value is number => value !== null);
        return read.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.max(...read.map((value) => Math.abs(value - read[0]!)));
      };
      /** A trackpad's flick: many small wheel turns on a momentum curve, as one gesture. */
      const flick = (page: Page, selector: string, direction: 1 | -1) =>
        Effect.promise(async () => {
          const element = (await page.$$(selector)).at(-1)!;
          const box = (await element.boundingBox())!;
          const x = box.x + box.width / 2;
          const y = box.y + box.height / 2;
          await page.mouse.move(x, y);
          const cdp = await page.createCDPSession();
          for (const delta of [
            2, 4, 8, 12, 16, 20, 20, 18, 16, 14, 12, 10, 8, 6, 5, 4, 3, 2, 2, 1, 1, 1,
          ]) {
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseWheel",
              x,
              y,
              deltaX: 0,
              deltaY: direction * delta * 3,
            });
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
          await cdp.detach();
        });
      /** Milo at work in a long conversation: thirty steps done, the Working card scrolling. */
      const longWork = Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        for (let round = 0; round < 6; round++)
          chat
            .fixture()
            .exchange(`How did deploy ${round} go?`, "The logs are clean.\n\n".repeat(12));
        chat.fixture().exchange("And now?", "The existing conversation is still here");
        const engine = chat.fixture().wire.engine;
        yield* s.given.signedIn;
        yield* Effect.promise(() => ownerMenu(s.page));
        yield* chat.when.open();
        yield* chat.when.send("Run the long piece of work");
        const run = [...engine.runs.values()].at(-1)!.id;
        for (let step = 0; step < 30; step++)
          engine.item(run, {
            kind: "call",
            step: "command",
            tool: { name: "Bash" },
            words: `Command ${step}`,
            state: "done",
            endedAt: yield* Clock.currentTimeMillis,
            input: `Bash: echo step-${step}`,
          });
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (selector: string) => {
              const inner = document.querySelector<HTMLElement>(selector);
              return inner !== null && inner.scrollHeight > inner.clientHeight + 200;
            },
            { polling: "raf" },
            INNER,
          ),
        );
        yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 12 }));
        /** Steps keep arriving: a note that lands from the slot, then a command, a dozen times. */
        const steps = Effect.gen(function* () {
          for (let step = 30; step < 42; step++) {
            engine.item(run, {
              kind: "note",
              by: { kind: "mate" },
              text: `Step ${step} is under way, and the build log reads clean so far.`,
              streaming: false,
              answer: false,
            });
            yield* Effect.sleep("200 millis");
            const call = engine.item(run, {
              kind: "call",
              ...(step % 2 === 0
                ? { step: "mcp", tool: { name: "zerops_browser", server: "zerops" } }
                : { step: "command", tool: { name: "Bash" } }),
              words: `Command ${step}`,
              state: "running",
              endedAt: null,
              input: `Bash: echo step-${step}`,
            });
            yield* Effect.sleep("200 millis");
            engine.update(call, { state: "done", endedAt: yield* Clock.currentTimeMillis });
            yield* Effect.sleep("200 millis");
          }
          yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 20 }));
        });
        return { s, steps, engine, run };
      });
      interface CloseFrame {
        /** The card's top: what stands above it goes with it. */
        readonly card: number | null;
        /** The answer's last line's foot: where the reader reads it. */
        readonly answer: number | null;
        readonly composer: number;
        readonly fromEnd: number;
      }
      /** Each painted frame as a turn ends: the card's top and its answer's last line. */
      const startCloseTrace = (page: Page, lastWords: string) =>
        page.evaluate(
          (outerSelector: string, words: string) => {
            const outer = document.querySelector<HTMLElement>(outerSelector)!;
            const footOf = () => {
              const walker = document.createTreeWalker(outer, NodeFilter.SHOW_TEXT);
              let foot: number | null = null;
              while (walker.nextNode()) {
                if (!walker.currentNode.textContent?.includes(words)) continue;
                const box = walker.currentNode.parentElement!.getBoundingClientRect();
                if (box.height > 0) foot = box.bottom;
              }
              return foot;
            };
            const frames: CloseFrame[] = [];
            const state = { active: true, frames };
            // Rows the list put in after a frame painted are not painted yet, nor what the next
            // frame does with them before it paints (the answer's words read 7 px off their place):
            // that reading waits for the next frame. A marker sized each frame says when the frame
            // has laid out, after its callbacks, before it paints.
            const at = { painted: 0, inserted: 0 };
            new MutationObserver(() => {
              at.inserted = performance.now();
            }).observe(outer, { childList: true, subtree: true });
            const marker = document.createElement("div");
            marker.style.cssText =
              "position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none";
            document.body.append(marker);
            new ResizeObserver(() => {
              at.painted = performance.now();
            }).observe(marker);
            const sample = () => {
              marker.style.height = marker.style.height === "1px" ? "2px" : "1px";
              setTimeout(() => {
                const card = [...outer.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1);
                if (at.inserted <= at.painted)
                  frames.push({
                    card: card?.getBoundingClientRect().top ?? null,
                    answer: footOf(),
                    composer: document
                      .querySelector("[data-chat-composer-overlay]")!
                      .getBoundingClientRect().top,
                    fromEnd: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
                  });
                if (state.active) requestAnimationFrame(sample);
              }, 0);
            };
            (window as unknown as { closeTrace: typeof state }).closeTrace = state;
            requestAnimationFrame(sample);
          },
          OUTER,
          lastWords,
        );
      const stopCloseTrace = (page: Page) =>
        page.evaluate(() => {
          const state = (
            window as unknown as { closeTrace: { active: boolean; frames: CloseFrame[] } }
          ).closeTrace;
          state.active = false;
          return state.frames;
        });
      /** The way a reading travelled against its main direction, over the frames it was read in. */
      const backTravel = (values: ReadonlyArray<number | null>) => {
        let up = 0;
        let down = 0;
        let last: number | null = null;
        for (const value of values) {
          if (value === null) continue;
          if (last !== null) {
            if (value > last) down += value - last;
            else up += last - value;
          }
          last = value;
        }
        return Math.min(up, down);
      };
      /** Per frame, whether the card or the answer's last line moved since the frame before. */
      const movedFrames = (frames: ReadonlyArray<CloseFrame>) =>
        frames.map((frame, index) => {
          const before = frames[index - 1];
          if (before === undefined) return false;
          const travel = (now: number | null, then: number | null) =>
            now === null || then === null ? 0 : Math.abs(now - then);
          return travel(frame.card, before.card) > 0.5 || travel(frame.answer, before.answer) > 0.5;
        });
      /** The most frames in a row nothing moved, between the first frame that moved and the last. */
      const longestPause = (frames: ReadonlyArray<CloseFrame>) => {
        const moved = movedFrames(frames);
        const first = moved.indexOf(true);
        const last = moved.lastIndexOf(true);
        let longest = 0;
        let run = 0;
        for (let index = first; first !== -1 && index <= last; index++) {
          run = moved[index] ? 0 : run + 1;
          longest = Math.max(longest, run);
        }
        return longest;
      };

      scenarioSuite((it) => {
        it.effect("a conversation opened at its end stays at its end while its rows settle", () =>
          Effect.gen(function* () {
            const s = yield* createScenario([], { mate: "real" });
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* s.given.project("Ada", { mate: true });
            const mate = s.drivers.realMates.get("Ada")!;
            const picture = yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const canvas = document.createElement("canvas");
                canvas.width = 1200;
                canvas.height = 800;
                return canvas.toDataURL("image/png").split(",")[1]!;
              }),
            );
            yield* Effect.promise(() =>
              NodeFSP.writeFile(
                NodePath.join(mate.server.root, "workspace", "page.png"),
                Buffer.from(picture, "base64"),
              ),
            );
            const conversationId = ConversationId.make("settling-rows");
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
            for (let round = 0; round < 4; round++) {
              yield* mate.provider.turn([
                {
                  kind: "say",
                  text:
                    round === 3
                      ? `${"The page as it stands.\n\n".repeat(6)}![The page](page.png)\n\nThat is the page.`
                      : "An earlier answer stays readable.\n\n".repeat(20),
                },
              ]);
              const sent = yield* mate.server.engine.wire.send(
                {
                  protocol,
                  conversationId,
                  commandId: CommandId.make(`late-${round}`),
                  text: `Ask ${round}`,
                },
                caller,
              );
              expect(sent._tag).toBe("Accepted");
              while (true) {
                const frame = yield* Queue.take(frames);
                if (
                  frame.type === "changes" &&
                  frame.runs.some((run) => run.ordinal === round + 1 && run.state === "ended")
                )
                  break;
              }
            }
            yield* s.given.signedIn;
            // A slower machine lays the answer's picture out after the conversation is placed: the
            // answer grows 244 px with its record unchanged.
            const cdp = yield* Effect.promise(() => s.page.createCDPSession());
            yield* Effect.promise(() => cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 }));
            yield* s.when.menu.opensMate("Ada");
            yield* s.then.conversation.showsMessage("That is the page.");
            yield* Effect.promise(() => startOpenTrace(s.page));
            yield* Effect.promise(() =>
              s.page.waitForFunction(() =>
                [...document.querySelectorAll<HTMLImageElement>("img")].some(
                  (image) => image.alt === "The page" && image.complete && image.naturalWidth > 0,
                ),
              ),
            );
            yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 30 }));
            const trace = yield* Effect.promise(() => stopOpenTrace(s.page));
            const shown = trace
              .filter((frame) => frame.shown)
              .map((frame) => Math.round(frame.end));
            expect(shown.length, "ASSERTION: the conversation stood in sight").toBeGreaterThan(20);
            expect(
              Math.max(...shown),
              `ASSERTION: every frame in sight shows the conversation's end, never a chase to it: ${shown.join(" ")}`,
            ).toBeLessThanOrEqual(2);
            yield* s.then.noExternalNetwork;
          }),
        );

        it.effect(
          "scrolled up in the conversation, arriving steps leave what the reader reads where it stands",
          () =>
            Effect.gen(function* () {
              const { s, steps } = yield* longWork;
              yield* Effect.promise(async () => {
                const outer = (await s.page.$(OUTER))!;
                const box = (await outer.boundingBox())!;
                await s.page.mouse.move(box.x + 40, box.y + 200);
                await s.page.mouse.wheel({ deltaY: -600 });
                await waitForStillFrames(s.page, { stillFrames: 12 });
              });
              yield* Effect.promise(() => startScrollTrace(s.page));
              yield* steps;
              const trace = yield* Effect.promise(() => stopScrollTrace(s.page));
              const seen = trace
                .map(
                  (frame) =>
                    `${Math.round(frame.outerTop)}/${frame.read === null ? "-" : Math.round(frame.read)}`,
                )
                .join(" ");
              expect(
                trace[0]!.outerEnd,
                `ASSERTION: the reader stands above the end: ${seen}`,
              ).toBeGreaterThan(200);
              expect(
                strayed(trace.map((frame) => frame.outerTop)),
                `ASSERTION: the conversation's scroll stays where the reader put it: ${seen}`,
              ).toBeLessThanOrEqual(2);
              expect(
                strayed(trace.map((frame) => frame.read)),
                `ASSERTION: the line under the reader never moves: ${seen}`,
              ).toBeLessThanOrEqual(2);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "scrolled up in the Working card, arriving steps leave its lines where they stand",
          () =>
            Effect.gen(function* () {
              const { s, steps } = yield* longWork;
              yield* Effect.promise(async () => {
                const inner = (await s.page.$$(INNER)).at(-1)!;
                const box = (await inner.boundingBox())!;
                await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await s.page.mouse.wheel({ deltaY: -200 });
                await waitForStillFrames(s.page, { stillFrames: 12 });
              });
              yield* Effect.promise(() => startScrollTrace(s.page));
              yield* steps;
              const trace = yield* Effect.promise(() => stopScrollTrace(s.page));
              const seen = trace
                .map((frame) => (frame.innerTop === null ? "-" : Math.round(frame.innerTop)))
                .join(" ");
              // Every line stands still, those in view and those under it: none glides toward a place out of view.
              const spans = new Map<string, number[]>();
              for (const frame of trace)
                for (const [key, top] of Object.entries(frame.innerLines))
                  spans.set(key, [...(spans.get(key) ?? []), top]);
              const moved = [...spans]
                .map(([key, tops]) => ({ key, travel: Math.max(...tops) - Math.min(...tops) }))
                .filter((line) => line.travel > 2)
                .map((line) => `${line.key} ${Math.round(line.travel)} px`);
              expect(
                trace.some((frame) => frame.innerFollows),
                `ASSERTION: the card stops following once the reader scrolls up in it: ${seen}`,
              ).toBe(false);
              expect(
                strayed(trace.map((frame) => frame.innerTop)),
                `ASSERTION: the card's scroll stays where the reader put it: ${seen}`,
              ).toBeLessThanOrEqual(2);
              expect(spans.size, "ASSERTION: the card shows lines to read").toBeGreaterThan(0);
              expect(
                moved,
                "ASSERTION: every line in the card stands where it is; nothing plops toward a place out of view",
              ).toEqual([]);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "a wheel that carries the Working card past its top leaves the conversation where the reader took it",
          () =>
            Effect.gen(function* () {
              const { s, steps } = yield* longWork;
              // A short card scroll: the flick reaches its top and the rest of it scrolls the conversation.
              yield* Effect.promise(async () => {
                const inner = (await s.page.$$(INNER)).at(-1)!;
                await inner.evaluate((node) => {
                  node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 60);
                });
                await waitForStillFrames(s.page, { stillFrames: 12 });
              });
              const before = yield* Effect.promise(() =>
                s.page.$eval(OUTER, (node) => node.scrollTop),
              );
              yield* flick(s.page, INNER, -1);
              yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 6 }));
              const left = yield* Effect.promise(() =>
                s.page.$eval(OUTER, (node) => ({
                  top: node.scrollTop,
                  end: node.scrollHeight - node.clientHeight - node.scrollTop,
                })),
              );
              expect(
                before - left.top,
                "ASSERTION: the flick reached past the card's top into the conversation",
              ).toBeGreaterThan(2);
              yield* Effect.promise(() => startScrollTrace(s.page));
              yield* steps;
              const trace = yield* Effect.promise(() => stopScrollTrace(s.page));
              const seen = trace.map((frame) => Math.round(frame.outerTop)).join(" ");
              expect(
                strayed([left.top, ...trace.map((frame) => frame.outerTop)]),
                `ASSERTION: the conversation stays where the flick left it, ${Math.round(left.end)} px above its end: ${seen}`,
              ).toBeLessThanOrEqual(2);
              yield* s.then.noExternalNetwork;
            }),
        );

        // The owner, 2026-10-19: a long Working card ("Working · 2:29 · 29 steps") closing at its
        // turn's end was choppy. Reproduced: its answer coming with the end, the view glided 232 px
        // up to it, then the work folded and brought it all 461 px back down; read in its slot
        // first, the fold waited 250 ms; and the card's last 12 px left in one frame at its end.
        // Under reduced motion the card folded at once under its held head, the answer 229 px up,
        // and came back down when the hold ended: there, the turn lands in one swap.
        it.effect.each([
          {
            case: "its answer arriving with the end",
            streamed: false,
            scrolledUp: false,
            reduced: false,
          },
          {
            case: "its answer read in its slot first",
            streamed: true,
            scrolledUp: false,
            reduced: false,
          },
          {
            case: "the reader scrolled up in the conversation",
            streamed: false,
            scrolledUp: true,
            reduced: false,
          },
          {
            case: "under reduced motion, its answer arriving with the end",
            streamed: false,
            scrolledUp: false,
            reduced: true,
          },
          {
            case: "under reduced motion, its answer read in its slot first",
            streamed: true,
            scrolledUp: false,
            reduced: true,
          },
        ])(
          "a long Working card closes at its turn's end in one motion: nothing goes back, nothing waits midway: $case",
          ({ streamed, scrolledUp, reduced }) =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* longWork;
              if (reduced)
                yield* Effect.promise(() =>
                  s.page.emulateMediaFeatures([
                    { name: "prefers-reduced-motion", value: "reduce" },
                  ]),
                );
              if (scrolledUp)
                yield* Effect.promise(async () => {
                  const outer = (await s.page.$(OUTER))!;
                  const box = (await outer.boundingBox())!;
                  await s.page.mouse.move(box.x + 40, box.y + 200);
                  await s.page.mouse.wheel({ deltaY: -600 });
                  await waitForStillFrames(s.page, { stillFrames: 12 });
                });
              const lastWords = "Paragraph 8, the last";
              const text = Array.from({ length: 8 }, (_, index) =>
                index === 7
                  ? `${lastWords}: the deploy went through and the logs read clean.`
                  : `Paragraph ${index + 1}: the deploy went through and the logs read clean.`,
              ).join("\n\n");
              const note = streamed
                ? engine.item(run, { kind: "note", text: "", streaming: true, answer: false })
                : null;
              if (note !== null) {
                engine.stream(note, text);
                yield* Effect.promise(() =>
                  s.page.waitForFunction(
                    (words: string) =>
                      [
                        ...document.querySelectorAll(
                          '[data-run-chat][data-run-live] [data-chat-kind="note"]',
                        ),
                      ].some((element) => element.textContent?.includes(words)),
                    { polling: "raf" },
                    lastWords,
                  ),
                );
                yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 12 }));
              }
              yield* Effect.promise(() => startCloseTrace(s.page, lastWords));
              yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 4 }));
              if (note === null)
                engine.item(run, { kind: "note", text, streaming: false, answer: false });
              else {
                engine.settle(note);
                engine.update(note, { text, streaming: false });
              }
              engine.end(run);
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    [...document.querySelectorAll("[data-run-chat]")]
                      .at(-1)
                      ?.getAttribute("data-run-fold") === "folded",
                  { polling: "raf" },
                ),
              );
              yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 30 }));
              const trace = yield* Effect.promise(() => stopCloseTrace(s.page));
              const seen = trace
                .map(
                  (frame) =>
                    `${frame.card === null ? "-" : Math.round(frame.card)}/${frame.answer === null ? "-" : Math.round(frame.answer)}`,
                )
                .join(" ");
              const first = trace[0]!;
              const rest = trace.at(-1)!;
              if (scrolledUp) {
                expect(
                  first.fromEnd,
                  `ASSERTION: the reader stands above the end: ${seen}`,
                ).toBeGreaterThan(200);
                expect(
                  strayed(trace.map((frame) => frame.card)),
                  `ASSERTION: the card the reader reads stands where it stood: ${seen}`,
                ).toBeLessThanOrEqual(2);
              } else {
                expect(
                  rest.card! - first.card!,
                  `ASSERTION: what stood above the card came down as its work folded: ${seen}`,
                ).toBeGreaterThan(100);
                expect(
                  rest.answer!,
                  `ASSERTION: the answer's last line rests above the composer: ${seen}`,
                ).toBeLessThanOrEqual(rest.composer);
                expect(
                  Math.abs(rest.fromEnd),
                  `ASSERTION: the conversation rests at its end: ${seen}`,
                ).toBeLessThanOrEqual(1);
              }
              expect(
                backTravel(trace.map((frame) => frame.card)),
                `ASSERTION: what stands above the card travels one way, never back: ${seen}`,
              ).toBeLessThanOrEqual(2);
              expect(
                backTravel(trace.map((frame) => frame.answer)),
                `ASSERTION: the answer's last line travels one way, never back: ${seen}`,
              ).toBeLessThanOrEqual(2);
              expect(
                longestPause(trace),
                `ASSERTION: once the card starts closing, it closes without waiting midway: ${seen}`,
              ).toBeLessThan(6);
              if (reduced)
                expect(
                  movedFrames(trace).filter(Boolean).length,
                  `ASSERTION: under reduced motion the turn lands in one swap: ${seen}`,
                ).toBeLessThanOrEqual(1);
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });
  });
});
