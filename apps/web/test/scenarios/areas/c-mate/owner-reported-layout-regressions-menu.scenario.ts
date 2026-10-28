import { scenarioSuite } from "../../harness/suite.ts";
import { composerLayout } from "./composerLayout.ts";
import type { Page } from "puppeteer-core";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";
import { menuScenario } from "../b-menu/dsl.ts";
import { reportConversation } from "../b-menu/fake.ts";
import { environmentFixtureWith } from "../e-env/fake.ts";
import {
  menuAt,
  ownerMenu,
  type ChiefPageFrame,
  recordChiefPage,
  decodeConversationRow,
  quoted,
} from "./ownerReportedLayout.ts";

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    it.effect(
      "a reload of the Chief's page keeps its split from the first frame, and nothing moves once its conversation shows",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Chief", { mate: true });
          const { zerops, core, owner } = s.drivers;
          zerops.put("project", {
            ...zerops.rows("project").find((project) => project.id === "Chief")!,
            tagList: ["chief"],
          });
          const registered = yield* core.call("PUT", "/api/chief", {
            session: owner,
            body: { projectId: "Chief" },
          });
          expect(
            registered.status,
            "ASSERTION: an Owner marks the project as the organization's Chief",
          ).toBe(200);
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerMenu(s.page));
          yield* Effect.promise(() =>
            s.page
              .locator('[data-sidebar="sidebar"] [data-zerops-surface="sidebar-chief-row"]')
              .click(),
          );
          yield* Effect.promise(() =>
            s.page.waitForSelector('[role="textbox"]', { visible: true }),
          );
          const mate = s.drivers.realMates.get("Chief")!;
          yield* mate.provider.turn([
            {
              kind: "say",
              text: [
                "I will look into your organization.",
                ...Array.from({ length: 30 }, (_, line) => `- Project ${line + 1} is running.`),
              ].join("\n"),
            },
          ]);
          yield* s.when.conversation.sends("Look into my organization.");
          yield* s.then.conversation.showsMessage("I will look into your organization.");
          yield* Effect.promise(async () => {
            await s.page.waitForFunction(() => !location.pathname.includes("/draft/"));
            await s.page.locator('[data-zerops-surface="chief-overview"]').click();
            await s.page.waitForSelector('[data-preview-panel-mode="inline"]');
            await waitForStillFrames(s.page);
          });
          const frames = yield* Effect.promise(async () => {
            await s.page.evaluateOnNewDocument(recordChiefPage);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(() => {
              const frames = (window as unknown as { chiefFrames?: ChiefPageFrame[] }).chiefFrames;
              return frames !== undefined && frames.filter((frame) => frame.shown).length > 0;
            });
            await waitForStillFrames(s.page, { stillFrames: 30 });
            return s.page.evaluate(
              () => (window as unknown as { chiefFrames: ChiefPageFrame[] }).chiefFrames,
            );
          });
          const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
          const drawn = frames.filter((frame) => frame.column !== null);
          expect(
            new Set(drawn.map((frame) => frame.column)).size,
            `ASSERTION: the conversation's column never changes width:\n${trace}`,
          ).toBe(1);
          expect(
            drawn.every((frame) => frame.panel !== null),
            `ASSERTION: the panel stands beside it from the first frame:\n${trace}`,
          ).toBe(true);
          const shown = frames.filter((frame) => frame.shown);
          expect(
            shown.every((frame) => (frame.composer ?? frame.held) !== null),
            `ASSERTION: the conversation shows with its composer, or its room held:\n${trace}`,
          ).toBe(true);
          expect(
            new Set(shown.map((frame) => `${frame.composer ?? frame.held}/${frame.lastRow}`)).size,
            `ASSERTION: nothing moves once the conversation shows:\n${trace}`,
          ).toBe(1);
          expect(
            new Set(frames.flatMap((frame) => (frame.panelWait === null ? [] : [frame.panelWait])))
              .size,
            `ASSERTION: the panel waits with one look:\n${trace}`,
          ).toBeLessThanOrEqual(1);
        }),
    );
  });

  describe("Decision: geometry relations only; no style pins.", () => {
    describe("Decision: a mark between two names gives way whole; the Mate's name keeps its letters while a mark holds room.", () => {
      describe("B: marks between a project's name and its Mate's", () => {
        scenarioSuite((it) => {
          it.effect(
            "a waiting release's mark is never cut, and never cuts the Mate's name, at any menu width",
            () =>
              Effect.gen(function* () {
                const f = yield* environmentFixtureWith({}, { stage: false });
                yield* f.s.drivers.core.call("PATCH", `/api/apps/${f.appId}`, {
                  session: f.s.owner,
                  body: { name: "Tea Shop Front Counter" },
                });
                yield* f.merge("Ship the storefront");
                yield* Effect.promise(() => f.s.page.setViewport({ width: 1786, height: 1000 }));
                yield* f.s.given.signedIn;
                const mark = `[data-zerops-group="${f.appId}"] [data-zerops-surface="sidebar-project-release-mark"]`;
                yield* Effect.promise(() => f.s.page.waitForSelector(mark));
                const readings: string[] = [];
                for (let width = 435; width >= 256; width -= 9) {
                  yield* Effect.promise(() => menuAt(f.s.page, width));
                  const reading = yield* Effect.promise(() =>
                    f.s.page.$eval(mark, (element) => {
                      const marks = element.closest(".menu-marks")!.getBoundingClientRect();
                      const own = element.getBoundingClientRect();
                      const mate = element
                        .closest('[data-zerops-surface="sidebar-mate-name"]')!
                        .querySelector<HTMLElement>(".menu-name-mate")!;
                      return {
                        whole: own.right <= marks.right + 0.5 && own.bottom <= marks.bottom + 0.5,
                        gone: own.top >= marks.bottom - 0.5,
                        room: marks.width,
                        mateCut: mate.scrollWidth > mate.clientWidth,
                      };
                    }),
                  );
                  readings.push(
                    `${String(width)}: mark ${reading.whole ? "whole" : reading.gone ? "gone" : "cut"}, room ${reading.room.toFixed(1)}, Mate's name ${reading.mateCut ? "cut" : "whole"}`,
                  );
                  expect(
                    reading.whole || reading.gone,
                    `ASSERTION: the mark shows whole or not at all: ${readings.join(" ")}`,
                  ).toBe(true);
                  expect(
                    reading.mateCut && reading.room > 0.5,
                    `ASSERTION: the Mate's name keeps its letters while the marks hold room: ${readings.join(" ")}`,
                  ).toBe(false);
                }
                expect(
                  readings.some((reading) => reading.includes("mark gone")),
                  `ASSERTION: the sweep reached a width the mark gives way at: ${readings.join(" ")}`,
                ).toBe(true);
                yield* f.s.then.noExternalNetwork;
              }),
          );
        });
      });
    });

    describe("Decision: restore the expected end of the list; no other menu changes.", () => {
      describe("B: list end spacing", () => {
        scenarioSuite((it) => {
          it.effect("the last project keeps one regular row gap above the list's foot", () =>
            Effect.gen(function* () {
              const s = yield* menuScenario();
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              for (let index = 0; index < 24; index++) {
                const name = `Project${String(index).padStart(2, "0")}`;
                yield* s.given.project(name, {
                  app: name,
                  kind: index === 0 ? "mate" : "stage",
                  environmentName: "stage",
                });
              }
              yield* s.given.signedIn;
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* Effect.promise(async () => {
                await s.page.waitForFunction(
                  () => document.querySelectorAll("section[data-zerops-group]").length === 24,
                );
                // Groups start folded; any left open is folded here.
                for (const toggle of await s.page.$$(
                  '[data-zerops-surface="sidebar-project"][aria-expanded="true"]',
                )) {
                  await toggle.click();
                  // Folding moves the next heading; wait for completion before aiming its click.
                  await s.page.waitForFunction(
                    (heading) =>
                      heading.getAttribute("aria-expanded") === "false" &&
                      heading
                        .closest("section[data-zerops-group]")!
                        .querySelector('[data-zerops-surface="sidebar-project-rows"]') === null,
                    { polling: "raf" },
                    toggle,
                  );
                }
                await s.page.$eval('[data-sidebar="content"]', (content) => {
                  content.closest('[data-slot="scroll-area-viewport"]')!.scrollTop = 0;
                });
                await s.page.waitForFunction(
                  () =>
                    document.querySelector('[data-zerops-surface="sidebar-fold-slack"]') === null,
                );
                await s.page.$eval('[data-sidebar="content"]', (content) => {
                  const viewport = content.closest('[data-slot="scroll-area-viewport"]')!;
                  viewport.scrollTop = viewport.scrollHeight;
                });
                await s.page.waitForFunction(() => {
                  const viewport = document
                    .querySelector('[data-sidebar="content"]')!
                    .closest('[data-slot="scroll-area-viewport"]')!;
                  return (
                    Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) <=
                    1
                  );
                });
                const geometry = await s.page.evaluate(() => {
                  const rows = [
                    ...document.querySelectorAll('[data-zerops-surface="sidebar-project"]'),
                  ].map((row) => row.getBoundingClientRect());
                  const last = rows.at(-1)!;
                  const previous = rows.at(-2)!;
                  // New project left the foot for the top row's + (round 5): the list
                  // now ends where its scroll does, on the account's foot.
                  const viewport = document
                    .querySelector('[data-sidebar="content"]')!
                    .closest('[data-slot="scroll-area-viewport"]')!;
                  const divider = viewport.getBoundingClientRect().bottom;
                  return {
                    regularGap: last.top - previous.bottom,
                    endGap: divider - last.bottom,
                    overflow: viewport.scrollHeight - viewport.clientHeight,
                  };
                });
                expect(geometry.overflow).toBeGreaterThan(0);
                if (process.env.MENU_SCROLL_EVIDENCE) {
                  await s.page.screenshot({
                    path: process.env.MENU_SCROLL_EVIDENCE,
                    clip: { x: 0, y: 0, width: 435, height: 1000 },
                  });
                }
                expect(
                  Math.abs(geometry.endGap - geometry.regularGap),
                  `ASSERTION: list end gap equals regular row gap (±2 px): regular ${geometry.regularGap}px, end ${geometry.endGap}px`,
                ).toBeLessThanOrEqual(2);
              });
              yield* s.then.noExternalNetwork;
            }),
          );
        });
      });
    });

    describe("Decision: opening a menu row brings what it opened into view.", () => {
      describe("B: a project opened in a long list", () => {
        scenarioSuite((it) => {
          it.effect(
            "the last project's Mates come into view when it opens; one already in view leaves the list where it is",
            () =>
              Effect.gen(function* () {
                const s = yield* menuScenario();
                yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
                for (let index = 0; index < 24; index++) {
                  const name = `Project${String(index).padStart(2, "0")}`;
                  yield* s.given.project(name, {
                    app: name,
                    kind: "stage",
                    environmentName: "stage",
                  });
                }
                for (const [app, mates] of [
                  ["Alpha Titan", ["Ada", "Bea"]],
                  ["Zulu Titan", ["Cy", "Di"]],
                ] as const) {
                  for (const name of mates) yield* s.given.project(name, { mate: true, app });
                }
                yield* s.given.signedIn;
                yield* s.colleague.reports("Ada", {
                  latestUserMessageAt: "2026-10-27T00:00:00Z",
                  updatedAt: "2026-10-27T00:00:00Z",
                });
                yield* Effect.promise(() => ownerMenu(s.page));
                const seen = yield* Effect.promise(async () => {
                  await s.page.waitForFunction(
                    () => document.querySelectorAll("section[data-zerops-group]").length === 26,
                  );
                  // The two projects that open: the first of them and the last, as the menu lists
                  // them; the list's own scroller holds both.
                  const headings = '[data-zerops-surface="sidebar-project"][aria-expanded]';
                  const state = (at: number) =>
                    s.page.evaluate(
                      (selector, index) => {
                        const all = [...document.querySelectorAll<HTMLElement>(selector)];
                        const heading = all.at(index)!;
                        const scroller = heading.closest<HTMLElement>(
                          '[data-slot="scroll-area-viewport"]',
                        )!;
                        const view = scroller.getBoundingClientRect();
                        const box = heading.getBoundingClientRect();
                        const mate = heading
                          .closest("section[data-zerops-group]")!
                          .querySelector("[data-zerops-kids] [data-zerops-row]")
                          ?.getBoundingClientRect();
                        return {
                          open: heading.getAttribute("aria-expanded") === "true",
                          scrollTop: scroller.scrollTop,
                          headingTop: box.top - view.top,
                          headingBottom: view.bottom - box.bottom,
                          mateTop: mate === undefined ? -1 : mate.top - view.top,
                          mateBottom: mate === undefined ? -1 : view.bottom - mate.bottom,
                        };
                      },
                      headings,
                      at,
                    );
                  const press = async (at: number) => {
                    const all = await s.page.$$(headings);
                    await all.at(at)!.click();
                    await waitForStillFrames(s.page);
                  };
                  const before = await state(0);
                  await press(0);
                  const inView = await state(0);
                  await s.page.evaluate(() => {
                    const scroller = document
                      .querySelector('[data-sidebar="content"]')!
                      .closest<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
                    scroller.scrollTop = scroller.scrollHeight;
                  });
                  await waitForStillFrames(s.page);
                  const atEnd = await state(-1);
                  await press(-1);
                  const brought = await state(-1);
                  return { before, inView, atEnd, brought };
                });
                const said = Object.entries(seen)
                  .map(([name, at]) =>
                    [
                      name,
                      ...Object.entries(at).map(([key, value]) => `${key}=${String(value)}`),
                    ].join(" "),
                  )
                  .join("; ");
                expect(
                  seen.before.headingBottom,
                  `ASSERTION: the first project stands in view before it opens: ${said}`,
                ).toBeGreaterThan(0);
                expect(
                  seen.inView.scrollTop,
                  `ASSERTION: a project whose Mates fit in view opens without moving the list: ${said}`,
                ).toBe(seen.before.scrollTop);
                expect(
                  seen.atEnd.open,
                  `ASSERTION: the last project is folded at the list's end: ${said}`,
                ).toBe(false);
                expect(
                  seen.brought.mateTop,
                  `ASSERTION: the last project's first Mate stands inside the list's visible rect once it opens: ${said}`,
                ).toBeGreaterThanOrEqual(0);
                expect(
                  seen.brought.mateBottom,
                  `ASSERTION: the last project's first Mate stands inside the list's visible rect once it opens: ${said}`,
                ).toBeGreaterThanOrEqual(0);
                expect(
                  seen.brought.headingTop,
                  `ASSERTION: its heading stays in view above them: ${said}`,
                ).toBeGreaterThanOrEqual(0);
                yield* s.then.noExternalNetwork;
              }),
          );
        });
      });
    });

    describe("Decision: an overview card is as tall as what it holds.", () => {
      describe("B: overview cards", () => {
        scenarioSuite((it) => {
          // The owner (2026-10-12): "why the gap at bottom".
          it.effect("an overview card ends where what it holds ends, beside a taller one", () =>
            Effect.gen(function* () {
              const s = yield* menuScenario();
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Ada", { mate: true, app: "Shop" });
              yield* s.given.project("Bea", { mate: true, app: "Northwind" });
              yield* s.stage("Northwind-stage", "Northwind");
              yield* s.given.signedIn;
              yield* Effect.promise(async () => {
                await s.page.goto(`${s.web.origin}/zerops`);
                // Both cards drawn: the overview paints its page whole, once it is read.
                await s.page.waitForFunction(
                  () =>
                    [
                      ...document.querySelectorAll('[data-zerops-surface="project-cards"] article'),
                    ].filter((card) => card.getBoundingClientRect().height > 0).length === 2,
                );
                const cards = await s.page.evaluate(() =>
                  [
                    ...document.querySelectorAll<HTMLElement>(
                      '[data-zerops-surface="project-cards"] article',
                    ),
                  ].map((card) => {
                    const box = card.getBoundingClientRect();
                    const ends = Math.max(
                      ...[...card.children]
                        .map((part) => part.getBoundingClientRect())
                        .filter((part) => part.height > 0)
                        .map((part) => part.bottom),
                    );
                    return {
                      name: card.getAttribute("aria-label"),
                      height: box.height,
                      below: box.bottom - ends - parseFloat(getComputedStyle(card).paddingBottom),
                    };
                  }),
                );
                const seen = quoted(cards);
                expect(
                  new Set(cards.map((card) => Math.round(card.height))).size,
                  `ASSERTION: the two cards hold different heights: ${seen}`,
                ).toBe(2);
                for (const card of cards)
                  expect(
                    card.below,
                    `ASSERTION: ${card.name}'s card ends where what it holds ends: ${seen}`,
                  ).toBeLessThanOrEqual(1);
              });
              yield* s.then.noExternalNetwork;
            }),
          );
        });
      });
    });

    const ROW = '[data-zerops-surface="sidebar-mate"]';
    const ASK = "Keep the running row steady";
    type Witness = {
      failures: string[];
      initialClock: string | null | undefined;
      observer: MutationObserver;
    };

    describe("B: running row refresh", () => {
      scenarioSuite((it) => {
        // The owner (2026-10-11): the left side "jumps in height" with a Mate's step row, "then it
        // disappears and it jumps again".
        it.effect(
          "a Mate's row keeps its height from its step through the wait for its answer to the answer",
          () =>
            Effect.gen(function* () {
              const s = yield* menuScenario();
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Ada", { mate: true });
              yield* s.given.signedIn;
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* s.then.menu.row("Ada").appears();
              const now = yield* Clock.currentTimeMillis;
              const since = DateTime.formatIso(DateTime.makeUnsafe(now - 12_000));
              const done = DateTime.formatIso(DateTime.makeUnsafe(now - 1_000));
              const running = {
                session: { status: "running" as const, lastError: null },
                latestUserMessagePreview: { role: "user" as const, text: ASK },
                latestTurn: {
                  turnId: TurnId.make("run-steady"),
                  state: "running" as const,
                  requestedAt: since,
                  startedAt: since,
                  completedAt: null,
                },
              };
              const height = () =>
                Effect.promise(() =>
                  s.page.$eval(ROW, (row) => Math.round(row.getBoundingClientRect().height)),
                );
              // Its step, under what was asked.
              yield* reportConversation(
                s.drivers,
                "Ada",
                { ...running, liveStep: { kind: "thinking" as const, since } },
                "working",
              );
              yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
              const working = yield* height();
              // The step gone, its answer on the way: the row holds its last step until the next
              // one or the answer takes its place (run 2: it fell back to the prompt mid-turn).
              yield* reportConversation(
                s.drivers,
                "Ada",
                { ...running, liveStep: null },
                "working",
              );
              yield* Effect.promise(() => waitForStillFrames(s.page));
              yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
              const waiting = yield* height();
              // The answer, under what was asked.
              yield* reportConversation(
                s.drivers,
                "Ada",
                {
                  session: { status: "ready" as const, lastError: null },
                  latestUserMessagePreview: running.latestUserMessagePreview,
                  latestMessagePreview: { role: "assistant" as const, text: "Steady now." },
                  latestTurn: {
                    ...running.latestTurn,
                    state: "completed" as const,
                    completedAt: done,
                  },
                },
                "idle",
              );
              yield* s.menu.text("Ada", "Steady now.");
              const answered = yield* height();
              expect({ working, waiting, answered }).toEqual({
                working,
                waiting: working,
                answered: working,
              });
              yield* s.then.noReload;
            }),
        );

        it.effect(
          "a running row keeps known content and height through identical and advancing refreshes",
          () =>
            Effect.gen(function* () {
              const s = yield* menuScenario();
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Ada", { mate: true });
              yield* s.given.signedIn;
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* s.then.menu.row("Ada").appears();
              const mate = s.drivers.mates.get("Ada")!;
              const since = DateTime.formatIso(
                DateTime.makeUnsafe((yield* Clock.currentTimeMillis) - 12_000),
              );
              const patch = {
                session: { status: "running" as const, lastError: null },
                latestUserMessagePreview: { text: ASK },
                liveStep: { kind: "thinking" as const, since },
                latestTurn: {
                  turnId: TurnId.make("run-refresh"),
                  state: "running" as const,
                  requestedAt: since,
                  startedAt: since,
                  completedAt: null,
                },
              };
              const row = yield* decodeConversationRow({
                conversationId: mate.shellThread().id,
                agent: null,
                revision: { environmentId: mate.descriptor.environmentId, epoch: 1, seq: 1 },
                state: { kind: "working", since: Date.parse(since), waitsOnHelpers: false },
                activeRunId: "run-refresh",
                latestRun: null,
                subject: ASK,
                snippet: null,
                at: Date.parse(since),
                askedAt: Date.parse(since),
              });
              yield* reportConversation(s.drivers, "Ada", patch, "working");
              yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
              // Observe transient DOM states between deliveries as well as timer ticks.
              yield* Effect.promise(() =>
                s.page.evaluate((selector) => {
                  const row = document.querySelector<HTMLElement>(selector)!;
                  const initialHeight = row.getBoundingClientRect().height;
                  const initialClock = row.querySelector(".menu-clock")?.textContent;
                  const failures: string[] = [];
                  const sample = () => {
                    if (!row.isConnected) failures.push("row remounted");
                    if (row.querySelector('[data-zerops-surface="sidebar-mate-pending"]'))
                      failures.push("placeholder");
                    // Round 5: the one line under the name is the step it is on.
                    if (
                      !row
                        .querySelector('[data-zerops-surface="sidebar-mate-live-step"]')
                        ?.textContent?.trim()
                    )
                      failures.push("step lost");
                    if (!row.querySelector(".menu-clock")) failures.push("clock lost");
                    if (row.getBoundingClientRect().height !== initialHeight)
                      failures.push("height changed");
                  };
                  const observer = new MutationObserver(sample);
                  observer.observe(row.parentElement!, {
                    subtree: true,
                    childList: true,
                    attributes: true,
                    characterData: true,
                  });
                  Object.assign(window, {
                    runningRowWitness: { failures, initialClock, observer },
                  });
                  sample();
                }, ROW),
              );
              for (const seq of [1, 1, 2, 3]) {
                yield* reportConversation(s.drivers, "Ada", patch, "working", [
                  { ...row, revision: { ...row.revision, seq } },
                ]);
                yield* Effect.promise(() =>
                  s.page.evaluate(
                    () =>
                      new Promise<void>((resolve) =>
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                      ),
                  ),
                );
              }
              yield* reportConversation(
                s.drivers,
                "Ada",
                {
                  ...patch,
                  liveStep: { kind: "writing", since },
                },
                "working",
                [{ ...row, revision: { ...row.revision, seq: 4 } }],
              );
              yield* s.menu.text("Ada", "Writing", "sidebar-mate-live-step");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (selector) => {
                    const witness = (window as unknown as { runningRowWitness: Witness })
                      .runningRowWitness;
                    return (
                      document.querySelector(selector)?.querySelector(".menu-clock")
                        ?.textContent !== witness.initialClock
                    );
                  },
                  {},
                  ROW,
                ),
              );
              const failures = yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const witness = (window as unknown as { runningRowWitness: Witness })
                    .runningRowWitness;
                  witness.observer.disconnect();
                  return witness.failures;
                }),
              );
              expect(failures).toEqual([]);
              yield* s.then.noReload;
            }),
        );
      });
    });

    // The owner, 2026-10-18, at a narrower window: the Mate's name was cut to "Mir" and the blue
    // Review pill stood over it, while the conversation's subject kept its length to its ellipsis.
    describe("Decision: the subject gives way in the header; the face, the name and the pill never do.", () => {
      scenarioSuite((it) => {
        it.effect(
          "at a narrow header the Mate's whole name shows, the pill stands clear of it, and the subject is what is cut",
          () =>
            Effect.gen(function* () {
              const { s, chat } = yield* composerLayout("review");
              const mate = s.drivers.realMates.get("Ada")!;
              yield* mate.provider.turn([{ kind: "say", text: "Noted for tomorrow." }]);
              yield* chat.when.send(
                "Next for tomorrow's demo: the onboarding flow end to end, the project page's cards side by side, and the release notes for everyone who joins the call",
              );
              yield* mate.provider.received;
              yield* Effect.promise(() => s.page.setViewport({ width: 1280, height: 800 }));
              yield* Effect.promise(() => ownerMenu(s.page));
              const header = yield* Effect.promise(async () => {
                await s.page.waitForFunction(
                  () => {
                    const text = document.querySelector<HTMLElement>(
                      "[data-conversation-subject] .truncate",
                    );
                    return text !== null && text.textContent!.startsWith("Next for tomorrow");
                  },
                  { polling: "raf" },
                );
                await waitForStillFrames(s.page);
                return s.page.evaluate(() => {
                  const box = (element: Element | null) => {
                    const rect = element!.getBoundingClientRect();
                    return { left: rect.left, right: rect.right };
                  };
                  const name = document.querySelector<HTMLElement>(
                    "[data-conversation-mate-press] > span:last-child",
                  )!;
                  const subject = document.querySelector<HTMLElement>(
                    "[data-conversation-subject] .truncate",
                  )!;
                  return {
                    name: {
                      ...box(name),
                      text: name.textContent,
                      cut: name.scrollWidth > name.clientWidth,
                    },
                    press: box(document.querySelector("[data-conversation-mate-press]")),
                    pill: box(document.querySelector(".chat-header-review")),
                    subject: { ...box(subject), cut: subject.scrollWidth > subject.clientWidth },
                  };
                });
              });
              yield* Effect.promise(async () => {
                if (process.env.MATE_LAYOUT_EVIDENCE) {
                  const bar = await s.page.$("[data-chat-header]");
                  await bar!.screenshot({
                    path: `${process.env.MATE_LAYOUT_EVIDENCE}/header-narrow.png`,
                  });
                }
              });
              const seen = quoted(header);
              expect(header.name.text, `ASSERTION: the name is the Mate's: ${seen}`).toBe("Ada");
              expect(header.name.cut, `ASSERTION: the Mate's whole name shows: ${seen}`).toBe(
                false,
              );
              expect(
                header.name.right,
                `ASSERTION: the name stands inside its press: ${seen}`,
              ).toBeLessThanOrEqual(header.press.right + 0.5);
              expect(
                header.pill.left,
                `ASSERTION: the pill stands clear of the name: ${seen}`,
              ).toBeGreaterThanOrEqual(header.name.right - 0.5);
              expect(
                header.subject.left,
                `ASSERTION: the subject stands after the pill: ${seen}`,
              ).toBeGreaterThanOrEqual(header.pill.right - 0.5);
              expect(header.subject.cut, `ASSERTION: the subject is what is cut: ${seen}`).toBe(
                true,
              );
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    // The owner, 2026-10-18: an open site in the Browser panel "is still fucked up and not
    // fullscreen" — the page started half way down the panel, under the Browser's head.
    describe("Decision: an open site is its address row and the site, edge to edge, in every panel mode.", () => {
      /** The open site's frame against its address row and the panel's body, read from the page. */
      const siteGeometry = (page: Page) =>
        page.evaluate(() => {
          const frame = document.querySelector('iframe[title="appdev live preview"]')!;
          const content = frame.closest("[data-right-panel-surface-content]")!;
          const row = content.querySelector("[data-site-address-row]")!;
          const box = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
          };
          return { frame: box(frame), row: box(row), content: box(content) };
        });
      scenarioSuite((it) => {
        it.effect(
          "an open site's page starts right under its address row and fills the panel to its bottom and sides, at the side, expanded and as a sheet",
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Ada", { mate: true });
              s.drivers.zerops.put("service-stack", {
                id: "service-appdev",
                projectId: "Ada",
                clientId: "ORG",
                name: "appdev",
                status: "ACTIVE",
                subdomainAccess: true,
                serviceStackTypeInfo: {
                  serviceStackTypeName: "nodejs",
                  serviceStackTypeVersionName: "nodejs@22",
                  serviceStackTypeCategory: "USER",
                },
                ports: [{ port: 3000, scheme: "http" }],
              });
              // The site's page is any page that answers: its frame's box is what is read.
              s.drivers.routes["https://appdev-ada-3000.prg1.zerops.app"] =
                s.drivers.routes["https://zcp-ada-8080.prg1.zerops.app"]!;
              const chat = mateChat(s);
              chat.fixture().exchange("And now?", "The existing conversation is still here");
              yield* s.given.signedIn;
              yield* chat.when.open();
              yield* chat.then.text("The existing conversation is still here");
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* Effect.promise(async () => {
                await s.page.locator('button[aria-label^="Toggle right panel"]').click();
                await s.page.locator("::-p-text(Browser)").click();
                await s.page.locator('[data-mate-address="appdev"] button').click();
                await s.page.waitForSelector('iframe[title="appdev live preview"]', {
                  visible: true,
                });
                await waitForStillFrames(s.page);
              });
              const modes: Array<readonly [string, Awaited<ReturnType<typeof siteGeometry>>]> = [];
              modes.push(["side", yield* Effect.promise(() => siteGeometry(s.page))]);
              yield* Effect.promise(async () => {
                await s.page.locator('button[aria-label="Maximize panel"]').click();
                await s.page.waitForSelector('[data-preview-panel-maximized="true"]');
                await waitForStillFrames(s.page);
              });
              modes.push(["expanded", yield* Effect.promise(() => siteGeometry(s.page))]);
              yield* Effect.promise(async () => {
                await s.page.locator('button[aria-label="Restore panel size"]').click();
                await s.page.setViewport({ width: 900, height: 800 });
                await s.page.waitForSelector('[data-preview-panel-mode="sheet"] iframe', {
                  visible: true,
                });
                await waitForStillFrames(s.page);
              });
              modes.push(["sheet", yield* Effect.promise(() => siteGeometry(s.page))]);
              for (const [mode, seen] of modes) {
                const said = `${mode}: ${quoted(seen)}`;
                expect(
                  Math.abs(seen.frame.top - seen.row.bottom),
                  `ASSERTION: the page starts right under its address row: ${said}`,
                ).toBeLessThanOrEqual(1);
                expect(
                  Math.abs(seen.frame.bottom - seen.content.bottom),
                  `ASSERTION: the page reaches the panel's bottom: ${said}`,
                ).toBeLessThanOrEqual(1);
                expect(
                  Math.abs(seen.frame.left - seen.content.left) +
                    Math.abs(seen.frame.right - seen.content.right),
                  `ASSERTION: the page spans the panel's width: ${said}`,
                ).toBeLessThanOrEqual(1);
              }
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    // Milo's stress run 5 (A): the Helpers surface folded its earlier helpers away each time one
    // started and unfolded them each time none worked, CLS up to 0.205 just after a restart.
    describe("Decision: the Helpers surface keeps its rows where they stand; what is new comes under them.", () => {
      /** Each helper row's top on the Helpers surface, by its title. */
      const helperRows = (page: Page) =>
        page.evaluate(() =>
          Object.fromEntries(
            [...document.querySelectorAll("[data-helper-row]")].map((row) => [
              row.querySelector(".helper-row-name")?.textContent ?? "",
              row.getBoundingClientRect().top,
            ]),
          ),
        );
      scenarioSuite((it) => {
        it.effect("the Helpers surface's rows stay where they stand as helpers start and end", () =>
          Effect.gen(function* () {
            const s = yield* createScenario([installArea]);
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* s.given.project("Ada", { mate: true });
            const chat = mateChat(s);
            chat.fixture().exchange("And now?", "The existing conversation is still here");
            yield* s.given.signedIn;
            yield* chat.when.open();
            yield* chat.then.text("The existing conversation is still here");
            const wire = chat.fixture().wire;
            const engine = wire.engine;
            const helper = (run: string, title: string) =>
              engine.item(run, {
                kind: "work",
                work: `helper-${title}`,
                workKind: "helper",
                status: "running",
                title,
              });
            const first = engine.personRun("Start helpers A and B");
            const a = helper(first, "Helper A");
            const b = helper(first, "Helper B");
            engine.note(first, "Both helpers are on it.");
            yield* chat.then.text("Both helpers are on it.");
            engine.update(a, { status: "completed", report: "A is done." });
            engine.update(b, { status: "completed", report: "B is done." });
            engine.end(first);
            yield* Effect.promise(async () => {
              await s.page.locator('button[aria-label^="Toggle right panel"]').click();
              await s.page.locator("::-p-text(Helpers)").click();
              await s.page.waitForFunction(
                () => document.querySelectorAll(".helper-map > li").length >= 2,
              );
              await waitForStillFrames(s.page);
            });
            const states = [yield* Effect.promise(() => helperRows(s.page))];
            const settle = () =>
              Effect.promise(async () => {
                await waitForStillFrames(s.page);
                states.push(await helperRows(s.page));
              });
            const second = engine.personRun("Start helper C");
            const c = helper(second, "Helper C");
            yield* settle();
            engine.update(c, { status: "completed", report: "C is done." });
            engine.end(second);
            yield* settle();
            const seen = states
              .map((state) =>
                Object.entries(state)
                  .map(([title, top]) => `${title} at ${top}`)
                  .join(", "),
              )
              .join(" | ");
            for (const [index, after] of states.slice(1).entries()) {
              const before = states[index]!;
              for (const [title, top] of Object.entries(before)) {
                expect(
                  after[title],
                  `ASSERTION: ${title} stays on the surface: ${seen}`,
                ).toBeDefined();
                expect(
                  Math.abs(after[title]! - top),
                  `ASSERTION: ${title} keeps its place: ${seen}`,
                ).toBeLessThanOrEqual(1);
              }
            }
            expect(
              Object.keys(states.at(-1)!).length,
              `ASSERTION: the new helper comes under them: ${seen}`,
            ).toBe(3);
            yield* s.then.noExternalNetwork;
          }),
        );
      });
    });

    // The owner, 2026-10-12, on the rail's boards: "you absolutely do not identify your mate by the
    // name, shape or color, it's the project what is the main identifier", and of every way to
    // peek: "it stems from the reveal.. we should do tiles and just not do reveal".
    describe("Decision: the closed menu is a tile per project, and never reveals the open menu.", () => {
      const ANSWER_TEXT = "The existing conversation is still here";
      /** Shop's Mate open at the owner's view, the menu closed to its rail, the pointer on the page. */
      const closedOn = (also?: { readonly mate: string; readonly app: string }) =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          if (also !== undefined) yield* s.given.project(also.mate, { mate: true, app: also.app });
          const chat = mateChat(s);
          chat.fixture().exchange("And now?", ANSWER_TEXT);
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerMenu(s.page));
          yield* chat.when.open();
          yield* chat.then.text(ANSWER_TEXT);
          yield* Effect.promise(async () => {
            await s.page.click('button[aria-label="Collapse sidebar"]');
            await s.page.mouse.move(1200, 500);
            await s.page.waitForFunction(() => {
              const face = document.querySelector('[data-zerops-surface="sidebar-rail-mate"]');
              if (face === null) return false;
              const box = face.getBoundingClientRect();
              return face.contains(
                document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
              );
            });
            await waitForStillFrames(s.page);
          });
          return s;
        });
      const closedOnShop = closedOn();
      /** Every frame until stopped: how far the open menu reaches over the page, and where the
       * conversation's words stand. */
      const sampleFrames = (page: Page) =>
        page.evaluate((answer) => {
          const frames: Array<{ reach: number; words: number }> = [];
          const words = [...document.querySelectorAll<HTMLElement>("p, span, div")].find(
            (element) => element.childElementCount === 0 && element.textContent === answer,
          )!;
          const inMenu = (x: number) =>
            document.elementFromPoint(x, 600)?.closest('[data-zerops-surface="sidebar-menu"]') !=
            null;
          const state = { on: true };
          (window as unknown as { peekFrames: typeof frames; peekState: typeof state }).peekFrames =
            frames;
          (window as unknown as { peekState: typeof state }).peekState = state;
          const tick = () => {
            let reach = 0;
            for (let x = 4; x < 700; x += 4) if (inMenu(x)) reach = x;
            frames.push({ reach, words: words.getBoundingClientRect().left });
            if (state.on) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, ANSWER_TEXT);
      const stopFrames = (page: Page) =>
        page.evaluate(() => {
          const w = window as unknown as {
            peekFrames: Array<{ reach: number; words: number }>;
            peekState: { on: boolean };
          };
          w.peekState.on = false;
          return w.peekFrames;
        });
      const restOnRail = (page: Page) =>
        Effect.promise(async () => {
          await page.mouse.move(36, 600, { steps: 4 });
          await waitForStillFrames(page);
        });

      scenarioSuite((it) => {
        // The owner's ask for a smooth peek did not trade away a click: resting on a face and
        // clicking it opened whatever row of the peek had slid under the pointer.
        it.effect("a rest on a rail face and a click opens that Mate, with no peek over it", () =>
          Effect.gen(function* () {
            const s = yield* closedOn({ mate: "Bea", app: "Notes" });
            const BEA = '[data-zerops-surface="sidebar-rail-mate"][aria-label^="Bea, Notes"]';
            const opened = yield* Effect.promise(async () => {
              const face = (await s.page.$(BEA))!;
              const box = (await face.boundingBox())!;
              const x = box.x + box.width / 2;
              const y = box.y + box.height / 2;
              await s.page.mouse.move(x, y, { steps: 4 });
              await waitForStillFrames(s.page);
              await s.page.mouse.down();
              await s.page.mouse.up();
              await waitForStillFrames(s.page);
              return s.page.evaluate(
                (x, y, bea) => ({
                  current: document.querySelector(bea)?.getAttribute("aria-current"),
                  peeked:
                    document
                      .elementFromPoint(x + 200, y)
                      ?.closest('[data-zerops-surface="sidebar-menu"]') != null,
                }),
                x,
                y,
                BEA,
              );
            });
            expect(opened, "ASSERTION: Bea opens, and the menu stays in the rail").toEqual({
              current: "page",
              peeked: false,
            });
            yield* s.then.noExternalNetwork;
          }),
        );

        it.effect(
          "at rest the closed menu draws each project as a named pod, its faces inside",
          () =>
            Effect.gen(function* () {
              const s = yield* closedOnShop;
              const tiles = yield* Effect.promise(() =>
                s.page.evaluate(() =>
                  [
                    ...document.querySelectorAll<HTMLElement>(
                      '[data-zerops-surface="sidebar-rail-project"]',
                    ),
                  ].map((tile) => {
                    const box = tile.getBoundingClientRect();
                    const rail = tile
                      .closest('[data-zerops-surface="sidebar-rail"]')!
                      .getBoundingClientRect();
                    const nameBox = tile
                      .querySelector('[data-zerops-surface="sidebar-rail-name"]')
                      ?.getBoundingClientRect();
                    const inside = (inner: DOMRect | undefined) =>
                      inner !== undefined &&
                      inner.width > 0 &&
                      inner.left >= box.left &&
                      inner.right <= box.right &&
                      inner.top >= box.top &&
                      inner.bottom <= box.bottom;
                    return {
                      name: tile.querySelector('[data-zerops-surface="sidebar-rail-name"]')
                        ?.textContent,
                      // A tile, not a heading: it stands in the rail with air on either side.
                      tile: box.left > rail.left + 2 && box.right < rail.right - 2,
                      nameInside: inside(nameBox),
                      faces: [...tile.querySelectorAll("[data-mate-face-state]")].map((face) => {
                        const faceBox = face.getBoundingClientRect();
                        return inside(faceBox) && faceBox.bottom <= (nameBox?.top ?? box.bottom);
                      }),
                    };
                  }),
                ),
              );
              expect(
                tiles,
                "ASSERTION: Shop is a tile, its face over its name, both inside",
              ).toEqual([{ name: "Shop", tile: true, nameInside: true, faces: [true] }]);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "a pointer resting on the rail never reveals the open menu, and the conversation never moves",
          () =>
            Effect.gen(function* () {
              const s = yield* closedOnShop;
              yield* Effect.promise(() => sampleFrames(s.page));
              yield* restOnRail(s.page);
              yield* Effect.promise(async () => {
                await s.page.mouse.move(44, 900, { steps: 4 });
                await waitForStillFrames(s.page);
              });
              const frames = yield* Effect.promise(() => stopFrames(s.page));
              expect(
                Math.max(...frames.map((frame) => frame.reach)),
                `ASSERTION: the menu never stands out of the rail: ${frames.map((frame) => frame.reach).join(" ")}`,
              ).toBe(0);
              const words = frames.map((frame) => frame.words);
              expect(
                Math.max(...words) - Math.min(...words),
                `ASSERTION: the conversation never moves: ${words.join(" ")}`,
              ).toBeLessThanOrEqual(0.5);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "opening the menu from the rail's foot slides the conversation while the menu grows out of the rail",
          () =>
            Effect.gen(function* () {
              const s = yield* closedOnShop;
              yield* Effect.promise(() => sampleFrames(s.page));
              yield* Effect.promise(async () => {
                await s.page.click('[data-zerops-surface="sidebar-rail-open"]');
                await waitForStillFrames(s.page);
              });
              const frames = yield* Effect.promise(() => stopFrames(s.page));
              const words = frames.map((frame) => Math.round(frame.words));
              const seen = words.join(" ");
              expect(
                words.at(-1)! - words[0]!,
                `ASSERTION: the conversation slides right: ${seen}`,
              ).toBeGreaterThan(100);
              expect(
                words.filter((left) => left > words[0]! + 4 && left < words.at(-1)! - 4).length,
                `ASSERTION: it slides, not jumps: ${seen}`,
              ).toBeGreaterThanOrEqual(2);
              const reaches = frames.map((frame) => frame.reach);
              expect(
                reaches.filter((reach) => reach > reaches[0]! + 4 && reach < reaches.at(-1)! - 4)
                  .length,
                `ASSERTION: the menu grows through intermediate widths out of the rail: ${reaches.join(" ")}`,
              ).toBeGreaterThanOrEqual(2);
              expect(
                reaches.at(-1),
                `ASSERTION: the menu stands docked at its width: ${reaches.join(" ")}`,
              ).toBeGreaterThanOrEqual(420);
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });

    describe("Decision: a place's tag stands beside the time; the Mate's words keep their place.", () => {
      describe("B: a project's busy place on its menu row", () => {
        /** The project's row: where its words start, where its time ends, and its tag and name. */
        const rowReading = (page: Page) =>
          page.evaluate(() => {
            const box = [...document.querySelectorAll<HTMLElement>(".menu-row-box")].find((row) =>
              row.querySelector('[data-slot="row-title"]')?.textContent?.includes("Shop"),
            )!;
            const line = box.querySelector<HTMLElement>('[data-slot="row-line"]')!;
            // Where its first letter stands: a text's own box, never its line's padded one.
            const texts = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            let text = texts.nextNode();
            while (text !== null && text.textContent?.trim() === "") text = texts.nextNode();
            const words = document.createRange();
            words.selectNodeContents(text!);
            const first = words.getClientRects()[0]!;
            const tagElement = box.querySelector('[data-zerops-surface="sidebar-project-env-tag"]');
            const tag = tagElement?.getBoundingClientRect();
            const title = box.querySelector('[data-slot="row-title"]')!.getBoundingClientRect();
            const time = box
              .querySelector('[data-zerops-surface="sidebar-mate-time"]')!
              .getBoundingClientRect();
            return {
              words: first.left,
              wordsTop: first.top,
              time: { left: time.left, right: time.right },
              title: { right: title.right, middle: title.top + title.height / 2 },
              tag:
                tag === undefined
                  ? null
                  : {
                      says: tagElement!.getAttribute("aria-label"),
                      left: tag.left,
                      right: tag.right,
                      middle: tag.top + tag.height / 2,
                    },
            };
          });

        /** A reading in words, for an assertion's message. */
        const said = (reading: Awaited<ReturnType<typeof rowReading>>) =>
          [
            `words ${String(reading.words)},${String(reading.wordsTop)}`,
            `time ${String(reading.time.left)}–${String(reading.time.right)}`,
            `name ends ${String(reading.title.right)} mid ${String(reading.title.middle)}`,
            reading.tag === null
              ? "no tag"
              : `tag "${String(reading.tag.says)}" ${String(reading.tag.left)}–${String(reading.tag.right)} mid ${String(reading.tag.middle)}`,
          ].join(", ");

        scenarioSuite((it) => {
          // Run 2, S15: a stage being set up put a spinner chip before the Mate's quote on its
          // project's row, which pushed the quote 30 px aside, and back when it went.
          it.effect("a stage building moves neither the project row's words nor its time", () =>
            Effect.gen(function* () {
              const s = yield* menuScenario();
              yield* s.given.project("Ada", { mate: true, app: "Shop" });
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.signedIn;
              yield* s.menu.grouped("Ada", "Shop");
              yield* s.colleague.reports("Ada", {
                latestMessagePreview: {
                  role: "assistant",
                  text: "The basket now survives a reload.",
                },
              });
              yield* Effect.promise(async () => {
                await ownerMenu(s.page);
                await s.page.waitForFunction(() =>
                  [...document.querySelectorAll('[data-slot="row-line"]')].some((line) =>
                    line.textContent?.includes("The basket now survives a reload."),
                  ),
                );
                await waitForStillFrames(s.page);
              });
              const calm = yield* Effect.promise(() => rowReading(s.page));
              expect(calm.tag, "ASSERTION: a calm project's row shows no tag").toBeNull();
              // A stage is added and comes up, then builds: its tag comes, then changes its words.
              yield* s.stage("Shop-stage", "Shop");
              yield* s.menu.chip("coming up", 15_000);
              yield* Effect.promise(() => waitForStillFrames(s.page));
              const coming = yield* Effect.promise(() => rowReading(s.page));
              yield* s.colleague.builds("Shop-stage");
              yield* s.menu.chip("\\b(?:building|deploying|releasing)\\b", 15_000);
              yield* Effect.promise(() => waitForStillFrames(s.page));
              const building = yield* Effect.promise(() => rowReading(s.page));
              for (const busy of [coming, building]) {
                const seen = `calm ${said(calm)}; busy ${said(busy)}`;
                expect(
                  Math.abs(busy.words - calm.words) + Math.abs(busy.wordsTop - calm.wordsTop),
                  `ASSERTION: the words under the name keep their place: ${seen}`,
                ).toBeLessThanOrEqual(0.5);
                expect(
                  Math.abs(busy.time.right - calm.time.right),
                  `ASSERTION: the time keeps its place: ${seen}`,
                ).toBeLessThanOrEqual(0.5);
                const tag = busy.tag!;
                expect(
                  Math.abs(tag.middle - busy.title.middle),
                  `ASSERTION: the tag stands on the name's line: ${seen}`,
                ).toBeLessThanOrEqual(2);
                expect(
                  tag.left >= busy.title.right && tag.right <= busy.time.left,
                  `ASSERTION: the tag stands between the name and the time, over neither: ${seen}`,
                ).toBe(true);
              }
              yield* s.then.noExternalNetwork;
            }),
          );
        });
      });
    });

    describe("Decision: a reload paints nothing it takes back.", () => {
      describe("B: the menu after a reload on a Mate's conversation", () => {
        scenarioSuite((it) => {
          // Aleš, 2026-10-27: aiming at Jago opened Dara. A reload on a Mate's conversation drew its
          // folded project's row, then opened the project once the Mate was found, seconds later,
          // pushing every row below it by three rows.
          it.effect(
            "after a reload on a Mate's conversation, a row below its project never moves while that Mate is found",
            () =>
              Effect.gen(function* () {
                const s = yield* menuScenario();
                yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
                for (const name of ["Ada", "Bea", "Cy"])
                  yield* s.given.project(name, { mate: true, app: "Alpha Titan" });
                yield* s.given.project("Di", { mate: true, app: "Zulu" });
                yield* s.given.signedIn;
                yield* Effect.promise(() => ownerMenu(s.page));
                const frames = yield* Effect.promise(async () => {
                  const heading = '[data-zerops-surface="sidebar-project"][aria-expanded]';
                  const expanded = (value: "true" | "false") =>
                    s.page.waitForFunction(
                      (selector, value) =>
                        document.querySelector(selector)?.getAttribute("aria-expanded") === value,
                      {},
                      heading,
                      value,
                    );
                  await s.page.waitForSelector(heading);
                  if (
                    (await s.page.$eval(heading, (row) => row.getAttribute("aria-expanded"))) !==
                    "true"
                  )
                    await s.page.click(heading);
                  await expanded("true");
                  await waitForStillFrames(s.page);
                  // Ada's conversation open, and her project folded around it by its person.
                  const from = await s.page.evaluate(() => location.pathname);
                  await s.page.click("[data-zerops-kids] [data-zerops-row]");
                  await s.page.waitForFunction((from) => location.pathname !== from, {}, from);
                  await waitForStillFrames(s.page);
                  await s.page.click(heading);
                  await expanded("false");
                  await waitForStillFrames(s.page);
                  await s.page.evaluateOnNewDocument(recordRowBelow);
                  await s.page.reload({ waitUntil: "domcontentloaded" });
                  await s.page.waitForFunction(
                    () => (window as unknown as { belowDone?: boolean }).belowDone === true,
                  );
                  return s.page.evaluate(
                    () => (window as unknown as { belowFrames: BelowFrame[] }).belowFrames,
                  );
                });
                const said = frames
                  .map(
                    (frame) =>
                      `${frame.at}ms ${frame.where} expanded=${frame.expanded} current=${frame.current} kids=${frame.kids} below=${frame.below}`,
                  )
                  .join("; ");
                const tops = frames.flatMap((frame) => (frame.below === null ? [] : [frame.below]));
                expect(tops.length, `ASSERTION: the row below is drawn: ${said}`).toBeGreaterThan(
                  0,
                );
                expect(
                  frames.at(-1)?.current,
                  `ASSERTION: the folded project marks the conversation open in it once its Mate is found: ${said}`,
                ).toBe(true);
                expect(
                  Math.max(...tops) - Math.min(...tops),
                  `ASSERTION: the row below the project keeps its top from its first frame: ${said}`,
                ).toBe(0);
                yield* s.then.noExternalNetwork;
              }),
          );
        });
      });
    });
  });
});

/** One change of the menu after a reload: the first project's fold and the row below it. */
interface BelowFrame {
  readonly at: number;
  readonly where: "boot" | "app";
  readonly expanded: string | null;
  readonly kids: number;
  /** The first project's row marks the conversation open in it. */
  readonly current: boolean;
  /** The top of the project row below the first one, or null before it draws. */
  readonly below: number | null;
}

// Runs in every new document: each change of the first project and the row below it, until the
// menu has stood still for 90 frames with the open conversation's Mate found.
function recordRowBelow() {
  const frames: BelowFrame[] = [];
  const self = window as unknown as { belowFrames: BelowFrame[]; belowDone: boolean };
  self.belowFrames = frames;
  self.belowDone = false;
  let still = 0;
  const sample = () => {
    const boot = document.getElementById("boot-shell");
    const where: "boot" | "app" =
      boot !== null && !boot.hidden && boot.getBoundingClientRect().width > 0 ? "boot" : "app";
    const root =
      where === "boot"
        ? document.getElementById("boot-shell-menu")
        : document.querySelector('[data-sidebar="sidebar"]');
    const sections = [...(root?.querySelectorAll("section[data-zerops-group]") ?? [])].filter(
      (section) => section.getBoundingClientRect().height > 0,
    );
    const open = sections[0];
    const heading = open?.querySelector('[data-zerops-surface="sidebar-project"]') ?? null;
    const below = sections[1]?.getBoundingClientRect().top;
    const frame: BelowFrame = {
      at: Math.round(performance.now()),
      where,
      expanded: heading?.getAttribute("aria-expanded") ?? null,
      kids: open?.querySelectorAll("[data-zerops-kids] [data-zerops-row]").length ?? 0,
      current:
        heading?.getAttribute("aria-current") === "true" ||
        open?.querySelector('[data-zerops-kids] [aria-current="true"]') != null,
      below: below === undefined ? null : Math.round(below * 10) / 10,
    };
    const last = frames.at(-1);
    if (
      last === undefined ||
      last.where !== frame.where ||
      last.expanded !== frame.expanded ||
      last.kids !== frame.kids ||
      last.current !== frame.current ||
      last.below !== frame.below
    ) {
      frames.push(frame);
      still = 0;
    } else still += 1;
    if (where === "app" && frame.current && still > 90) self.belowDone = true;
    else requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}
