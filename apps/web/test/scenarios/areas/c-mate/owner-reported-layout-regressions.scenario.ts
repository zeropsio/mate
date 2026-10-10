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
import { installArea, installEngineArea, reportContainer } from "./fake.ts";
import { EngineChatWire } from "./engine.ts";
import { TARGET_QUESTION } from "./wire.ts";
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

/**
 * What the conversation's end paints, read from the page: each row's painted parts (its bubble or
 * card, its text, its pictures), never the row's own box, which carries its spacing.
 */
const RESETS_AT = "2099-10-10T00:00:00.000Z";

function readEnd() {
  type Box = { top: number; bottom: number };
  const paints = (element: Element, style: CSSStyleDeclaration) => {
    const alpha = (color: string) => color !== "transparent" && !/\/ 0\)$|, 0\)$/u.test(color);
    return (
      alpha(style.backgroundColor) ||
      style.backgroundImage !== "none" ||
      style.boxShadow !== "none" ||
      (["Top", "Right", "Bottom", "Left"] as const).some(
        (side) =>
          parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
          alpha(style.getPropertyValue(`border-${side.toLowerCase()}-color`)),
      ) ||
      ["IMG", "svg", "CANVAS", "VIDEO", "TEXTAREA", "INPUT"].includes(element.tagName)
    );
  };
  /** The union of what `root` paints, clipped by every box that clips it; null when nothing. */
  const painted = (root: Element): Box | null => {
    let top = Infinity;
    let bottom = -Infinity;
    const clipped = (element: Element, box: Box): Box | null => {
      let { top: from, bottom: to } = box;
      for (let at = element.parentElement; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.overflowY !== "visible" || style.overflowX !== "visible") {
          const clip = at.getBoundingClientRect();
          from = Math.max(from, clip.top);
          to = Math.min(to, clip.bottom);
        }
        if (at === root) break;
      }
      return to > from ? { top: from, bottom: to } : null;
    };
    const add = (element: Element, box: DOMRect | DOMRectReadOnly) => {
      if (box.width <= 1 || box.height <= 1) return;
      const seen = clipped(element, box);
      if (seen === null) return;
      top = Math.min(top, seen.top);
      bottom = Math.max(bottom, seen.bottom);
    };
    const walk = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || parseFloat(style.opacity) === 0) return;
      if (style.visibility !== "hidden") {
        if (paints(element, style)) add(element, element.getBoundingClientRect());
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const box of range.getClientRects()) add(element, box);
        }
      }
      if (element.tagName !== "svg") for (const child of element.children) walk(child);
    };
    walk(root);
    return top === Infinity ? null : { top, bottom };
  };
  // A card the list lays out in slices is one row: its slices touch.
  const rows: Array<Box & { text: string; person: boolean }> = [];
  for (const row of [...document.querySelectorAll(".timeline-legend-list [data-timeline-root]")]
    .flatMap((row) => {
      const box = painted(row);
      return box === null
        ? []
        : [
            {
              ...box,
              text: (row.textContent ?? "").slice(0, 80),
              person: row.querySelector('[data-message-role="user"]') !== null,
            },
          ];
    })
    .sort((a, b) => a.top - b.top)) {
    const previous = rows.at(-1);
    if (previous !== undefined && row.top - previous.bottom <= 1)
      rows[rows.length - 1] = {
        top: previous.top,
        bottom: Math.max(previous.bottom, row.bottom),
        text: previous.text + row.text,
        person: previous.person || row.person,
      };
    else rows.push(row);
  }
  rows.sort((a, b) => a.bottom - b.bottom);
  const last = rows.at(-1)!;
  const above = rows.at(-2)!;
  // The rows of the last turn: from the person's message that opened it. A message that opens its
  // turn has no row of its turn above it; its turn's rows will stand as the last turn's reply stood
  // under its message.
  const opener = rows.findLastIndex((row) => row.person);
  const opensTurn = opener === rows.length - 1;
  const previousOpener = rows.slice(0, -1).findLastIndex((row) => row.person);
  const rowGap = opensTurn
    ? rows[previousOpener + 1]!.top - rows[previousOpener]!.bottom
    : last.top - above.bottom;
  const composer = painted(document.querySelector("[data-chat-composer-overlay]")!)!;
  return {
    last,
    above,
    opensTurn,
    composerTop: composer.top,
    /** The last row's painted bottom against the composer's painted top. */
    endGap: composer.top - last.bottom,
    /** How far apart the rows of the last turn stand. */
    rowGap,
  };
}

/** A reading as an assertion message quotes it. */
const quoted = (reading: object) => JSON.stringify(reading);

/** The end of the conversation once nothing moves: the same reading for half a second. */
async function settledEnd(page: Page) {
  await page.waitForFunction(
    () => {
      const list = document.querySelector<HTMLElement>(".timeline-legend-list");
      return (
        list !== null &&
        !document.querySelector(
          '[data-conversation-opening]:not([data-conversation-opening="complete"])',
        ) &&
        !document.querySelector("[data-timeline-placing]") &&
        Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 2
      );
    },
    { polling: "raf", timeout: 8000 },
  );
  let previous = "";
  for (let still = 0; still < 10;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const now = JSON.stringify(await page.evaluate(readEnd));
    still = now === previous ? still + 1 : 0;
    previous = now;
  }
  return page.evaluate(readEnd);
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
    describe("Decision: recovery results float as toasts; the docked footer is clear above the card.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
              yield* chat.when.open("Ada", "Read this conversation");
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
              yield* chat.when.open("Ada", "Read this conversation");
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
                { polling: "raf", timeout: 8000 },
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
            state: "a run waiting for its helpers",
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
                yield* chat.then.text("Waiting for its helpers");
              }),
          },
          {
            state: "a run waiting for its background command",
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
                yield* chat.then.text("Waiting for its background command");
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
                const s = yield* createScenario([installEngineArea]);
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
                if (!(wire instanceof EngineChatWire))
                  throw new Error("This witness runs on the engine's wire");
                yield* arrange(chat, wire.engine);
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
        const stopLastWords = (page: Page, ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms)).then(() =>
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
              const s = yield* createScenario([installEngineArea]);
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
              if (!(wire instanceof EngineChatWire))
                throw new Error("This witness runs on the engine's wire");
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
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
              // The person scrolls down as far as the conversation goes.
              yield* Effect.promise(async () => {
                const list = (await s.page.$(".timeline-legend-list"))!;
                const bounds = (await list.boundingBox())!;
                await s.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
                for (let wheel = 0; wheel < 4; wheel++) {
                  await s.page.mouse.wheel({ deltaY: 400 });
                  await new Promise((resolve) => setTimeout(resolve, 120));
                }
                await new Promise((resolve) => setTimeout(resolve, 600));
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
              const frames = (yield* Effect.promise(() => stopLastWords(s.page, 800))).filter(
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
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 800)));
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

    // Milo's stress run 4 (2026-10-10, engine): at the usage limit the notice stood at the top of a
    // viewport-tall row with ~520 px blank under it, then scrolled half out of view; a message sent
    // while paused sat a viewport below it with no sign it was held.
    describe("Decision: the limit's notice ends the run's card; what waits for the reset sits under it.", () => {
      interface LimitFrame {
        /** When the frame was sampled (ms, the page's clock). */
        readonly at: number;
        readonly listTop: number;
        /** How far the view stands from the list's end. */
        readonly end: number;
        readonly composer: number;
        readonly notice: { readonly top: number; readonly bottom: number } | null;
        /** The top of the held message's words; null off screen. */
        readonly message: number | null;
        /** The bottom of the run's card the notice follows. */
        readonly card: number | null;
      }
      const HELD = "Then write the table of every helper and job";
      const startTrace = (page: Page) =>
        page.evaluate((text) => {
          const frames: LimitFrame[] = [];
          const state = { active: true };
          const read = (): LimitFrame | null => {
            const list = document.querySelector<HTMLElement>(".timeline-legend-list");
            const composer = document.querySelector('[data-slot="composer-shell"]');
            if (!list || !composer) return null;
            // The notice's row: what stands between the run's card and what follows it.
            const notice = document.querySelector('[data-timeline-row-kind="pause"]');
            const box = notice?.getBoundingClientRect();
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
              end: list.scrollHeight - list.clientHeight - list.scrollTop,
              composer: composer.getBoundingClientRect().top,
              notice: box && box.height > 0 ? { top: box.top, bottom: box.bottom } : null,
              message,
              card:
                [...list.querySelectorAll("[data-run-chat]")].at(-1)?.getBoundingClientRect()
                  .bottom ?? null,
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
      const stopTrace = (page: Page, ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms)).then(() =>
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
        const s = yield* createScenario([installEngineArea]);
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
        if (!(wire instanceof EngineChatWire)) throw new Error("Milo's run is the engine's");
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
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 800)));
        yield* Effect.promise(() => startTrace(s.page));
        engine.limit(run, (yield* Clock.currentTimeMillis) + 18 * 3_600_000);
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 154)));
        engine.update(said, { text: "You've hit your weekly limit · resets 1pm (UTC)" });
        yield* Effect.promise(() =>
          s.page.waitForSelector('[data-conversation-pause="paused"]', { timeout: 8000 }),
        );
        const frames = yield* Effect.promise(() => stopTrace(s.page, 1500));
        return { s, chat, engine, frames };
      });

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect(
          "at the usage limit the notice lands where the run's card ends and the conversation stays at its end, fully visible above the composer",
          () =>
            Effect.gen(function* () {
              const { s, frames } = yield* pausedMilo;
              const shown = frames.filter((frame) => frame.notice !== null);
              expect(shown.length, "ASSERTION: the notice was sampled").toBeGreaterThan(20);
              const last = shown.at(-1)!;
              expect(last.end, "ASSERTION: the conversation stays at its end").toBeLessThanOrEqual(
                1,
              );
              expect(
                last.composer - last.notice!.bottom,
                "ASSERTION: no blank stands between the notice and the composer",
              ).toBeLessThan(80);
              expect(
                last.notice!.top >= last.listTop && last.notice!.bottom <= last.composer,
                "ASSERTION: the notice ends fully visible above the composer",
              ).toBe(true);
              const under = shown.flatMap((frame) =>
                frame.card === null ? [] : [frame.notice!.top - frame.card],
              );
              expect(
                Math.max(...under) - Math.min(...under),
                "ASSERTION: the notice stands right under the run's card, nothing drawn between",
              ).toBeLessThan(8);
              expect(
                shown.every((frame) => frame.notice!.top >= frame.listTop - 1),
                "ASSERTION: no scroll ever takes the notice past the top, not even in part",
              ).toBe(true);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "a message sent while paused sits right under the notice, held until the reset, and goes in place when the pause lifts",
          () =>
            Effect.gen(function* () {
              const { s, chat, engine } = yield* pausedMilo;
              yield* chat.when.send(HELD);
              const receipt = yield* Effect.promise(() =>
                s.page.waitForSelector('[data-message-receipt="held"]', { timeout: 8000 }),
              );
              expect(
                yield* Effect.promise(() => receipt!.evaluate((node) => node.ariaLabel)),
              ).toMatch(/^Sends when the limit resets /);
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 800)));
              yield* Effect.promise(() => startTrace(s.page));
              const held = (yield* Effect.promise(() => stopTrace(s.page, 100))).at(-1)!;
              expect(held.end, "ASSERTION: the conversation stays at its end").toBeLessThanOrEqual(
                1,
              );
              expect(held.notice, "ASSERTION: the notice stays in view").not.toBeNull();
              expect(
                held.message! - held.notice!.bottom,
                "ASSERTION: the held message sits right under the notice",
              ).toBeLessThan(96);
              expect(
                held.message!,
                "ASSERTION: the held message stands above the composer",
              ).toBeLessThan(held.composer);

              yield* Effect.promise(() => startTrace(s.page));
              engine.lift();
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () =>
                    !document.querySelector('[data-message-receipt="held"]') &&
                    document.querySelector('[data-conversation-pause="resumed"]'),
                  { polling: "raf", timeout: 8000 },
                ),
              );
              const frames = (yield* Effect.promise(() => stopTrace(s.page, 600))).filter(
                (frame) => frame.notice !== null && frame.message !== null,
              );
              expect(frames.length, "ASSERTION: the lift was sampled").toBeGreaterThan(10);
              const steps = (of: (frame: LimitFrame) => number) =>
                Math.max(
                  ...frames
                    .slice(1)
                    .map((frame, index) => Math.abs(of(frame) - of(frames[index]!))),
                );
              // A cut changes the height between two frames; a glide spreads the change over its
              // duration, however long a frame takes on the machine sampling it.
              const heights = frames.map((frame) => frame.notice!.bottom - frame.notice!.top);
              const from = heights[0]!;
              const to = heights.at(-1)!;
              const leaves = heights.findIndex((height) => Math.abs(height - from) > 1);
              const lands = heights.findIndex(
                (height, index) => index >= leaves && Math.abs(height - to) <= 1,
              );
              expect(
                Math.abs(to - from) <= 1 || frames[lands]!.at - frames[leaves - 1]!.at >= 100,
                "ASSERTION: the notice goes quiet in place by a glide, never a cut",
              ).toBe(true);
              // The run it starts lands under it and the conversation follows, as after any send.
              expect(
                steps((frame) => frame.message!),
                "ASSERTION: the message moves by a glide as its run starts, never a jump",
              ).toBeLessThan(60);
              expect(
                Math.abs(
                  frames.at(-1)!.message! -
                    frames.at(-1)!.notice!.bottom -
                    (frames[0]!.message! - frames[0]!.notice!.bottom),
                ),
                "ASSERTION: the message keeps its place under the notice as its mark clears",
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

    describe("Decision: the live card's clock and controls stand on a line of their own at the head of the present; the Mate's words are read as they are written.", () => {
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
          { polling: "raf", timeout: 8000 },
          wanted,
        );
      interface LastLineFrame {
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
              at: performance.now(),
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
      const stopLastLineTrace = (page: Page, ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms)).then(() =>
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
      const miloAtWork = Effect.gen(function* () {
        const s = yield* createScenario([installEngineArea]);
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* Effect.promise(() =>
          s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
        );
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        chat.fixture().exchange("How did the deploy go?", "It built and the storefront answers.");
        chat.fixture().exchange("And now?", "The existing conversation is still here");
        const wire = chat.fixture().wire;
        if (!(wire instanceof EngineChatWire)) throw new Error("Milo's run is the engine's");
        const engine = wire.engine;
        yield* s.given.signedIn;
        yield* Effect.promise(() => ownerMenu(s.page));
        yield* chat.when.open();
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
        return { s, engine, run };
      });

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect(
          "the work toggle and Stop stand inside the run's card, on a line of their own clear of the working line's words",
          () =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* miloAtWork;
              engine.item(run, {
                kind: "note",
                text: "Helper B's job ended first: exit code 4, as it was told to fail. Helper A's is still sleeping. Reacting with the first second-wave helper: it reads what B printed and checks the exit code against the plan.",
                streaming: false,
                answer: false,
              });
              const inside = (frame: FootFrame, what: string) => {
                expect(
                  frame.controls.map((control) => control.name),
                  what,
                ).not.toHaveLength(0);
                for (const control of frame.controls) {
                  expect(
                    control.top >= frame.card.top - 0.5 &&
                      control.bottom <= frame.card.bottom + 0.5 &&
                      control.left >= frame.card.left - 0.5 &&
                      control.right <= frame.card.right + 0.5,
                    `ASSERTION: ${control.name} stands inside the run's card (${what})`,
                  ).toBe(true);
                  expect(
                    frame.words.every(
                      (words) =>
                        control.bottom <= words.top + 0.5 || control.top >= words.bottom - 0.5,
                    ),
                    `ASSERTION: ${control.name} stands on a line of its own, clear of the working line's words (${what})`,
                  ).toBe(true);
                }
              };
              yield* Effect.promise(() => settledFoot(s.page, ["Hide work"]));
              inside((yield* Effect.promise(() => readFoot(s.page)))!, "the Mate's words");
              // Its turn over, the helper it launched works on: Stop joins the clock.
              engine.item(run, {
                kind: "work",
                work: "work-helper-a",
                workKind: "helper",
                status: "running",
                title: "Sleep 25 seconds, then report",
              });
              engine.end(run);
              engine.waitOnHelpers();
              yield* Effect.promise(() => settledFoot(s.page, ["Hide work", "Stop"]));
              const waiting = (yield* Effect.promise(() => readFoot(s.page)))!;
              inside(waiting, "waiting for its helpers");
              const [toggle, stop] = ["Hide work", "Stop"].map((name) =>
                waiting.controls.find((control) => control.name === name)!,
              );
              expect(
                Math.abs(toggle!.top - stop!.top),
                "ASSERTION: Stop shares the toggle's line",
              ).toBeLessThan(4);
              yield* s.then.noExternalNetwork;
            }),
        );

        it.effect(
          "a long answer being written grows to the item height and is readable while it is written",
          () =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* miloAtWork;
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
                  { polling: "raf", timeout: 8000 },
                ),
              );
              yield* Effect.promise(() => settledFoot(s.page, ["Hide work"]));
              const read = yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const card = [...document.querySelectorAll("[data-run-chat][data-run-live]")].at(
                    -1,
                  )!;
                  const bubble = card.querySelector<HTMLElement>('[data-chat-kind="note"]')!;
                  const box = bubble
                    .querySelector<HTMLElement>("[data-capped]")!
                    .getBoundingClientRect();
                  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
                  let last: { top: number; bottom: number } | null = null;
                  while (walker.nextNode()) {
                    if (!walker.currentNode.textContent?.includes("Line 32")) continue;
                    const rect = walker.currentNode.parentElement!.getBoundingClientRect();
                    last = { top: rect.top, bottom: rect.bottom };
                  }
                  return { top: box.top, bottom: box.bottom, height: box.height, last };
                }),
              );
              expect(
                read.height,
                "ASSERTION: the words grow past four lines toward the run scroll's height",
              ).toBeGreaterThan(300);
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
        it.effect(
          "a long answer landing keeps the lines the person was reading where they were",
          () =>
            Effect.gen(function* () {
              const { s, engine, run } = yield* miloAtWork;
              const note = engine.item(run, {
                kind: "note",
                text: "",
                streaming: true,
                answer: false,
              });
              const lines = Array.from({ length: 40 }, (_, index) =>
                index === 39
                  ? "Line 40, the very last line."
                  : `Line ${index + 1} of the table of every helper and job.`,
              );
              const text = lines.join("\n\n");
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
                  { polling: "raf", timeout: 8000 },
                ),
              );
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
              yield* Effect.promise(() => startLastLineTrace(s.page));
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 200)));
              // Its last words, then the run's end with it as the answer, as on Milo.
              engine.update(note, { text, streaming: false });
              engine.settle(note);
              engine.end(run);
              const frames = yield* Effect.promise(() => stopLastLineTrace(s.page, 1500));
              const first = frames[0]!;
              expect(
                first.top,
                "ASSERTION: the last words stood in view before the answer landed",
              ).not.toBeNull();
              const away = frames.filter(
                (frame) => frame.top === null || Math.abs(frame.top - first.top!) > 4,
              );
              expect(
                frames.at(-1)!.at - first.at,
                "ASSERTION: the landing was sampled",
              ).toBeGreaterThan(1000);
              // Before: gone for 420 ms, then a 1033 px glide back over 431 ms. The swap of the
              // slot's box for the answer's row takes the list two or three frames to place.
              expect(
                away.length === 0 ? 0 : away.at(-1)!.at - away[0]!.at,
                "ASSERTION: the answer's last line is away from where it was read for no more than the swap's frames",
              ).toBeLessThan(80);
              expect(
                frames
                  .filter((frame) => away.length === 0 || frame.at > away.at(-1)!.at)
                  .every((frame) => frame.top !== null && Math.abs(frame.top - first.top!) <= 4),
                "ASSERTION: once landed the answer's last line stands where it was read, and nothing glides",
              ).toBe(true);
              yield* s.then.noExternalNetwork;
            }),
        );

        // Run 5 (C +0:09.6): a big chunk of words grew the live box 125 -> 497 px in one frame.
        it.effect("words arriving in a burst grow their box by a glide, never a leap", () =>
          Effect.gen(function* () {
            const { s, engine, run } = yield* miloAtWork;
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
                { polling: "raf", timeout: 8000 },
              ),
            );
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
            yield* Effect.promise(() => startLastLineTrace(s.page));
            engine.stream(
              note,
              Array.from({ length: 30 }, (_, index) => `\n\nLine ${index + 3} of the table.`).join(
                "",
              ),
            );
            const frames = yield* Effect.promise(() => stopLastLineTrace(s.page, 1200));
            const heights = frames.flatMap((frame) => (frame.box === null ? [] : [frame.box]));
            const steps = heights.slice(1).map((height, index) => height - heights[index]!);
            expect(heights.at(-1)! - heights[0]!, "ASSERTION: the box grew").toBeGreaterThan(200);
            expect(
              Math.max(...steps),
              "ASSERTION: no frame grows the box by more than a glide's step",
            ).toBeLessThan(80);
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
      }
      const startSendTrace = (page: Page, text: string) =>
        page.evaluate((text) => {
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
            return {
              at: performance.now(),
              composer: composer.getBoundingClientRect().top,
              message:
                bubble !== undefined && box !== undefined && box.height > 0 && drawn(bubble)
                  ? { top: box.top, bottom: box.bottom }
                  : null,
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
        }, text);
      const stopSendTrace = (page: Page, ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms)).then(() =>
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
        it.effect.each([
          {
            from: "this composer, one line",
            typed: true,
            text: "Now describe it in twenty lines.",
          },
          { from: "this composer, several lines", typed: true, text: LONG },
          // The composer stays as it was: the end only grows (D2's send, a line long).
          { from: "another tab", typed: false, text: "Now describe the page in twenty lines." },
        ])(
          "a sent message is never drawn behind the composer, and its glide has no step of 60 px or more in a frame (from $from)",
          ({ typed, text }) =>
            Effect.gen(function* () {
              const s = yield* createScenario([installEngineArea]);
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
              if (!(wire instanceof EngineChatWire))
                throw new Error("This witness runs on the engine's wire");
              // The words typed and the composer at rest: the trace starts as the person sends.
              if (typed)
                yield* Effect.promise(async () => {
                  const input = await s.page.waitForSelector(
                    '[role="textbox"]:not([inert] *, [aria-hidden="true"] *)',
                  );
                  await input!.focus();
                  await s.page.keyboard.sendCharacter(text);
                  await new Promise((resolve) => setTimeout(resolve, 800));
                });
              yield* Effect.promise(() => startSendTrace(s.page, text.slice(0, 40)));
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
              if (typed) yield* Effect.promise(() => s.page.keyboard.press("Enter"));
              else wire.engine.personRun(text);
              const frames = yield* Effect.promise(() => stopSendTrace(s.page, 1500));
              const shown = frames.filter((frame) => frame.message !== null);
              expect(shown.length, "ASSERTION: the sent message was sampled").toBeGreaterThan(10);
              const behind = shown.filter((frame) => frame.message!.bottom > frame.composer + 1);
              expect(
                behind,
                "ASSERTION: no frame draws the sent message behind the composer",
              ).toEqual([]);
              // By elapsed time, never per frame: a loaded machine draws a glide in fewer frames.
              const FRAME_MS = 1000 / 60;
              const steps = frames.slice(1).flatMap((frame, index) => {
                const before = frames[index]!;
                if (frame.message === null || before.message === null) return [];
                const moved = Math.abs(frame.message.top - before.message.top);
                return [(moved * FRAME_MS) / Math.max(FRAME_MS, frame.at - before.at)];
              });
              expect(
                Math.max(0, ...steps),
                "ASSERTION: the sent message glides, no frame's step 60 px or more",
              ).toBeLessThan(60);
              yield* s.then.noExternalNetwork;
            }),
        );
      });
    });
  });
});
