import { composerLayout } from "./composerLayout.ts";
import type { Page } from "puppeteer-core";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea, reportContainer } from "./fake.ts";
import type { EngineChatWire } from "./engine.ts";
import { TARGET_QUESTION } from "./wire.ts";
import { reportConversation } from "../b-menu/fake.ts";
import {
  slowAnimations,
  ownerMenu,
  RESETS_AT,
  readEnd,
  quoted,
  settledEnd,
} from "./ownerReportedLayout.ts";

describe("owner-reported layout regressions", () => {
  // Cyd: delayed HQ app detail inserted an old landing above the painted final answer,
  // dropping its words 79 px before the end follower glided back. The source stays unchanged.

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("the Chief's first message and composer enter the conversation without a jump", () =>
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
        yield* Effect.promise(() => s.page.waitForSelector('[role="textbox"]', { visible: true }));
        const question = "Look into my organization.";
        const answer = "I will look into your organization.";
        const mate = s.drivers.realMates.get("Chief")!;
        const answerArrives = yield* Deferred.make<void>();
        yield* mate.provider.turn([
          { kind: "wait", until: answerArrives },
          { kind: "say", text: answer },
        ]);
        yield* Effect.promise(async () => {
          await s.page.locator('[role="textbox"]').fill(question);
          await waitForStillFrames(s.page);
        });
        const playbackRate = 0.2;
        const slowed = yield* Effect.promise(() => slowAnimations(s.page, playbackRate));
        const trace = yield* Effect.promise(() =>
          s.page.evaluateHandle((playbackRate) => {
            const state = {
              active: true,
              frames: [] as Array<{
                at: number;
                composer: number;
                message: number | null;
                path: string;
                opacity: number;
              }>,
            };
            // Geometry belongs to this frame's clock, which CDP slows with the animations.
            // Convert it to display time; a delayed timer's wall clock misattributes frame gaps.
            const sample = (at: number) =>
              setTimeout(() => {
                const composer = document.querySelector('[data-slot="composer-shell"]');
                const message = document.querySelector('[data-message-role="user"]');
                let opacity = 1;
                for (let element = message; element !== null; element = element.parentElement)
                  opacity *= Number(getComputedStyle(element).opacity);
                if (composer)
                  state.frames.push({
                    at: at / playbackRate,
                    composer: composer.getBoundingClientRect().top,
                    message: message?.getBoundingClientRect().top ?? null,
                    path: location.pathname,
                    opacity,
                  });
                if (state.active) requestAnimationFrame(sample);
              }, 0);
            requestAnimationFrame(sample);
            return state;
          }, playbackRate),
        );
        // The conversation's route changes when the Mate's first frame naming the question reaches
        // the page. Held there, the draft keeps its route until its message has been sampled
        // fully faded in; the slowed fade's length against the Mate's speed would race otherwise.
        const promotion = mate.gate.holdFrames(
          (frame) => !frame.isBinary && Buffer.from(frame.bytes).toString().includes(question),
        );
        yield* Effect.addFinalizer(() => Effect.sync(promotion.release));
        yield* s.when.conversation.sends(question);
        expect((yield* mate.provider.received).input.input).toBe(question);
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (state) =>
              state.frames.some(
                (frame) =>
                  frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
              ),
            { polling: "raf" },
            trace,
          ),
        );
        promotion.release();
        // The answer is real server data arriving after the saved conversation's first paint.
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (state) =>
              state.frames.some(
                (frame) =>
                  !frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
              ),
            { polling: "raf" },
            trace,
          ),
        );
        yield* Deferred.succeed(answerArrives, undefined);
        yield* s.then.conversation.showsMessage(answer);
        yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 24 }));
        const frames = yield* Effect.promise(() =>
          trace.evaluate((state) => {
            state.active = false;
            return state.frames;
          }),
        );
        yield* Effect.promise(() => trace.dispose());
        yield* Effect.promise(() => slowed.restore());
        const steps = (read: (frame: (typeof frames)[number]) => number | null) =>
          frames.slice(1).flatMap((frame, index) => {
            const previous = frames[index]!;
            const [to, from] = [read(frame), read(previous)];
            return to === null || from === null
              ? []
              : [(Math.abs(to - from) * (1000 / 60)) / Math.max(1000 / 60, frame.at - previous.at)];
          });
        const draftVisible = frames.filter(
          (frame) =>
            frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
        );
        const savedVisible = frames.filter(
          (frame) =>
            !frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
        );
        expect(
          draftVisible.length,
          "ASSERTION: the draft's message is visibly sampled",
        ).toBeGreaterThan(0);
        expect(
          savedVisible.length,
          "ASSERTION: the saved conversation's message is visibly sampled",
        ).toBeGreaterThan(0);
        const firstMessageLine = draftVisible.at(-1)!.message!;
        const promotionShift = Math.max(
          ...savedVisible.map((frame) => Math.abs(frame.message! - firstMessageLine)),
        );
        yield* Effect.log("CHIEF GEOMETRY", {
          firstMessageLine,
          promotionShift,
          composerStep: Math.max(0, ...steps((frame) => frame.composer)),
        });
        expect(
          promotionShift,
          "ASSERTION: promotion keeps the Chief's first message on its visible line",
        ).toBeLessThanOrEqual(1);
        if (process.env.MATE_LAYOUT_EVIDENCE)
          yield* Effect.promise(() =>
            s.page.screenshot({
              path: `${process.env.MATE_LAYOUT_EVIDENCE}/chief-first-send-full.png`,
            }),
          );
        expect(
          frames.length,
          "ASSERTION: the first send is sampled through its docking",
        ).toBeGreaterThan(10);
        expect(
          Math.max(0, ...steps((frame) => frame.composer)),
          "ASSERTION: the Chief's composer docks by a glide, never a jump",
        ).toBeLessThan(60);
        expect(
          Math.max(0, ...steps((frame) => frame.message)),
          "ASSERTION: the Chief's first message settles by a glide, never a jump",
        ).toBeLessThan(60);
        yield* s.then.noExternalNetwork;
      }),
    );
  });

  describe("Decision: geometry relations only; no style pins.", () => {
    describe("Decision: recovery results float as toasts; the docked footer is clear above the card.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect(
          "a real Mate's recovery action stays fully inside its toast and the viewport",
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([], { mate: "real" });
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Wren", { mate: true });
              yield* s.given.project("Sage", { mate: true });
              const chat = mateChat(s);
              yield* s.given.signedIn;
              yield* s.when.menu.opensMate("Wren");
              yield* s.then.conversation.appears;
              yield* s.drivers.realMates
                .get("Wren")!
                .provider.turn([{ kind: "say", text: "Keep Wren's history" }]);
              yield* s.when.conversation.sends("Keep this conversation");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    document
                      .querySelector(
                        `[data-timeline-thread="${location.pathname.slice(1).replace("/", ":")}"]`,
                      )
                      ?.textContent?.includes("Keep Wren's history"),
                  { polling: "raf" },
                ),
              );
              yield* Effect.promise(() =>
                s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
                  polling: "raf",
                }),
              );
              const wrenPath = new URL(s.page.url()).pathname;
              yield* s.when.menu.opensMate("Sage");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (path) => location.pathname !== path,
                  { polling: "raf" },
                  wrenPath,
                ),
              );
              yield* s.then.conversation.appears;
              yield* s.drivers.realMates
                .get("Sage")!
                .provider.turn([{ kind: "say", text: "Keep Sage's history" }]);
              yield* s.when.conversation.sends("Keep Sage's conversation");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    document
                      .querySelector(
                        `[data-timeline-thread="${location.pathname.slice(1).replace("/", ":")}"]`,
                      )
                      ?.textContent?.includes("Keep Sage's history"),
                  { polling: "raf" },
                ),
              );
              yield* Effect.promise(() =>
                s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
                  polling: "raf",
                }),
              );
              const sagePath = new URL(s.page.url()).pathname;
              yield* s.when.menu.opensMate("Wren");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (path) => location.pathname === path,
                  { polling: "raf" },
                  wrenPath,
                ),
              );
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    document
                      .querySelector(
                        `[data-timeline-thread="${location.pathname.slice(1).replace("/", ":")}"]`,
                      )
                      ?.textContent?.includes("Keep Wren's history"),
                  { polling: "raf" },
                ),
              );
              yield* Effect.promise(() => ownerMenu(s.page));
              s.drivers.zerops.writes.autoComplete = false;
              let processId: string | undefined;
              s.drivers.zerops.handlers.unshift(async (request) => {
                if (
                  request.method !== "PUT" ||
                  !request.url.pathname.endsWith("/service-stack/service-Wren/start")
                )
                  return undefined;
                processId = s.drivers.zerops.writes.start("Wren", "stack.start", ["service-Wren"]);
                return { body: { id: processId } };
              });
              reportContainer(s.drivers, "Wren", "STOPPED");
              yield* Effect.promise(() => s.drivers.realMates.get("Wren")!.server.stop());
              yield* chat.then.control("Start");
              yield* chat.when.press("Start");
              yield* chat.then.text("Zerops accepted the start. Its outcome is not confirmed yet.");
              // Stretch the existing finite animation so the first arrival is a reproducible witness,
              // rather than measuring only after an offscreen entry has finished.
              const motion = yield* Effect.promise(() => slowAnimations(s.page, 0.05));
              let restored = false;
              yield* Effect.addFinalizer(() =>
                restored ? Effect.void : Effect.promise(() => motion.restore()),
              );
              yield* s.when.menu.opensMate("Sage");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (path) => location.pathname === path,
                  { polling: "raf" },
                  sagePath,
                ),
              );
              const arrives = (text: string) =>
                Effect.promise(() =>
                  s.page.waitForFunction(
                    (text) =>
                      document
                        .querySelector('[data-slot="toast-viewport"]')
                        ?.textContent?.includes(text),
                    { polling: "raf" },
                    text,
                  ),
                );
              const actionFits = () =>
                Effect.promise(async () => {
                  const geometry = await s.page.evaluate(() => {
                    const action = document.querySelector(
                      '[data-slot="toast-action"][data-recovery-request]',
                    )!;
                    const box = (element: Element) => {
                      const { top, bottom, left, right, width, height } =
                        element.getBoundingClientRect();
                      return { top, bottom, left, right, width, height };
                    };
                    return {
                      action: box(action),
                      toast: box(action.closest("[data-position]")!),
                      viewport: { top: 0, left: 0, right: innerWidth, bottom: innerHeight },
                    };
                  });
                  expect(geometry.action.width).toBeGreaterThan(0);
                  expect(geometry.action.height).toBeGreaterThan(0);
                  for (const [name, container] of Object.entries({
                    toast: geometry.toast,
                    viewport: geometry.viewport,
                  })) {
                    for (const edge of ["top", "left"] as const)
                      expect(
                        geometry.action[edge],
                        `ASSERTION: the recovery action's ${edge} is inside the ${name}`,
                      ).toBeGreaterThanOrEqual(container[edge]);
                    for (const edge of ["bottom", "right"] as const)
                      expect(
                        geometry.action[edge],
                        `ASSERTION: the recovery action's ${edge} is inside the ${name}`,
                      ).toBeLessThanOrEqual(container[edge]);
                  }
                });
              yield* arrives("Wren: Zerops accepted the start.");
              yield* actionFits();
              expect(processId).toBeDefined();
              s.drivers.zerops.writes.transition(
                processId!,
                "FAILED",
                "The start was refused by the container.",
              );
              yield* arrives("Wren: Start failed.");
              yield* actionFits();
              yield* Effect.promise(() => motion.restore());
              restored = true;
              for (const width of [1786, 1280, 435]) {
                yield* Effect.promise(() => s.page.setViewport({ width, height: 1000 }));
                yield* Effect.promise(() =>
                  waitForStillFrames(s.page, { selector: '[data-slot="toast-viewport"]' }),
                );
                yield* actionFits();
                const evidence = process.env.MATE_RECOVERY_EVIDENCE;
                if (evidence && width === 1786) {
                  yield* Effect.promise(() => s.page.screenshot({ path: `${evidence}-full.png` }));
                  yield* Effect.promise(() =>
                    s.page.screenshot({
                      path: `${evidence}-toast.png`,
                      clip: { x: 1380, y: 85, width: 400, height: 130 },
                    }),
                  );
                }
              }
              yield* s.then.noExternalNetwork;
            }),
        );

        const frame = (page: Page) =>
          page.evaluate(() => {
            const box = (selector: string) => {
              const { top, bottom, left, right } = document
                .querySelector(selector)!
                .getBoundingClientRect();
              return { top, bottom, left, right };
            };
            return {
              window: innerHeight,
              footer: box("[data-chat-composer-overlay]"),
              card: box('[data-slot="composer-shell"]'),
              conversation: box(".timeline-legend-list"),
              // The column's side gutter: the docked footer's inline inset around the card.
              gutter: parseFloat(
                getComputedStyle(document.querySelector("[data-chat-composer-overlay] > div")!)
                  .paddingLeft,
              ),
            };
          });

        // Owner, 2026-10-09: "a huge space at the bottom, cutting deeply into the chat".
        it.effect("the conversation shows right up to the composer card's top edge", () =>
          Effect.gen(function* () {
            const { s } = yield* composerLayout("plain");
            yield* Effect.promise(() => ownerMenu(s.page));
            const list = (yield* Effect.promise(() => s.page.$(".timeline-legend-list")))!;
            yield* Effect.promise(async () => {
              const bounds = (await list.boundingBox())!;
              await s.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
              await s.page.mouse.wheel({ deltaY: -350 });
              await s.page.waitForFunction(
                () => !document.querySelector("[data-timeline-follows-end]"),
                { polling: "raf" },
              );
            });
            // The two pixel rows just above the card's top edge, across the card.
            const showsThrough = () =>
              Effect.promise(async () => {
                const { card } = await frame(s.page);
                const clip = {
                  x: Math.ceil(card.left),
                  y: Math.floor(card.top) - 2,
                  width: Math.floor(card.right) - Math.ceil(card.left),
                  height: 2,
                };
                const visible = await s.page.screenshot({ clip });
                await list.evaluate((node) => {
                  (node as HTMLElement).style.visibility = "hidden";
                });
                const hidden = await s.page.screenshot({ clip });
                await list.evaluate((node) => {
                  (node as HTMLElement).style.visibility = "";
                });
                return Buffer.compare(visible, hidden) !== 0;
              });
            // Step a line's height in small moves so text, not a gap between lines, passes the edge.
            let seen = false;
            for (let step = 0; step < 12 && !seen; step++) {
              seen = yield* showsThrough();
              if (!seen)
                yield* Effect.promise(() =>
                  list.evaluate((node) => {
                    node.scrollTop -= 5;
                  }),
                );
            }
            expect(
              seen,
              "ASSERTION: the conversation paints right up to the composer card's top edge",
            ).toBe(true);
            yield* s.then.noExternalNetwork;
          }),
        );
        it.effect(
          "the conversation runs to the window's bottom and a recovery result arriving moves neither the composer nor the conversation",
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              yield* s.given.project("Ada", { mate: true });
              yield* s.given.project("Wren", { mate: true });
              const chat = mateChat(s);
              const ada = chat.fixture("Ada");
              ada.history("Read this conversation");
              for (let i = 0; i < 6; i++) ada.exchange(`Question ${i}`, `Answer ${i}`);
              const wren = chat.fixture("Wren");
              wren.history();
              s.drivers.zerops.writes.autoComplete = false;
              let processId: string | undefined;
              s.drivers.zerops.handlers.unshift(async (request) => {
                if (
                  request.method !== "PUT" ||
                  !request.url.pathname.endsWith("/service-stack/service-Wren/start")
                )
                  return undefined;
                processId = s.drivers.zerops.writes.start("Wren", "stack.start", ["service-Wren"]);
                return { body: { id: processId } };
              });
              yield* s.given.signedIn;
              yield* chat.when.open("Ada", "Question 5");
              yield* chat.then.text("Answer 5");
              yield* Effect.promise(() => ownerMenu(s.page));
              const quiet = yield* Effect.promise(() => frame(s.page));
              expect(
                quiet.footer.bottom,
                "ASSERTION: nothing is laid out under the conversation",
              ).toBe(quiet.window);
              expect(
                quiet.window - quiet.card.bottom,
                "ASSERTION: the card sits one gutter above the window's bottom",
              ).toBe(quiet.gutter);

              yield* chat.when.open("Wren");
              reportContainer(s.drivers, "Wren", "STOPPED");
              wren.disconnect();
              yield* chat.when.press("Start");
              yield* chat.then.text("Zerops accepted the start. Its outcome is not confirmed yet.");
              yield* chat.when.open("Ada", "Question 5");
              yield* chat.then.text("Answer 5");
              const toast = (text: string) =>
                Effect.promise(() =>
                  s.page.waitForFunction(
                    (wanted) =>
                      document
                        .querySelector('[data-slot="toast-viewport"]')
                        ?.textContent?.includes(wanted),
                    {},
                    text,
                  ),
                );
              yield* toast("Wren: Zerops accepted the start.");
              const shown = yield* Effect.promise(() => frame(s.page));
              expect(processId).toBeDefined();
              s.drivers.zerops.writes.transition(
                processId!,
                "FAILED",
                "The start was refused by the container.",
              );
              yield* toast("Start failed.");
              const changed = yield* Effect.promise(() => frame(s.page));
              for (const after of [shown, changed]) {
                expect(
                  after.card,
                  "ASSERTION: a recovery result does not move the composer",
                ).toEqual(quiet.card);
                expect(
                  after.conversation,
                  "ASSERTION: a recovery result does not shrink the conversation",
                ).toEqual(quiet.conversation);
              }
              yield* s.then.noExternalNetwork;
            }),
        );

        // Owner, 2026-10-09: "it doesn't go to the top edge either". Paint, not hit-testing:
        // the docked footer ignores the pointer, so only pixels can tell its band apart.
        // Nothing painting below the card is "history does not paint through the composer footer".
      });
    });

    describe("Decision: the composer is its own group; the conversation's end stands clear of it.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        // Owner, 2026-10-10: "last message way too close to composer" (a person's message 18 px
        // above the card), and "in some cases, at least previously, some stuff went even into the
        // composer (like working card when it had helpers etc)". A question the run waits on is
        // left out: its ask stands over the conversation's end without moving it ("a question
        // opening in the composer and its answer never move the conversation"), and the person
        // scrolls clear of it ("a question the run waits on never hides the agent's last words").
        const ends: ReadonlyArray<{
          readonly state: string;
          readonly arrange: (
            chat: ReturnType<typeof mateChat>,
            engine: EngineChatWire["engine"],
          ) => Effect.Effect<
            void,
            Effect.Error<
              ReturnType<
                | ReturnType<typeof mateChat>["then"]["text"]
                | ReturnType<typeof mateChat>["when"]["send"]
              >
            >,
            never
          >;
        }> = [
          { state: "the conversation at rest", arrange: () => Effect.void },
          {
            state: "a working card with its helpers running",
            arrange: (chat, engine) =>
              Effect.gen(function* () {
                const run = engine.personRun("Review the api and the web with two helpers");
                for (const [work, title] of [
                  ["helper-api", "Review the api"],
                  ["helper-web", "Review the web"],
                ])
                  engine.item(run, {
                    kind: "work",
                    work,
                    workKind: "helper",
                    status: "running",
                    title,
                  });
                engine.note(run, "Two helpers are reviewing the api and the web.");
                yield* chat.then.text("Two helpers are reviewing the api and the web.");
              }),
          },

          {
            state: "a finished run whose helpers wait at the conversation bottom",
            arrange: (chat, engine) =>
              Effect.gen(function* () {
                const run = engine.personRun("Review the api with a helper");
                engine.item(run, {
                  kind: "work",
                  work: "helper-api",
                  workKind: "helper",
                  status: "running",
                  title: "Review the api",
                });
                engine.note(run, "The helper is still reviewing the api.", { kind: "completed" });
                yield* chat.then.text("Still working in the background");
              }),
          },
          {
            state: "a finished run whose background command waits at the conversation bottom",
            arrange: (chat, engine) =>
              Effect.gen(function* () {
                const run = engine.personRun("Start the wait in the background");
                engine.item(run, {
                  kind: "work",
                  work: "session.w2",
                  workKind: "shell",
                  status: "running",
                  title: "Wait 45 seconds in the background, then print done",
                });
                engine.note(run, "The background wait hasn't printed yet.", { kind: "completed" });
                yield* chat.then.text("Still working in the background");
              }),
          },
          {
            state: "the usage limit holding a message",
            arrange: (chat, engine) =>
              Effect.gen(function* () {
                const driver = chat.fixture();
                const run = engine.personRun("Deploy the shop again");
                engine.note(run, "The deploy is halfway through.");
                engine.end(run, { kind: "usage-limit", resetsAt: Date.parse(RESETS_AT) });
                engine.pauseHolding(
                  Date.parse(RESETS_AT),
                  "Finish the deploy once the limit resets",
                );
                driver.usagePause = {
                  resetsAt: RESETS_AT,
                  window: "7-day",
                  held: 1,
                  pausedAt: "2026-10-08T10:00:00.000Z",
                  autoResume: false,
                };
                driver.shell();
                yield* chat.then.text("Finish the deploy once the limit resets");
              }),
          },
          {
            state: "a message steered into the running run",
            arrange: (chat, engine) =>
              Effect.gen(function* () {
                const run = engine.personRun("Check both pages");
                engine.note(run, "Checking the first page now.");
                yield* chat.then.text("Checking the first page now.");
                yield* chat.when.send("also tell me the page title");
                yield* chat.then.text("also tell me the page title");
              }),
          },
        ];
        for (const { state, arrange } of ends)
          it.effect(
            `the conversation's last row ends clear of the composer card, farther from it than the rows of its turn stand apart (${state})`,
            () =>
              Effect.gen(function* () {
                const s = yield* createScenario([installArea]);
                yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
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
                yield* s.given.signedIn;
                yield* chat.when.open();
                yield* chat.then.text("The existing conversation is still here");
                yield* Effect.promise(() => ownerMenu(s.page));
                const wire = chat.fixture().wire;
                yield* arrange(chat, wire.engine);
                // This witness measures spacing at the end; following arrivals has its own owner.
                yield* Effect.promise(async () => {
                  await waitForStillFrames(s.page);
                  const list = (await s.page.$(".timeline-legend-list"))!;
                  const box = (await list.boundingBox())!;
                  await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await s.page.mouse.wheel({ deltaY: 10000 });
                });
                const end = yield* Effect.promise(() => settledEnd(s.page));
                yield* Effect.promise(async () => {
                  if (process.env.MATE_LAYOUT_EVIDENCE)
                    await s.page.screenshot({
                      path: `${process.env.MATE_LAYOUT_EVIDENCE}/end-${state.replaceAll(" ", "-")}.png`,
                      clip: { x: 435, y: 500, width: 1786 - 435, height: 500 },
                    });
                });
                const seen = quoted(end);
                expect(
                  end.last.bottom,
                  `ASSERTION: no part of the last row reaches into the composer: ${seen}`,
                ).toBeLessThanOrEqual(end.composerTop);
                expect(
                  end.endGap,
                  `ASSERTION: the composer stands apart as its own group: ${seen}`,
                ).toBeGreaterThan(end.rowGap);
                yield* s.then.noExternalNetwork;
              }),
          );
      });
    });

    describe("Decision: an ask never moves the conversation, and never hides its end: the person scrolls clear of it.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        // Owner, 2026-10-10: the question in the composer covered the last 120–180 px of the run's
        // card, the agent's last words with it, and no scroll brought them out from under it.
        const asks: ReadonlyArray<{
          readonly title: string;
          readonly shows: string;
          readonly answer: string;
          readonly raise: (engine: EngineChatWire["engine"], run: string) => void;
        }> = [
          {
            title:
              "a question the run waits on never hides the agent's last words: the conversation scrolls clear of the question",
            shows: "Which environment should I inspect?",
            answer: "Staging",
            raise: (engine, run) =>
              engine.ask(
                { kind: "question", questions: [TARGET_QUESTION], dismissible: false },
                { runId: run },
              ),
          },
          {
            title:
              "an approval the run waits on never hides the agent's last words: the conversation scrolls clear of the approval",
            shows: "vp run build",
            answer: "Approve",
            raise: (engine, run) =>
              engine.ask(
                { kind: "approval", requestKind: "command", detail: "vp run build" },
                { runId: run },
              ),
          },
        ];
        const LAST_WORDS = "Step 8: your choice of format.";
        /** Where the agent's last words stand on screen, each frame, until `stop`. */
        const traceLastWords = (page: Page) =>
          page.evaluate((lastWords) => {
            const frames: Array<number | null> = [];
            const state = { active: true };
            const sample = () => {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let top: number | null = null;
              while (walker.nextNode()) {
                const box = walker.currentNode.textContent?.includes(lastWords)
                  ? walker.currentNode.parentElement?.getBoundingClientRect()
                  : undefined;
                if (box && box.height > 0) top = box.top;
              }
              frames.push(top);
              if (state.active) requestAnimationFrame(sample);
            };
            (window as unknown as { lastWordsTrace: unknown }).lastWordsTrace = { frames, state };
            sample();
          }, LAST_WORDS);
        const stopLastWords = (page: Page) =>
          waitForStillFrames(page, { stillFrames: 24 }).then(() =>
            page.evaluate(() => {
              const held = (
                window as unknown as {
                  lastWordsTrace: { frames: Array<number | null>; state: { active: boolean } };
                }
              ).lastWordsTrace;
              held.state.active = false;
              return held.frames;
            }),
          );
        for (const { title, shows, answer, raise } of asks)
          it.effect(title, () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
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
              yield* s.given.signedIn;
              yield* chat.when.open();
              yield* chat.then.text("The existing conversation is still here");
              yield* Effect.promise(() => ownerMenu(s.page));
              const wire = chat.fixture().wire;
              const engine = wire.engine;
              // The agent works on after the answer, as Milo did: the run neither ends nor settles.
              engine.onAnswer.splice(0, engine.onAnswer.length, (request) => {
                engine.note(request.runId, "Going on with what you chose.");
              });
              const run = engine.personRun("Lay out the summary for me");
              engine.note(run, LAST_WORDS);
              yield* chat.then.text(LAST_WORDS);
              raise(engine, run);
              yield* chat.then.text(shows);
              yield* Effect.promise(() => waitForStillFrames(s.page));
              // The person scrolls down as far as the conversation goes.
              yield* Effect.promise(async () => {
                const list = (await s.page.$(".timeline-legend-list"))!;
                const bounds = (await list.boundingBox())!;
                await s.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
                for (let wheel = 0; wheel < 4; wheel++) {
                  await s.page.mouse.wheel({ deltaY: 400 });
                  await waitForStillFrames(s.page);
                }
                await waitForStillFrames(s.page);
              });
              const end = yield* Effect.promise(() => s.page.evaluate(readEnd));
              yield* Effect.promise(async () => {
                if (process.env.MATE_LAYOUT_EVIDENCE)
                  await s.page.screenshot({
                    path: `${process.env.MATE_LAYOUT_EVIDENCE}/ask-${answer}.png`,
                    clip: { x: 435, y: 400, width: 1786 - 435, height: 600 },
                  });
              });
              const seen = quoted(end);
              expect(
                end.last.text,
                `ASSERTION: the conversation's last row is the run's card: ${seen}`,
              ).toContain(LAST_WORDS);
              expect(
                end.last.bottom,
                `ASSERTION: scrolled down, the run's card ends fully above what the agent asks: ${seen}`,
              ).toBeLessThanOrEqual(end.composerTop);

              // The answer closes it: the conversation comes back down by a glide, never a cut.
              yield* Effect.promise(() => traceLastWords(s.page));
              yield* chat.when.click(answer);
              yield* chat.then.text("Going on with what you chose.");
              const frames = (yield* Effect.promise(() => stopLastWords(s.page))).filter(
                (top): top is number => top !== null,
              );
              expect(frames.length, "ASSERTION: the answer was sampled").toBeGreaterThan(10);
              expect(
                Math.max(...frames.slice(1).map((top, index) => Math.abs(top - frames[index]!))),
                "ASSERTION: the conversation never jumps as the answer closes what was asked",
              ).toBeLessThan(60);
              yield* s.then.noExternalNetwork;
            }),
          );
      });
    });

    describe("Decision: what the agent asks opens with the conversation's end in sight above it.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        // Engine final run, C1 and C9 (light and dark): the question and the secret drawer opened
        // over the person's message and the run's card, and only a scroll brought them out.
        const asks: ReadonlyArray<{
          readonly ask: string;
          readonly shows: string;
          readonly raise: (engine: EngineChatWire["engine"], run: string) => void;
        }> = [
          {
            ask: "question",
            shows: "Which environment should I inspect?",
            raise: (engine, run) =>
              engine.ask(
                { kind: "question", questions: [TARGET_QUESTION], dismissible: false },
                { runId: run },
              ),
          },
          {
            ask: "secret",
            shows: "Goes to this project's vault for every app, never into this chat.",
            raise: (engine, run) =>
              engine.ask(
                {
                  kind: "vault",
                  key: "STRIPE_SECRET_KEY",
                  label: "Stripe secret key",
                  scope: { kind: "shared" },
                  sensitive: true,
                  reason: "to take card payments",
                },
                { runId: run },
              ),
          },
        ];
        const MESSAGE = "Lay out the summary for me";
        const LAST_WORDS = "Step 8: your choice of format.";
        it.effect(
          "an open question or secret panel never covers the person's last message or the run card",
          () =>
            Effect.gen(function* () {
              for (const { ask, shows, raise } of asks) {
                const s = yield* createScenario([installArea]);
                yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
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
                yield* s.given.signedIn;
                yield* chat.when.open();
                yield* Effect.promise(() => ownerMenu(s.page));
                const wire = chat.fixture().wire;
                const engine = wire.engine;
                const run = engine.personRun(MESSAGE);
                engine.note(run, LAST_WORDS);
                yield* chat.then.text(LAST_WORDS);
                yield* Effect.promise(() => waitForStillFrames(s.page));
                raise(engine, run);
                yield* chat.then.text(shows);
                // Nobody scrolls: what the person reads is what the ask opened on.
                yield* Effect.promise(() => waitForStillFrames(s.page));
                const end = yield* Effect.promise(() => s.page.evaluate(readEnd));
                const message = yield* Effect.promise(() =>
                  s.page.evaluate((text) => {
                    const bubble = [
                      ...document.querySelectorAll('[data-message-role="user"]'),
                    ].findLast((element) => element.textContent?.includes(text));
                    return bubble?.getBoundingClientRect().bottom ?? null;
                  }, MESSAGE),
                );
                yield* Effect.promise(async () => {
                  if (process.env.MATE_LAYOUT_EVIDENCE)
                    await s.page.screenshot({
                      path: `${process.env.MATE_LAYOUT_EVIDENCE}/ask-open-${ask}.png`,
                      clip: { x: 435, y: 300, width: 1786 - 435, height: 700 },
                    });
                });
                const seen = quoted({ ask, message, ...end });
                expect(message, `ASSERTION: the person's message is on the page: ${seen}`).not.toBe(
                  null,
                );
                expect(
                  message!,
                  `ASSERTION: the person's message stands above the ${ask}: ${seen}`,
                ).toBeLessThanOrEqual(end.composerTop);
                expect(
                  end.last.text,
                  `ASSERTION: the conversation's last row is the run's card: ${seen}`,
                ).toContain(LAST_WORDS);
                expect(
                  end.last.bottom,
                  `ASSERTION: the run's card ends above the ${ask}: ${seen}`,
                ).toBeLessThanOrEqual(end.composerTop);
                yield* s.then.noExternalNetwork;
              }
            }),
        );
      });
    });

    describe("Decision: what the composer's drawer says stands fully clear of the composer card.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        /**
         * Ada's conversation, then her link gone: the reconnect notice in the composer's drawer, its
         * last-known line quoting `lastWords`. Where its box and its painted card end, against the
         * composer card's top.
         */
        const reconnecting = (lastWords: string, evidence: string) =>
          Effect.gen(function* () {
            let unavailable = false;
            const s = yield* createScenario([
              installArea,
              (drivers) => {
                drivers.onMate.push((mate) => {
                  const handle = mate.handle;
                  const socket = mate.socket;
                  mate.handle = (request) =>
                    unavailable
                      ? { status: 503, body: { error: "Mate unavailable" } }
                      : handle(request);
                  mate.socket = (connection) => {
                    if (unavailable) connection.close(1012, "Mate unavailable");
                    else socket(connection);
                  };
                });
              },
            ]);
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* s.given.project("Ada", { mate: true });
            const chat = mateChat(s);
            const wire = chat.fixture();
            for (const round of [1, 2, 3])
              wire.exchange(
                `How did deploy ${round} go?`,
                "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                  12,
                ),
              );
            wire.exchange("And now?", "The existing conversation is still here");
            yield* reportConversation(s.drivers, "Ada", {
              latestMessagePreview: { role: "assistant", text: lastWords },
            });
            yield* s.given.signedIn;
            yield* chat.when.open();
            yield* chat.then.text("The existing conversation is still here");
            yield* Effect.promise(() => ownerMenu(s.page));
            unavailable = true;
            yield* s.drivers.links.get("Ada")!.close;
            wire.disconnect();
            yield* chat.then.text("Last known");
            yield* Effect.promise(() => waitForStillFrames(s.page));
            const geometry = yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const alert = document.querySelector<HTMLElement>(
                  '[data-composer-banner-drawer] [data-slot="alert"]',
                )!;
                const notice = alert.getBoundingClientRect();
                // The card the person sees is the notice's backdrop, drawn by its ::before: its own
                // box, short of its bottom inset and of the band its mask leaves transparent.
                const card = getComputedStyle(alert, "::before");
                const band = document.createElement("div");
                band.style.height = "var(--chat-composer-attachment-overlap, 0px)";
                alert.append(band);
                const masked =
                  card.maskImage !== "none" && card.maskImage !== ""
                    ? band.getBoundingClientRect().height
                    : 0;
                band.remove();
                const words = alert.querySelector('[data-slot="alert-description"]');
                const lines =
                  words === null
                    ? 0
                    : Math.round(
                        words.getBoundingClientRect().height /
                          parseFloat(getComputedStyle(words).lineHeight),
                      );
                return {
                  noticeTop: notice.top,
                  noticeBottom: notice.bottom,
                  paintedBottom: notice.bottom - (parseFloat(card.bottom) || 0) - masked,
                  lines,
                  cardTop: document
                    .querySelector('[data-slot="composer-shell"]')!
                    .getBoundingClientRect().top,
                };
              }),
            );
            yield* Effect.promise(async () => {
              if (process.env.MATE_LAYOUT_EVIDENCE)
                await s.page.screenshot({
                  path: `${process.env.MATE_LAYOUT_EVIDENCE}/${evidence}.png`,
                  clip: { x: 435, y: 600, width: 1786 - 435, height: 400 },
                });
            });
            return { s, geometry };
          });

        // Milo restarted mid-run, 2026-10-10: the reconnect notice ("Milo is reconnecting since
        // 10:23 AM. Last known …") stood with its bottom edge under the composer card.
        it.effect("a Mate's reconnect notice stands fully clear of the composer card", () =>
          Effect.gen(function* () {
            const { s, geometry } = yield* reconnecting(
              "The existing conversation is still here",
              "reconnect",
            );
            expect(
              geometry.noticeBottom,
              `ASSERTION: no part of the notice stands under the composer card: ${quoted(geometry)}`,
            ).toBeLessThanOrEqual(geometry.cardTop);
            yield* s.then.noExternalNetwork;
          }),
        );

        // Milo's stress run 5 (A +1:34): the restart notice's words wrapped to three lines and its
        // card ran on under the composer, its bottom edge hidden, though its box ended at the top.
        it.effect("the reconnect notice's card ends above the composer, whatever its words", () =>
          Effect.gen(function* () {
            const { s, geometry } = yield* reconnecting(
              "The second second-wave helper is back: note written, and its job printed " +
                '"second-wave" with exit code 0 (09:56:24 to 09:56:44). One left, and the first ' +
                "helper's note is in the shared folder beside the job's log, both read back.",
              "reconnect-long",
            );
            const seen = quoted(geometry);
            expect(
              geometry.lines,
              `ASSERTION: the notice's words wrap, as Milo's did: ${seen}`,
            ).toBeGreaterThanOrEqual(2);
            expect(
              geometry.paintedBottom,
              `ASSERTION: the notice's card ends above the composer card, its bottom edge in view: ${seen}`,
            ).toBeLessThan(geometry.cardTop);
            yield* s.then.noExternalNetwork;
          }),
        );
      });
    });

    describe("Decision: restore pre-regression behaviour; no test weakened; titles kept.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        for (const state of ["plain", "review"] as const)
          it.effect(
            `the last row ends above the docked composer and history never paints below it (${state})`,
            () =>
              Effect.gen(function* () {
                const { s } = yield* composerLayout(state);
                yield* Effect.promise(() => ownerMenu(s.page));

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
                const paint = yield* Effect.promise(() => s.page.evaluate(readEnd));
                expect(
                  paint.last.bottom,
                  `ASSERTION: history's bubbles, cards, pictures and text paint above the composer: ${quoted(paint)}`,
                ).toBeLessThanOrEqual(paint.composerTop);

                yield* Effect.promise(async () => {
                  if (process.env.MATE_LAYOUT_EVIDENCE) {
                    await s.page.screenshot({
                      path: `${process.env.MATE_LAYOUT_EVIDENCE}/${state}-full.png`,
                    });
                    const overlay = await s.page.$("[data-chat-composer-overlay]");
                    await overlay!.screenshot({
                      path: `${process.env.MATE_LAYOUT_EVIDENCE}/${state}-composer.png`,
                    });
                  }
                });
                yield* s.then.noExternalNetwork;
              }),
          );
      });
    });

    // Milo's stress run 4 (D): a sent message was born 62 px behind the composer for two frames,
    // and a multi-line send's glide took one 77 px step as the composer shrank back.
    describe("Decision: a sent message enters above the composer and glides; nothing jumps.", () => {
      interface SendFrame {
        /** When the frame was sampled (ms, the page's clock), after its paint. */
        readonly at: number;
        readonly composer: number;
        /** The sent message's bubble while it is drawn; null before it is. */
        readonly message: { readonly top: number; readonly bottom: number } | null;
        /** The top of the conversation's words before the send: what the send moves. */
        readonly conversation: number | null;
      }
      const EARLIER = "The existing conversation is still here";
      const startSendTrace = (page: Page, text: string) =>
        page.evaluate(
          (text, earlier) => {
            const frames: SendFrame[] = [];
            const state = { active: true };
            const drawn = (element: Element) => {
              let opacity = 1;
              for (let at: Element | null = element; at !== null; at = at.parentElement) {
                const style = getComputedStyle(at);
                if (style.visibility === "hidden" || style.display === "none") return false;
                opacity *= Number(style.opacity);
              }
              return opacity > 0.01;
            };
            const read = (): SendFrame | null => {
              const composer = document.querySelector('[data-slot="composer-shell"]');
              if (!composer) return null;
              const row = [
                ...document.querySelectorAll('[data-timeline-row-id][data-message-role="user"]'),
              ].find((each) => each.textContent?.includes(text));
              // The bubble: the first box inside the row that paints a fill.
              const bubble =
                row === undefined
                  ? undefined
                  : [row, ...row.querySelectorAll("*")].find((each) => {
                      const fill = getComputedStyle(each).backgroundColor;
                      return fill !== "transparent" && !/\/ 0\)$|, 0\)$/u.test(fill);
                    });
              const box = bubble?.getBoundingClientRect();
              const before = [...document.querySelectorAll("[data-timeline-row-id]")]
                .find((each) => each.textContent?.includes(earlier))
                ?.getBoundingClientRect();
              return {
                at: performance.now(),
                composer: composer.getBoundingClientRect().top,
                message:
                  bubble !== undefined && box !== undefined && box.height > 0 && drawn(bubble)
                    ? { top: box.top, bottom: box.bottom }
                    : null,
                conversation: before === undefined || before.height === 0 ? null : before.top,
              };
            };
            // After the frame's paint: a rAF alone reads before the list's own frame work.
            const sample = () =>
              setTimeout(() => {
                const frame = read();
                if (frame) frames.push(frame);
                if (state.active) requestAnimationFrame(sample);
              }, 0);
            (window as unknown as { sendTrace: unknown }).sendTrace = { frames, state };
            requestAnimationFrame(sample);
          },
          text,
          EARLIER,
        );
      const stopSendTrace = (page: Page) =>
        waitForStillFrames(page, { stillFrames: 24 }).then(() =>
          page.evaluate(() => {
            const held = (
              window as unknown as {
                sendTrace: { frames: SendFrame[]; state: { active: boolean } };
              }
            ).sendTrace;
            held.state.active = false;
            return held.frames;
          }),
        );

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        const LONG =
          "Live stress test 4D: what number is in this picture? Then open example.com in the browser, take a screenshot of the page and describe its layout in twenty lines: the background, the column, the icon at the top, each paragraph and the language it is written in, and the link at the end.";

        it.effect(
          "a message steered into the running run stands above its card, and the card's head has no step of 60 px or more in a frame",
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
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
              chat.fixture().exchange("And now?", EARLIER);
              yield* s.given.signedIn;
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* chat.when.open();
              yield* chat.then.text(EARLIER);
              const engine = chat.fixture().wire.engine;
              const run = engine.personRun("Check both pages");
              engine.session();
              engine.note(run, "Checking the first page now.");
              yield* chat.then.text("Checking the first page now.");
              const text = "also tell me the page title";
              yield* chat.when.send(text);
              yield* Effect.promise(() => waitForStillFrames(s.page));
              /** The running card's head and the steered message's row, each frame after its paint. */
              yield* Effect.promise(() =>
                s.page.evaluate((text) => {
                  const frames: Array<{ head: number | null; message: number | null }> = [];
                  const state = { active: true };
                  const sample = () =>
                    setTimeout(() => {
                      const head = [
                        ...document.querySelectorAll("[data-run-chat] > [data-run-head]"),
                      ].at(-1);
                      const message = [
                        ...document.querySelectorAll(
                          '[data-timeline-row-id][data-message-role="user"]',
                        ),
                      ].find((row) => row.textContent?.includes(text));
                      frames.push({
                        head: head?.getBoundingClientRect().top ?? null,
                        message: message?.getBoundingClientRect().top ?? null,
                      });
                      if (state.active) requestAnimationFrame(sample);
                    }, 0);
                  (window as unknown as { steerTrace: unknown }).steerTrace = { frames, state };
                  requestAnimationFrame(sample);
                }, text),
              );
              yield* chat.when.press("Send now");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (text) =>
                    [
                      ...document.querySelectorAll(
                        '[data-timeline-row-id][data-message-role="user"]',
                      ),
                    ].filter((row) => row.textContent?.includes(text)).length === 1,
                  { polling: "raf" },
                  text,
                ),
              );
              expect(
                yield* Effect.promise(() =>
                  s.page.$$eval(
                    '[data-timeline-row-id][data-message-role="user"]',
                    (rows, text) => rows.filter((row) => row.textContent?.includes(text)).length,
                    text,
                  ),
                ),
                "ASSERTION: the transcript shows the steered message once",
              ).toBe(1);
              const frames = yield* Effect.promise(() =>
                waitForStillFrames(s.page, { stillFrames: 24 }).then(() =>
                  s.page.evaluate(() => {
                    const held = (
                      window as unknown as {
                        steerTrace: {
                          frames: Array<{ head: number | null; message: number | null }>;
                          state: { active: boolean };
                        };
                      }
                    ).steerTrace;
                    held.state.active = false;
                    return held.frames;
                  }),
                ),
              );
              const last = frames.at(-1);
              expect(
                last?.message != null && last.head != null && last.message < last.head,
                `ASSERTION: the steered message stands above the running card's head: ${quoted({ last })}`,
              ).toBe(true);
              // Frame to frame, never by elapsed time: the jump came in the commit's own long frame
              // (86 ms), where a rate hid it.
              const steps = frames.slice(1).flatMap((frame, index) => {
                const before = frames[index]!;
                if (frame.head === null || before.head === null) return [];
                return [Math.abs(frame.head - before.head)];
              });
              expect(steps.length, "ASSERTION: the steer was sampled").toBeGreaterThan(10);
              expect(
                Math.max(0, ...steps),
                "ASSERTION: the running card's head glides, no frame's step 60 px or more",
              ).toBeLessThan(60);
              yield* s.then.noExternalNetwork;
            }),
        );
        it.effect.each([
          {
            from: "this composer, one line",
            typed: true,
            text: "Now describe it in twenty lines.",
          },
          { from: "this composer, several lines", typed: true, text: LONG },
          // Milo's stress run 6 (U1): a six-line draft's send stepped 223 px in one frame as the
          // composer shrank back to one line.
          {
            from: "a several-line draft",
            typed: true,
            text: [
              "Live stress test 6U: start two helpers, each with a job of its own,",
              "then a second wave once the first jobs end.",
              "Helper A runs sleep 90 and prints a-done.",
              "Helper B runs sleep 150 and prints b-done.",
              "You run your own sleep 60 and print mate-done.",
              "Give a table of every helper and job when all of them have reported.",
            ].join("\n"),
          },
          // The composer stays as it was: the end only grows (D2's send, a line long).
          { from: "another tab", typed: false, text: "Now describe the page in twenty lines." },
        ])(
          "a sent message is never drawn behind the composer, and its glide has no step of 60 px or more in a frame (from $from)",
          ({ typed, text }) =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
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
              yield* s.given.signedIn;
              yield* Effect.promise(() => ownerMenu(s.page));
              yield* chat.when.open();
              yield* chat.then.text("The existing conversation is still here");
              const wire = chat.fixture().wire;
              yield* Effect.promise(async () => {
                const cdp = await s.page.createCDPSession();
                await cdp.send("Emulation.setCPUThrottlingRate", { rate: 8 });
                await cdp.detach();
              });
              // The words typed and the composer at rest: the trace starts as the person sends.
              if (typed)
                yield* Effect.promise(async () => {
                  const input = await s.page.waitForSelector(
                    '[role="textbox"]:not([inert] *, [aria-hidden="true"] *)',
                  );
                  await input!.focus();
                  await s.page.keyboard.sendCharacter(text);
                  await waitForStillFrames(s.page);
                });
              yield* Effect.promise(() => startSendTrace(s.page, text.slice(0, 40)));
              yield* Effect.promise(() => waitForStillFrames(s.page));
              if (typed) yield* Effect.promise(() => s.page.keyboard.press("Enter"));
              else wire.engine.personRun(text);
              const frames = yield* Effect.promise(() => stopSendTrace(s.page));
              const shown = frames.filter((frame) => frame.message !== null);
              expect(shown.length, "ASSERTION: the sent message was sampled").toBeGreaterThan(10);
              const behind = shown.filter((frame) => frame.message!.bottom > frame.composer + 1);
              expect(
                behind,
                "ASSERTION: no frame draws the sent message behind the composer",
              ).toEqual([]);
              // By elapsed time, never per frame: a loaded machine draws a glide in fewer frames.
              const FRAME_MS = 1000 / 60;
              const steps = (of: (frame: SendFrame) => number | null) =>
                frames.slice(1).flatMap((frame, index) => {
                  const before = frames[index]!;
                  const [to, from] = [of(frame), of(before)];
                  if (to === null || from === null) return [];
                  return [
                    (Math.abs(to - from) * FRAME_MS) / Math.max(FRAME_MS, frame.at - before.at),
                  ];
                });
              expect(
                Math.max(0, ...steps((frame) => frame.message?.top ?? null)),
                "ASSERTION: the sent message glides, no frame's step 60 px or more",
              ).toBeLessThan(60);
              expect(
                Math.max(0, ...steps((frame) => frame.conversation)),
                "ASSERTION: the conversation glides with it, no frame's step 60 px or more",
              ).toBeLessThan(60);
              yield* s.then.noExternalNetwork;
            }),
        );
        // Milo's third stress run: a queued message sent into the running run ("Send now") moved
        // the conversation 105 px in one frame as it left its row under the card for one above it.
      });
    });
  });
});
