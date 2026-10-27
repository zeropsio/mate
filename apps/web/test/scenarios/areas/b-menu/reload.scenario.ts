import { scenarioSuite } from "../../harness/suite.ts";
import { resizeMenu } from "../../harness/browser.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { READING_PROJECTS_LINE } from "../../../../src/zerops/waitLine.logic.ts";
import { menuScenario } from "./dsl.ts";

/** The menu column's width, each time it changes, from the reloaded document's first frame. */
function recordMenuWidths() {
  const widths: number[] = [];
  (window as unknown as { menuWidths: number[] }).menuWidths = widths;
  const drawn = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement &&
    element.getBoundingClientRect().width > 0 &&
    getComputedStyle(element).display !== "none" &&
    getComputedStyle(element).visibility !== "hidden";
  const sample = () => {
    const app = document.querySelector("[data-app-sidebar]");
    const boot = document.getElementById("boot-shell-menu");
    const column = drawn(app) ? app : drawn(boot) ? boot : null;
    if (column !== null) {
      const width = Math.round(column.getBoundingClientRect().width);
      if (widths.at(-1) !== width) widths.push(width);
    }
    if (document.querySelector('[data-zerops-surface="sidebar-rail-mate"]') === null) {
      requestAnimationFrame(sample);
    }
  };
  requestAnimationFrame(sample);
}

/** What the menu column showed, frame by frame, from the reloaded document's first frame. */
interface MenuFrame {
  readonly where: "boot" | "app";
  readonly shows: "rows" | "loading" | "empty";
  /** The first loading row's mark and line, each as left, top, width and height. */
  readonly loadingAt: ReadonlyArray<number> | null;
}

// Runs in every new document: records each change of what the menu column shows.
function recordMenuFrames() {
  const frames: MenuFrame[] = [];
  (window as unknown as { menuFrames: MenuFrame[] }).menuFrames = frames;
  const shown = (element: Element | null): element is HTMLElement =>
    element !== null && element.getBoundingClientRect().width > 0;
  const sample = () => {
    const shell = document.getElementById("boot-shell");
    const sidebar = document.querySelector('[data-sidebar="sidebar"]');
    const boot = document.getElementById("boot-shell-menu");
    const column =
      shell !== null && !shell.hidden && shown(boot)
        ? { where: "boot" as const, element: boot }
        : shown(sidebar)
          ? { where: "app" as const, element: sidebar }
          : null;
    if (column !== null) {
      const rows = [
        ...column.element.querySelectorAll('[data-zerops-surface="sidebar-mate"]'),
      ].filter(shown);
      const loading = [
        ...column.element.querySelectorAll(
          '[data-zerops-surface="sidebar-environments-skeleton"] > *',
        ),
      ].find(shown);
      const at =
        loading === undefined
          ? null
          : [...loading.children].flatMap((part) => {
              const box = part.getBoundingClientRect();
              return [box.left, box.top, box.width, box.height];
            });
      const frame: MenuFrame = {
        where: column.where,
        shows: rows.length > 0 ? "rows" : loading !== undefined ? "loading" : "empty",
        loadingAt: at,
      };
      const last = frames.at(-1);
      const same =
        last !== undefined &&
        last.where === frame.where &&
        last.shows === frame.shows &&
        `${last.loadingAt}` === `${frame.loadingAt}`;
      if (!same) frames.push(frame);
    } else if (document.body && frames.at(-1)?.shows !== "empty") {
      frames.push({ where: "app", shows: "empty", loadingAt: null });
    }
    if (frames.at(-1)?.where !== "app" || frames.at(-1)?.shows !== "rows")
      requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

describe("B: menu reload", () => {
  scenarioSuite((it) => {
    it.effect(
      "a menu closed to the rail comes back as the rail after a reload, from its first frame",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
          });
          yield* s.given.signedIn;
          yield* Effect.promise(() => resizeMenu(s.page, 435));
          yield* s.then.menu.row("Shop").appears();
          const widths = yield* Effect.promise(async () => {
            await s.page.waitForFunction(
              () =>
                document.querySelector('[data-sidebar="sidebar"]')?.getBoundingClientRect()
                  .width === 435,
              { polling: "raf" },
            );
            await s.page.click('button[aria-label="Collapse sidebar"]');
            await s.page.waitForFunction(() => document.cookie.includes("sidebar_state=false"));
            await s.page.evaluateOnNewDocument(recordMenuWidths);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(
              () => document.querySelector('[data-zerops-surface="sidebar-rail-mate"]') !== null,
            );
            return s.page.evaluate(
              () => (window as unknown as { menuWidths: number[] }).menuWidths,
            );
          });
          expect(widths, `The menu column after the reload: ${widths.join(" → ")}`).toEqual([88]);
        }),
    );
  });
});

/** What a reloaded conversation's page showed: its wait lines, and its scroll once shown. */
interface ConversationArrival {
  readonly lines: string[];
  readonly scrolls: number[];
}

// Runs in every new document: each wait line the page (never the menu) shows, then the
// conversation's scroll, frame by frame, for its first 40 frames shown.
function recordConversationArrival() {
  const arrival: ConversationArrival = { lines: [], scrolls: [] };
  (window as unknown as { conversationArrival: ConversationArrival }).conversationArrival = arrival;
  const sample = () => {
    for (const line of document.querySelectorAll<HTMLElement>("[data-zerops-wait-line]")) {
      if (line.closest('[data-sidebar="sidebar"], #boot-shell-menu') !== null) continue;
      if (line.getBoundingClientRect().height === 0) continue;
      const text = line.innerText.trim();
      if (arrival.lines.at(-1) !== text) arrival.lines.push(text);
    }
    const shown = document.querySelector(
      "[data-timeline-thread]:not([data-timeline-placing]) .timeline-legend-list",
    );
    if (shown !== null) arrival.scrolls.push(Math.round(shown.scrollTop));
    if (arrival.scrolls.length < 40) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

/** Exchanges enough to scroll, their rows' heights unlike the list's estimate. */
const LONG_HISTORY = Array.from(
  { length: 12 },
  (_, index) =>
    `Step ${index + 1}: read the cart.\n\n\`\`\`ts\n${Array.from(
      { length: 2 + (index % 4) * 2 },
      (_, line) => `const line${line} = await cart.read(${line});`,
    ).join("\n")}\n\`\`\``,
);

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    it.effect(
      "a reload of a Mate's conversation waits with the Mate's opening alone, and its first frame stands where it stays",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          for (const said of LONG_HISTORY) yield* s.colleague.said("Ada", said);
          yield* s.given.signedIn;
          yield* s.when.menu.opensMate("Ada");
          yield* s.then.conversation.appears;
          const arrival = yield* Effect.promise(async () => {
            await s.page.evaluateOnNewDocument(recordConversationArrival);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(
              () =>
                ((window as unknown as { conversationArrival?: ConversationArrival })
                  .conversationArrival?.scrolls.length ?? 0) >= 40,
            );
            return s.page.evaluate(
              () =>
                (window as unknown as { conversationArrival: ConversationArrival })
                  .conversationArrival,
            );
          });
          expect(
            arrival.lines.filter((line) => line === "Loading…" || line === READING_PROJECTS_LINE),
            `The page's wait lines after the reload: ${arrival.lines.join(" → ")}`,
          ).toEqual([]);
          const first = arrival.scrolls[0]!;
          expect(
            Math.max(...arrival.scrolls.map((top) => Math.abs(top - first))),
            `The conversation's scroll, frame by frame once shown: ${arrival.scrolls.join(" → ")}`,
          ).toBeLessThanOrEqual(1);
          expect(first, "The conversation opens scrolled down to its end").toBeGreaterThan(0);
        }),
    );
    it.effect(
      "a reload never empties the menu: it shows the loading rows from its first frame until the Mates' rows replace them",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.project("Cara", { mate: true, app: "Other" });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Shop").appears();
          const frames = yield* Effect.promise(async () => {
            // Reload at the width the person left in their account's menu preference.
            await s.page.evaluate(() => {
              const owner = JSON.parse(
                localStorage.getItem("zerops-mate.zerops-session-owner.v1")!,
              );
              localStorage.setItem(
                `mate:account:${encodeURIComponent(owner.userId)}:chat_thread_sidebar_width`,
                "435",
              );
            });
            await s.page.evaluateOnNewDocument(recordMenuFrames);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page
              .waitForFunction(
                () =>
                  (window as unknown as { menuFrames?: MenuFrame[] }).menuFrames?.at(-1)?.where ===
                    "app" &&
                  (window as unknown as { menuFrames?: MenuFrame[] }).menuFrames?.at(-1)?.shows ===
                    "rows",
              )
              .catch(async (cause) => {
                throw new Error(
                  `Reload trace: ${JSON.stringify(await s.page.evaluate(() => (window as unknown as { menuFrames: MenuFrame[] }).menuFrames))}`,
                  { cause },
                );
              });
            return s.page.evaluate(
              () => (window as unknown as { menuFrames: MenuFrame[] }).menuFrames,
            );
          });
          expect(
            yield* Effect.promise(() =>
              s.page.$eval(
                "[data-app-sidebar]",
                (element) => element.getBoundingClientRect().width,
              ),
            ),
          ).toBe(435);
          const trace = frames
            .map(({ where, shows, loadingAt }) =>
              loadingAt === null ? `${where} ${shows}` : `${where} ${shows} at ${loadingAt}`,
            )
            .join(" → ");
          expect(
            frames.map((frame) => frame.shows),
            `Each change of the menu column after the reload: ${trace}`,
          ).not.toContain("empty");
          const firstRows = frames.findIndex((frame) => frame.shows === "rows");
          expect(
            frames.slice(firstRows).every((frame) => frame.shows === "rows"),
            `Rows, once shown, are never taken back: ${trace}`,
          ).toBe(true);
          expect(frames[0]?.shows, `ASSERTION: first menu frame loads: ${trace}`).toBe("loading");
          expect(frames.some((frame) => frame.where === "boot" && frame.shows === "loading")).toBe(
            true,
          );
          expect(frames.some((frame) => frame.where === "app" && frame.shows === "loading")).toBe(
            true,
          );
          const loading = frames.flatMap((frame) =>
            frame.loadingAt === null ? [] : [frame.loadingAt],
          );
          const jump = Math.max(
            ...loading.flatMap((at) => at.map((value, i) => Math.abs(value - loading[0]![i]!))),
          );
          expect(
            jump,
            `ASSERTION: The loading rows stand in one place, boot frame to menu: ${trace}`,
          ).toBeLessThanOrEqual(1);
        }),
    );
  });
});
