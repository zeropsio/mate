// @effect-diagnostics nodeBuiltinImport:off -- a picture file in the isolated Mate workspace.
import liveSlotSteps from "./live-slot-order.fixture.json";
import { composerLayout } from "./composerLayout.ts";
import type { Page } from "puppeteer-core";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  WS_METHODS,
  CommandId,
  ConversationId,
  ConversationRow,
  MATE_ENGINE_PROTOCOLS,
  TurnId,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea, reportContainer } from "./fake.ts";
import type { EngineChatWire } from "./engine.ts";
import { TARGET_QUESTION } from "./wire.ts";
import { menuScenario } from "../b-menu/dsl.ts";
import { journey, sampled } from "./pageJourney.ts";
import { reportConversation } from "../b-menu/fake.ts";
import { environmentFixtureWith } from "../e-env/fake.ts";

// Use the actual resize control so every witness has the owner's menu width.
/** Runs the page's animations at `rate` of their speed until restored (CDP's own timeline). */
async function slowAnimations(page: Page, rate: number) {
  const cdp = await page.createCDPSession();
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
  return {
    restore: async () => {
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
      await cdp.detach();
    },
  };
}

async function menuAt(page: Page, target: number) {
  const rail = (await page.$('[data-sidebar="rail"]'))!;
  const box = (await rail.boundingBox())!;
  const width = await page.$eval(
    '[data-sidebar="sidebar"]',
    (element) => element.getBoundingClientRect().width,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + target - width, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForFunction(
    (target) =>
      document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect().width === target,
    {},
    target,
  );
}

async function ownerMenu(page: Page) {
  await menuAt(page, 435);
}

/** One change of what a reloaded Chief's page shows, read each frame. */
interface ChiefPageFrame {
  /** The conversation column's right edge (its header's), or null before it draws. */
  readonly column: number | null;
  /** The inline panel's left edge, or null while there is none. */
  readonly panel: number | null;
  /** The panel's wait line, if one shows. */
  readonly panelWait: string | null;
  /** The conversation is shown (placed), not its opening. */
  readonly shown: boolean;
  /** The composer's top while it shows, null while it is held or absent. */
  readonly composer: number | null;
  /** The top of the composer's room while it is held unseen (`ComposerRoomHeld`). */
  readonly held: number | null;
  /** The top of the conversation's last row while it shows. */
  readonly lastRow: number | null;
}

// Runs in every new document: each change of the Chief's page, frame by frame, until its
// conversation has stood shown for 60 frames.
function recordChiefPage() {
  const frames: ChiefPageFrame[] = [];
  (window as unknown as { chiefFrames: ChiefPageFrame[] }).chiefFrames = frames;
  let shownFor = 0;
  const round = (value: number | undefined) => (value === undefined ? null : Math.round(value));
  const sample = () => {
    const header = document.querySelector("main [data-chat-header]");
    const panel = document.querySelector('[data-preview-panel-mode="inline"]');
    const wait = panel?.querySelector<HTMLElement>("[data-zerops-wait-line]");
    const shownList = document.querySelector("[data-timeline-thread]:not([data-timeline-placing])");
    const composer = document.querySelector('[data-slot="composer-shell"]:not([data-room-held])');
    const held = document.querySelector('[data-slot="composer-shell"][data-room-held]');
    const rows = shownList?.querySelectorAll("[data-timeline-root]");
    const frame: ChiefPageFrame = {
      column: round(header?.getBoundingClientRect().right),
      panel: round(panel?.getBoundingClientRect().left),
      panelWait: wait === undefined || wait === null ? null : wait.innerText.trim(),
      shown: shownList !== null,
      composer: round(composer?.getBoundingClientRect().top),
      held: round(held?.getBoundingClientRect().top),
      lastRow: round(rows?.[rows.length - 1]?.getBoundingClientRect().top),
    };
    if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    if (frame.shown) shownFor += 1;
    if (shownFor < 60) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
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
  const rows: Array<Box & { text: string; person: boolean; afterWork: boolean }> = [];
  for (const row of [...document.querySelectorAll(".timeline-legend-list [data-timeline-root]")]
    .flatMap((row) => {
      const box = painted(row);
      return box === null
        ? []
        : [
            {
              ...box,
              text: (row.textContent ?? "").slice(0, 240),
              person: row.querySelector('[data-message-role="user"]') !== null,
              afterWork: row.querySelector('[data-timeline-row-kind="after-work"]') !== null,
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
        afterWork: previous.afterWork || row.afterWork,
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
    : last.afterWork
      ? // The bottom wait is its own group (#283), not a row inside the finished turn.
        above.top - rows.at(-3)!.bottom
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
const decodeAssetInput = Schema.decodeUnknownSync(AssetCreateUrlInput);
const encodeAssetResult = Schema.encodeSync(AssetCreateUrlResult);
const decodeConversationRow = Schema.decodeUnknownEffect(ConversationRow);

const quoted = (reading: object) => JSON.stringify(reading);

/** A Mate whose conversation holds one picture of `shape` the person sent, opened at the owner's width. */
const pictureConversation = (shape: {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}) =>
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
        const input = decodeAssetInput(request.payload);
        const relativeUrl = `/api/assets/objects/${"a".repeat(64)}/${input.preview ? "preview" : "original"}`;
        mate.reply(
          socket,
          request.id,
          encodeAssetResult({
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
    chat.fixture().history("[Picture 1]\nCheck proportions", null, [
      {
        type: "image",
        id: "picture",
        name: `${shape.name}.png`,
        mimeType: "image/png",
        sizeBytes: bytes.length,
        width: shape.width,
        height: shape.height,
      },
    ]);
    yield* s.given.signedIn;
    yield* Effect.promise(() => ownerMenu(s.page));
    yield* chat.when.open("Ada", "Check proportions");
    return s;
  });

/** The end of the conversation once its opening and motion have finished. */
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
  await waitForStillFrames(page);
  return page.evaluate(readEnd);
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                  { polling: "raf", timeout: 8000 },
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
                { polling: "raf", timeout: 8000 },
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
        zerops.put("user-data", {
          id: "chief-token",
          clientId: "ORG",
          serviceStackId: "service-Chief",
          projectId: "Chief",
          key: "ZCP_ORG_TOKEN",
          type: "USER",
          sensitive: true,
          editable: true,
          content: "scenario-chief-token",
        });
        const registered = yield* core.call("POST", "/api/chief", {
          session: owner,
          body: { projectId: "Chief" },
        });
        expect(registered.status, "ASSERTION: HQ names the person's Chief").toBe(200);
        yield* s.given.signedIn;
        yield* Effect.promise(() => ownerMenu(s.page));
        yield* Effect.promise(() =>
          s.page
            .locator('[data-sidebar="sidebar"] [data-zerops-surface="sidebar-chief-row"]')
            .click(),
        );
        yield* Effect.promise(() =>
          s.page.waitForSelector('[role="textbox"]', { visible: true, timeout: 8000 }),
        );
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
        yield* s.when.conversation.sends(question);
        expect((yield* mate.provider.received).input.input).toBe(question);
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

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
          zerops.put("user-data", {
            id: "chief-token",
            clientId: "ORG",
            serviceStackId: "service-Chief",
            projectId: "Chief",
            key: "ZCP_ORG_TOKEN",
            type: "USER",
            sensitive: true,
            editable: true,
            content: "scenario-chief-token",
          });
          const registered = yield* core.call("POST", "/api/chief", {
            session: owner,
            body: { projectId: "Chief" },
          });
          expect(registered.status, "ASSERTION: HQ names the person's Chief").toBe(200);
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerMenu(s.page));
          yield* Effect.promise(() =>
            s.page
              .locator('[data-sidebar="sidebar"] [data-zerops-surface="sidebar-chief-row"]')
              .click(),
          );
          yield* Effect.promise(() =>
            s.page.waitForSelector('[role="textbox"]', { visible: true, timeout: 8000 }),
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
            await s.page.waitForFunction(() => !location.pathname.includes("/draft/"), {
              timeout: 8000,
            });
            await s.page.locator('[data-zerops-surface="chief-overview"]').click();
            await s.page.waitForSelector('[data-preview-panel-mode="inline"]', { timeout: 8000 });
            await waitForStillFrames(s.page);
          });
          const frames = yield* Effect.promise(async () => {
            await s.page.evaluateOnNewDocument(recordChiefPage);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(
              () => {
                const frames = (window as unknown as { chiefFrames?: ChiefPageFrame[] })
                  .chiefFrames;
                return frames !== undefined && frames.filter((frame) => frame.shown).length > 0;
              },
              { timeout: 20_000 },
            );
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

    describe("C: image viewer backdrop", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
        it.effect("an opened picture covers the conversation with its dark backdrop", () =>
          Effect.gen(function* () {
            const s = yield* pictureConversation({ name: "square", width: 640, height: 640 });
            const cover = yield* Effect.promise(async () => {
              await s.page.click('button[aria-label="Open picture 1"]');
              await s.page.waitForFunction(
                () => {
                  const image = document.querySelector<HTMLImageElement>(
                    '[role="dialog"] img[data-image-src]',
                  );
                  return image && image.naturalWidth > 0 && getComputedStyle(image).opacity === "1";
                },
                { timeout: 8000 },
              );
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

    describe("Decision: a mark between two names gives way whole; the Mate's name keeps its letters while a mark holds room.", () => {
      describe("B: marks between a project's name and its Mate's", () => {
        it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                yield* Effect.promise(() => f.s.page.waitForSelector(mark, { timeout: 30_000 }));
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
        it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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

    describe("Decision: an overview card is as tall as what it holds.", () => {
      describe("B: overview cards", () => {
        it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
              yield* s.then.noReload;
            }),
        );
      });
    });
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
                  { polling: "raf", timeout: 8000 },
                ),
              );
              yield* Effect.promise(() =>
                s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
                  polling: "raf",
                  timeout: 8000,
                }),
              );
              const wrenPath = new URL(s.page.url()).pathname;
              yield* s.when.menu.opensMate("Sage");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (path) => location.pathname !== path,
                  { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
                ),
              );
              yield* Effect.promise(() =>
                s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
                  polling: "raf",
                  timeout: 8000,
                }),
              );
              const sagePath = new URL(s.page.url()).pathname;
              yield* s.when.menu.opensMate("Wren");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (path) => location.pathname === path,
                  { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
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
                    { polling: "raf", timeout: 8000 },
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
    describe("Decision: a conversation opens in place; nothing it does overflows its column.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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

    // The owner, 2026-10-18, at a narrower window: the Mate's name was cut to "Mir" and the blue
    // Review pill stood over it, while the conversation's subject kept its length to its ellipsis.
    describe("Decision: the subject gives way in the header; the face, the name and the pill never do.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                  { polling: "raf", timeout: 8000 },
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
          s.page.waitForSelector('[data-run-head][data-run-now="paused"]', { timeout: 8000 }),
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
            yield* Effect.promise(() =>
              s.page.waitForSelector('[data-message-receipt="held"]', { timeout: 8000 }),
            );
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
              yield* Effect.promise(() =>
                s.page.waitForSelector('[data-message-receipt="held"]', { timeout: 8000 }),
              );
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
                s.page.waitForSelector('[data-message-receipt="held"]', { timeout: 8000 }),
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
                  { polling: "raf", timeout: 8000 },
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
          { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
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
                { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
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
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                await s.page.locator("::-p-text(Browser)").setTimeout(8000).click();
                await s.page
                  .locator('[data-mate-address="appdev"] button')
                  .setTimeout(8000)
                  .click();
                await s.page.waitForSelector('iframe[title="appdev live preview"]', {
                  visible: true,
                  timeout: 8000,
                });
                await waitForStillFrames(s.page);
              });
              const modes: Array<readonly [string, Awaited<ReturnType<typeof siteGeometry>>]> = [];
              modes.push(["side", yield* Effect.promise(() => siteGeometry(s.page))]);
              yield* Effect.promise(async () => {
                await s.page.locator('button[aria-label="Maximize panel"]').click();
                await s.page.waitForSelector('[data-preview-panel-maximized="true"]', {
                  timeout: 8000,
                });
                await waitForStillFrames(s.page);
              });
              modes.push(["expanded", yield* Effect.promise(() => siteGeometry(s.page))]);
              yield* Effect.promise(async () => {
                await s.page.locator('button[aria-label="Restore panel size"]').click();
                await s.page.setViewport({ width: 900, height: 800 });
                await s.page.waitForSelector('[data-preview-panel-mode="sheet"] iframe', {
                  visible: true,
                  timeout: 8000,
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
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
              await s.page.locator("::-p-text(Helpers)").setTimeout(8000).click();
              await s.page.waitForFunction(
                () => document.querySelectorAll(".helper-map > li").length >= 2,
                { timeout: 8000 },
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

    // Run 9 (Milo, step 5): reloaded, a conversation ending in a recorded 369 px page landed
    // 320 px short of its end and glided there: the page's row was first measured in its 240 px
    // first box, before its width was read.
    describe("Decision: product fix; the 2 px bound stays.", () => {
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                  { timeout: 8000, polling: 100 },
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
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
            await s.page.waitForFunction(
              () => {
                const face = document.querySelector('[data-zerops-surface="sidebar-rail-mate"]');
                if (face === null) return false;
                const box = face.getBoundingClientRect();
                return face.contains(
                  document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
                );
              },
              { timeout: 8000 },
            );
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

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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

        it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                await s.page.waitForFunction(
                  () =>
                    [...document.querySelectorAll('[data-slot="row-line"]')].some((line) =>
                      line.textContent?.includes("The basket now survives a reload."),
                    ),
                  { timeout: 15_000 },
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
            { polling: "raf", timeout: 8000 },
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

      it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
              s.page.waitForFunction(
                () =>
                  [...document.querySelectorAll<HTMLImageElement>("img")].some(
                    (image) => image.alt === "The page" && image.complete && image.naturalWidth > 0,
                  ),
                { timeout: 8000 },
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
                    { polling: "raf", timeout: 8000 },
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
                  { polling: "raf", timeout: 8000 },
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
