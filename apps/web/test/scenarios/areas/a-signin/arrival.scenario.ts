import { beforeAll, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { deviceLoginDist } from "../../harness/deviceLoginBundle.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installSignIn } from "./fake.ts";
import { account } from "./dsl.ts";

/** The device-login build, once `beforeAll` has it. */
let dist = "";
const deviceLoginScenario = () => createScenario([installSignIn], { signIn: "device-login", dist });

/** What the window's first seconds showed, each time it changed. */
interface ArrivalFrame {
  /** The menu's mark, boot frame or app, as left, top, width, height. */
  readonly mark: ReadonlyArray<number> | null;
  /** The menu column, where one shows: its rows, its loading rows, or nothing. */
  readonly menu: "rows" | "loading" | "empty" | null;
  /** The overview's stand-in cards and its own cards. */
  readonly standInCards: number;
  readonly cards: number;
}

// Runs in every new document: records each change of the mark, the menu and the overview's cards
// until the case takes the record, however long the arrival takes on this machine.
function recordArrival() {
  const frames: ArrivalFrame[] = [];
  let taken = false;
  Object.assign(window, {
    arrivalFrames: frames,
    takeArrival: () => {
      taken = true;
      return frames;
    },
  });
  const seen = (element: Element | null | undefined): element is HTMLElement => {
    if (!(element instanceof Element)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
  };
  const sample = () => {
    const shell = document.getElementById("boot-shell");
    const boot = shell !== null && !shell.hidden;
    const sidebar = document.querySelector("[data-app-sidebar]");
    const column = boot
      ? document.getElementById("boot-shell-menu")
      : seen(sidebar)
        ? sidebar
        : null;
    const markElement = boot
      ? document.getElementById("boot-shell-logo")
      : (sidebar?.querySelector('[data-slot="sidebar-header"] a svg') ?? null);
    const mark = seen(markElement)
      ? (() => {
          const box = markElement.getBoundingClientRect();
          return [box.left, box.top, box.width, box.height].map(Math.round);
        })()
      : null;
    const menu = !seen(column)
      ? null
      : [...column.querySelectorAll('[data-zerops-surface="sidebar-mate"]')].some(seen)
        ? "rows"
        : [
              ...column.querySelectorAll(
                '[data-zerops-surface="sidebar-environments-skeleton"] > *',
              ),
            ].some(seen)
          ? "loading"
          : "empty";
    const standInCards = [
      ...document.querySelectorAll("[data-overview-stand-in-cards] > *"),
    ].filter(seen).length;
    const cards = [...document.querySelectorAll(".ov-card")].filter(seen).length - standInCards;
    const frame: ArrivalFrame = { mark, menu, standInCards, cards };
    if (JSON.stringify(frames.at(-1)) !== JSON.stringify(frame)) frames.push(frame);
    if (!taken) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

const traceOf = (frames: ReadonlyArray<ArrivalFrame>) =>
  frames
    .map(
      (frame) =>
        `mark ${frame.mark?.join(",") ?? "-"} menu ${frame.menu ?? "-"} stand-in ${frame.standInCards} cards ${frame.cards}`,
    )
    .join("\n");

/** The first seconds' rules: the mark never moves, the menu never empties, no card is taken back. */
function expectSettledArrival(frames: ReadonlyArray<ArrivalFrame>) {
  const trace = traceOf(frames);
  // The sign-in's centred splash comes before the app's frame: the app's frame is what must hold.
  const appFrames = frames.slice(frames.findIndex((frame) => frame.menu !== null));
  const marks = appFrames.flatMap((frame) => (frame.mark === null ? [] : [frame.mark]));
  expect(marks.length, `ASSERTION: the menu's mark was seen:\n${trace}`).toBeGreaterThan(0);
  const moved = Math.max(
    ...marks.flatMap((mark) => mark.map((value, index) => Math.abs(value - marks[0]![index]!))),
  );
  expect(
    moved,
    `The menu's mark stands in one place from the first frame:\n${trace}`,
  ).toBeLessThanOrEqual(1);
  const menus = appFrames.flatMap((frame) => (frame.menu === null ? [] : [frame.menu]));
  const firstRows = menus.indexOf("rows");
  expect(firstRows, `ASSERTION: the Mates' rows arrived:\n${trace}`).toBeGreaterThan(-1);
  expect(
    menus.slice(0, firstRows),
    `The menu shows its loading row until the rows replace it, never an empty menu:\n${trace}`,
  ).not.toContain("empty");
  expect(
    menus.slice(firstRows).every((menu) => menu === "rows"),
    `Rows, once shown, are never taken back:\n${trace}`,
  ).toBe(true);
  const cards = Math.max(...frames.map((frame) => frame.cards));
  expect(
    Math.max(...frames.map((frame) => frame.standInCards)),
    `The overview's stand-in paints no card the overview then takes back:\n${trace}`,
  ).toBeLessThanOrEqual(cards);
}

describe("owner-reported layout regressions", () => {
  beforeAll(async () => {
    dist = await deviceLoginDist();
  });
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Seen on an arrival from HQ's invitation (run 2): the mark jumped 12 px as the menu came,
    // and its loading rows went away and came back while the members were read.
    it.effect(
      "an arrival from HQ's card and its reload paint the menu's mark in one place, its loading row until the rows, and no card taken back",
      () =>
        Effect.gen(function* () {
          const s = yield* deviceLoginScenario();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          s.drivers.zerops.deviceLogin.approvesFromHq = true;
          s.web.setPerson(s.page, "personal");
          yield* Effect.promise(() => s.page.evaluateOnNewDocument(recordArrival));
          yield* Effect.promise(() => s.page.goto(`${s.web.origin}/?signin=hq`));
          yield* account(s.page).showsPerson("owner");
          yield* s.then.menu.row("Shop").appears();
          const settled = () =>
            Effect.promise(async () => {
              await s.page.waitForFunction(
                () =>
                  ((window as unknown as { arrivalFrames?: ArrivalFrame[] }).arrivalFrames?.at(-1)
                    ?.cards ?? 0) > 0,
                { polling: "raf" },
              );
              return s.page.evaluate(() =>
                (window as unknown as { takeArrival(): ArrivalFrame[] }).takeArrival(),
              );
            });
          expectSettledArrival(yield* settled());
          yield* Effect.promise(() => s.page.goto(`${s.web.origin}/zerops`));
          expectSettledArrival(yield* settled());
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
