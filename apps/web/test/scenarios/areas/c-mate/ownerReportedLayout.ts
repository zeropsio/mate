import type { Page } from "puppeteer-core";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import {
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  WS_METHODS,
  ConversationRow,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";

// Use the actual resize control so every witness has the owner's menu width.
/** Runs the page's animations at `rate` of their speed until restored (CDP's own timeline). */
export async function slowAnimations(page: Page, rate: number) {
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

export async function menuAt(page: Page, target: number) {
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

export async function ownerMenu(page: Page) {
  await menuAt(page, 435);
}

/** One change of what a reloaded Chief's page shows, read each frame. */
export interface ChiefPageFrame {
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
export function recordChiefPage() {
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
export const RESETS_AT = "2099-10-10T00:00:00.000Z";

export function readEnd() {
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
export const decodeConversationRow = Schema.decodeUnknownEffect(ConversationRow);

export const quoted = (reading: object) => JSON.stringify(reading);

/** A Mate whose conversation holds one picture of `shape` the person sent, opened at the owner's width. */
export const pictureConversation = (shape: {
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
export async function settledEnd(page: Page) {
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
    { polling: "raf" },
  );
  await waitForStillFrames(page);
  return page.evaluate(readEnd);
}
