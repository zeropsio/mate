import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resizeMenu } from "../../harness/browser.ts";
import { createScenario } from "../../harness/scenario.ts";

/** A box's top-left corner, px. */
type Corner = readonly [number, number];

/** What the overview's page showed, each time it changed, from the reloaded document's first frame. */
interface OverviewFrame {
  /** Words of a wait ("…") anywhere on the page or in the boot frame; there should be none. */
  readonly wait: string | null;
  /** The stand-in, while it shows: its title's and its first card's corners. */
  readonly standIn: { readonly title: Corner | null; readonly card: Corner | null } | null;
  readonly title: boolean;
  /** The page's own title and first card, once painted. */
  readonly titleAt: Corner | null;
  readonly cardAt: Corner | null;
  /** The title row's freshness words ("Updating…"), while it says any. */
  readonly freshness: string | null;
  readonly cards: number;
  /** Each project the page lists under "Other projects", with its line. */
  readonly others: ReadonlyArray<string>;
}

// Runs in every new document: records each change of what the overview's page shows.
function recordOverviewFrames() {
  const frames: OverviewFrame[] = [];
  (window as unknown as { overviewFrames: OverviewFrame[] }).overviewFrames = frames;
  const shown = (element: Element | null | undefined): element is HTMLElement =>
    element instanceof HTMLElement && element.getBoundingClientRect().width > 0;
  const corner = (element: Element | null | undefined): Corner | null => {
    if (!shown(element)) return null;
    const rect = element.getBoundingClientRect();
    return [Math.round(rect.left), Math.round(rect.top)];
  };
  const sample = () => {
    const page = document.querySelector('[data-slot="sidebar-inset"]');
    const shell = document.getElementById("boot-shell");
    const boot = document.getElementById("boot-shell-page");
    const lines = [
      ...(page?.querySelectorAll('[role="status"]') ?? []),
      ...(shell !== null && !shell.hidden && boot !== null ? [boot] : []),
    ].filter(
      (element) =>
        shown(element) &&
        element.textContent !== null &&
        element.textContent.trim().endsWith("…") &&
        element.closest("h1") === null &&
        element.closest('[data-zerops-project-scope="true"]') === null,
    );
    const standInCards = page?.querySelector("[data-overview-stand-in-cards]");
    const standInTitle = page?.querySelector("[data-overview-stand-in-title] h1");
    const title = page?.querySelector('[data-zerops-project-scope="true"]') ?? null;
    const cards = [
      ...(page?.querySelectorAll('[data-zerops-surface="project-cards"] > *') ?? []),
    ].filter(shown);
    const frame: OverviewFrame = {
      wait: lines.at(-1)?.textContent?.trim() ?? null,
      standIn:
        shown(standInCards) || shown(standInTitle)
          ? { title: corner(standInTitle), card: corner(standInCards?.firstElementChild) }
          : null,
      title: shown(title),
      titleAt: corner(title?.querySelector("h1")),
      cardAt: corner(cards[0]),
      freshness: title?.querySelector('[role="status"]')?.textContent?.trim() || null,
      cards: cards.length,
      others: [...(page?.querySelectorAll('[data-zerops-surface="other-projects"] li') ?? [])]
        .filter(shown)
        .map((row) => row.textContent?.trim() ?? ""),
    };
    if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

const near = (a: Corner | null, b: Corner | null) =>
  a !== null && b !== null && Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2;

/**
 * Every frame of a reload: no wait's words, the overview's stand-in painted once, then the cards
 * once, whole, where the stand-in's cards stood.
 */
function expectOnePaint(frames: ReadonlyArray<OverviewFrame>, cards: number) {
  const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
  for (const frame of frames) {
    expect(frame.wait, `No wait's words on the page:\n${trace}`).toBeNull();
    expect(frame.others, `No project is said held before HQ was read:\n${trace}`).toEqual([]);
    expect(frame.freshness, `The first read says no Updating…:\n${trace}`).toBeNull();
    expect(
      frame.title === false || frame.cards === cards,
      `The title comes with its cards, whole:\n${trace}`,
    ).toBe(true);
  }
  const first = frames.findIndex((frame) => frame.cards > 0);
  expect(first, `The cards are painted:\n${trace}`).toBeGreaterThanOrEqual(0);
  expect(
    frames.slice(first).every((frame) => frame.cards === cards && frame.standIn === null),
    `The cards, once painted, stay, and the stand-in never returns:\n${trace}`,
  ).toBe(true);
  // The stand-in shows in one run: once it went, it is never painted again.
  const standing = frames.map((frame) => frame.standIn !== null);
  const runs = standing.filter((on, at) => on && (at === 0 || !standing[at - 1])).length;
  expect(runs, `The stand-in is painted once:\n${trace}`).toBeLessThanOrEqual(1);
  const last = frames.slice(0, first).findLast((frame) => frame.standIn !== null)?.standIn;
  if (last !== undefined && last !== null) {
    const painted = frames[first]!;
    expect(
      near(last.card, painted.cardAt),
      `The first card lands where the stand-in's stood:\n${trace}`,
    ).toBe(true);
    expect(
      near(last.title, painted.titleAt),
      `The title stays where the stand-in's stood:\n${trace}`,
    ).toBe(true);
  }
}

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    it.effect.each([
      {
        title:
          "a reload of the overview stands in with its cards' shape, painted once, then paints its cards in the same places",
        hqBlinks: false,
      },
      {
        title:
          "a reload of the overview whose HQ fails its first attempt says no project is held, and paints its cards once",
        hqBlinks: true,
      },
    ])(
      "$title",
      ({ hqBlinks }) =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.project("Cara", { mate: true, app: "Bakery" });
          yield* s.given.project("Shopstage", {
            kind: "stage",
            app: "Shop",
            environmentName: "stage",
          });
          yield* s.given.signedIn;
          yield* Effect.promise(() => resizeMenu(s.page, 435));
          const frames = yield* Effect.promise(async () => {
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page.waitForSelector('[data-zerops-surface="project-cards"]');
            await s.page.evaluateOnNewDocument(recordOverviewFrames);
            if (hqBlinks) s.drivers.hq.drops();
            await s.page.reload({ waitUntil: "domcontentloaded" });
            if (hqBlinks) {
              await new Promise((resolve) => setTimeout(resolve, 1_500));
              s.drivers.hq.returns();
            }
            await s.page.waitForFunction(
              () =>
                (window as unknown as { overviewFrames?: OverviewFrame[] }).overviewFrames?.at(-1)
                  ?.cards === 2,
              { polling: 100 },
            );
            // What a settled page might still take back shows within a beat of the cards.
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            return s.page.evaluate(
              () => (window as unknown as { overviewFrames: OverviewFrame[] }).overviewFrames,
            );
          });
          expectOnePaint(frames, 2);
        }),
      60_000,
    );
  });
});
