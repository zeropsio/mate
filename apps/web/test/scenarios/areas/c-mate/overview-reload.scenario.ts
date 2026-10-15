import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { resizeMenu } from "../../harness/browser.ts";
import { createScenario } from "../../harness/scenario.ts";

/** What the overview's page showed, each time it changed, from the reloaded document's first frame. */
interface OverviewFrame {
  /** The wait line's words, and its centre's offset from the page's centre, px. */
  readonly wait: string | null;
  readonly offCentre: number | null;
  readonly title: boolean;
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
  const shown = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement && element.getBoundingClientRect().width > 0;
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
    const line = lines.at(-1);
    const box = line?.querySelector("span, p, div:not(:has(*))") ?? line;
    const area = (shell !== null && !shell.hidden ? boot : page)?.getBoundingClientRect();
    const rect = box?.getBoundingClientRect();
    const title = page?.querySelector('[data-zerops-project-scope="true"]') ?? null;
    const frame: OverviewFrame = {
      wait: line?.textContent?.trim() ?? null,
      offCentre:
        rect === undefined || area === undefined
          ? null
          : Math.round(rect.top + rect.height / 2 - (area.top + area.height / 2)),
      title: shown(title),
      freshness: title?.querySelector('[role="status"]')?.textContent?.trim() || null,
      cards: [
        ...(page?.querySelectorAll('[data-zerops-surface="project-cards"] > *') ?? []),
      ].filter(shown).length,
      others: [...(page?.querySelectorAll('[data-zerops-surface="other-projects"] li') ?? [])]
        .filter(shown)
        .map((row) => row.textContent?.trim() ?? ""),
    };
    if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

/** Every frame of a reload holds the one wait at the page's centre, then the cards once, whole. */
function expectOnePaint(frames: ReadonlyArray<OverviewFrame>, cards: number) {
  const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
  for (const frame of frames) {
    if (frame.wait !== null) {
      expect(frame.wait, `One wording for the wait:\n${trace}`).toBe("Reading your projects…");
      expect(
        Math.abs(frame.offCentre ?? 0),
        `The wait stands at the page's centre:\n${trace}`,
      ).toBeLessThanOrEqual(4);
    }
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
    frames.slice(first).every((frame) => frame.cards === cards && frame.wait === null),
    `The cards, once painted, stay:\n${trace}`,
  ).toBe(true);
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect.each([
      {
        title:
          "a reload of the overview says one wait at the page's centre, then paints its cards once",
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
            await s.page.waitForSelector('[data-zerops-surface="project-cards"]', {
              timeout: 15_000,
            });
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
              { timeout: 20_000, polling: 100 },
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
