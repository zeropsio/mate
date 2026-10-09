import { composerLayout, composerStates } from "./composerLayout.ts";
import type { Page } from "puppeteer-core";
import { describe, expect, it } from "@effect/vitest";
import {
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  WS_METHODS,
  ConversationRow,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";
import { menuScenario } from "../b-menu/dsl.ts";
import { reportConversation } from "../b-menu/fake.ts";

// Use the actual resize control so every witness has the owner's menu width.
async function ownerMenu(page: Page) {
  const rail = (await page.$('[data-sidebar="rail"]'))!;
  const box = (await rail.boundingBox())!;
  const width = await page.$eval(
    '[data-sidebar="sidebar"]',
    (element) => element.getBoundingClientRect().width,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect().width === 435,
  );
}

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
                  const s = yield* createScenario([installArea]);
                  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
                  const bytes = Buffer.from(
                    yield* Effect.promise(() =>
                      s.page.evaluate(({ width, height }) => {
                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d")!;
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(0, 0, width, height);
                        ctx.fillStyle = "#e66432";
                        ctx.beginPath();
                        ctx.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.fillStyle = "#000000";
                        ctx.font = "16px sans-serif";
                        ctx.fillText("Picture proportions", 4, 20);
                        return canvas.toDataURL("image/png").split(",")[1]!;
                      }, shape),
                    ),
                    "base64",
                  );
                  s.drivers.onMate.push((mate) => {
                    Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
                    Object.assign(mate.config.environment.capabilities, {
                      contentAddressedImages: true,
                    });
                    mate.rpcHandlers.unshift((request, socket) => {
                      if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
                      const input = Schema.decodeUnknownSync(AssetCreateUrlInput)(request.payload);
                      const relativeUrl = `/api/assets/objects/${"a".repeat(64)}/${input.preview ? "preview" : "original"}`;
                      mate.reply(
                        socket,
                        request.id,
                        Schema.encodeSync(AssetCreateUrlResult)({
                          representation: {
                            digest: "a".repeat(64),
                            relativeUrl,
                            mimeType: "image/png",
                            sizeBytes: bytes.length,
                            width: shape.width,
                            height: shape.height,
                          },
                          relativeUrl,
                          expiresAt: 0,
                          imageDimensions: { width: shape.width, height: shape.height },
                        }),
                      );
                      return true;
                    });
                    const handle = mate.handle;
                    mate.handle = (request) =>
                      request.url.pathname.includes("/api/assets/objects/")
                        ? Promise.resolve({ bytes, headers: { "content-type": "image/png" } })
                        : handle(request);
                  });
                  yield* s.given.project("Ada", { mate: true });
                  const chat = mateChat(s);
                  chat
                    .fixture()
                    .message("picture", "user", "[Picture 1]\nCheck proportions", "turn", {
                      attachments: [
                        {
                          type: "image",
                          id: "picture",
                          name: `${shape.name}.png`,
                          mimeType: "image/png",
                          sizeBytes: bytes.length,
                          width: shape.width,
                          height: shape.height,
                        },
                      ],
                    });
                  yield* s.given.signedIn;
                  yield* Effect.promise(() => ownerMenu(s.page));
                  yield* chat.when.open("Ada", "Check proportions");
                  yield* Effect.promise(async () => {
                    await s.page.click('button[aria-label="Open picture 1"]');
                    await s.page
                      .waitForFunction(
                        () => {
                          const image = document.querySelector<HTMLImageElement>(
                            '[role="dialog"] img[data-image-src]',
                          );
                          return (
                            image &&
                            image.naturalWidth > 0 &&
                            getComputedStyle(image).opacity === "1"
                          );
                        },
                        { timeout: 8000 },
                      )
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
                          { timeout: 8000 },
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
                            { timeout: 8000 },
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
              wire.message("work-ask", "user", "Inspect the build", "work-run");
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
                    { polling: "raf", timeout: 8000 },
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
              wire.tool(
                "work-first",
                "tool.completed",
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

    describe("Decision: restore the expected end of the list; no other menu changes.", () => {
      describe("B: list end spacing", () => {
        it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
          it.effect("the last project ends one regular row gap above the New project divider", () =>
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
                for (const toggle of await s.page.$$(
                  '[data-zerops-surface="sidebar-project-toggle"]',
                )) {
                  await toggle.click();
                }
                await s.page.waitForFunction(
                  () =>
                    document.querySelector('[data-zerops-surface="sidebar-project-rows"]') === null,
                );
                await s.page.waitForSelector('[data-zerops-surface="sidebar-new-project"]');
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
                  const divider = document
                    .querySelector('[data-zerops-surface="sidebar-new-project"]')!
                    .parentElement!.getBoundingClientRect().top;
                  const viewport = document
                    .querySelector('[data-sidebar="content"]')!
                    .closest('[data-slot="scroll-area-viewport"]')!;
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

    const ROW = '[data-zerops-surface="sidebar-mate"]';
    const ASK = "Keep the running row steady";
    type Witness = {
      failures: string[];
      initialClock: string | null | undefined;
      observer: MutationObserver;
    };

    describe("B: running row refresh", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
              const row = yield* Schema.decodeUnknownEffect(ConversationRow)({
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
                s.page.evaluate(
                  (selector, ask) => {
                    const row = document.querySelector<HTMLElement>(selector)!;
                    const initialHeight = row.getBoundingClientRect().height;
                    const initialClock = row.querySelector(".menu-clock")?.textContent;
                    const failures: string[] = [];
                    const sample = () => {
                      if (!row.isConnected) failures.push("row remounted");
                      if (row.querySelector('[data-zerops-surface="sidebar-mate-pending"]'))
                        failures.push("placeholder");
                      if (
                        !row
                          .querySelector('[data-zerops-surface="sidebar-mate-subject"]')
                          ?.textContent?.includes(ask)
                      )
                        failures.push("subject lost");
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
                  },
                  ROW,
                  ASK,
                ),
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
                  { timeout: 5_000 },
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
              yield* Effect.promise(async () => {
                const element = await s.page.$(ROW);
                await element!.screenshot({ path: "/tmp/sidebar-running-flicker.png" });
              });
              yield* s.then.noReload;
            }),
        );
      });
    });
    describe("Decision: restore pre-regression behaviour; no test weakened; titles kept.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        for (const state of composerStates)
          it.effect(
            `the last row ends above the docked composer and history never paints below it (${state})`,
            () =>
              Effect.gen(function* () {
                const { s, chat } = yield* composerLayout(state);
                yield* Effect.promise(() => ownerMenu(s.page));

                const attached = () =>
                  Effect.promise(async () => {
                    const geometry = await s.page.evaluate(() => {
                      const front = document
                        .querySelector('[data-composer-banner-drawer] [data-slot="alert"]')!
                        .getBoundingClientRect();
                      const input = document
                        .querySelector('[data-slot="composer-shell"]')!
                        .getBoundingClientRect();
                      return {
                        gap: input.top - front.bottom,
                        noticeTop: front.top,
                        inputTop: input.top,
                      };
                    });
                    expect(
                      geometry.gap,
                      "ASSERTION: the front notice touches the composer without a gap",
                    ).toBeLessThanOrEqual(1);
                    expect(
                      geometry.noticeTop,
                      "ASSERTION: the notice is above the composer",
                    ).toBeLessThan(geometry.inputTop);
                  });
                if (state === "notice" || state === "stack") yield* attached();
                if (state === "stack") {
                  yield* chat.when.type("Keep this draft");
                  yield* chat.then.control("1 more notice");
                  yield* attached();
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

                if (state === "stack") {
                  yield* attached();
                  const stackGeometry = yield* Effect.promise(() =>
                    s.page.evaluate(() => {
                      const expanded = document
                        .querySelector("[data-composer-banner-stack-expanded-items]")!
                        .getBoundingClientRect();
                      const front = document
                        .querySelector('[data-composer-banner-drawer] [data-slot="alert"]')!
                        .getBoundingClientRect();
                      return {
                        height: expanded.height,
                        bottom: expanded.bottom,
                        frontTop: front.top,
                      };
                    }),
                  );
                  expect(
                    stackGeometry.height,
                    "ASSERTION: clicking the stacked edge opens the notices",
                  ).toBeGreaterThan(0);
                  expect(
                    stackGeometry.bottom,
                    "ASSERTION: expanded notices open above the attached front notice",
                  ).toBeLessThanOrEqual(stackGeometry.frontTop);
                }
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
                if (state === "stack") {
                  yield* chat.when.activateLast("Collapse notices");
                  yield* attached();
                }
                yield* s.then.noExternalNetwork;
              }),
          );
      });
    });
  });
});
