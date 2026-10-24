import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { ANSWER, TITLE, journey, sampled } from "./pageJourney.ts";

type Scenario = Effect.Success<ReturnType<typeof journey>>["s"];

const countLoads = (s: Scenario) =>
  Effect.promise(() =>
    s.page.evaluate((title) => {
      (window as unknown as { pageLoads: number[] }).pageLoads = [];
      document.addEventListener(
        "load",
        (event) => {
          if (event.target instanceof HTMLIFrameElement && event.target.title === title)
            (window as unknown as { pageLoads: number[] }).pageLoads.push(performance.now());
        },
        true,
      );
    }, TITLE),
  );

const loaded = (s: Scenario, count: number) =>
  Effect.promise(() =>
    s.page.waitForFunction(
      (count) => (window as unknown as { pageLoads: number[] }).pageLoads.length >= count,
      { polling: "raf" },
      count,
    ),
  );

const settled = (s: Scenario) =>
  Effect.promise(() =>
    s.page.waitForFunction(
      (answer) =>
        document.body.textContent?.includes(answer) &&
        document.querySelector('[data-run-now="worked"] button[aria-expanded="false"]') !== null &&
        document.querySelector("[data-timeline-placing]") === null &&
        document.getAnimations().every((animation) => animation.playState !== "running"),
      { polling: "raf" },
      ANSWER,
    ),
  );

describe("C: a page the Mate publishes", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a page the Mate publishes draws inline above its answer, and reaches no network",
      () =>
        Effect.gen(function* () {
          const { s, publish } = yield* journey(180);
          yield* sampled(
            s,
            Effect.sync(() => publish()),
          );
          const placed = yield* Effect.promise(() =>
            s.page.evaluate(
              (title, answer) => {
                const frame = document.querySelector(`iframe[title="${title}"]`);
                const answerBox = [...document.querySelectorAll("p, div")]
                  .findLast((node) => node.textContent?.trim() === answer)
                  ?.getBoundingClientRect();
                return {
                  sandbox: frame?.getAttribute("sandbox") ?? null,
                  frameBottom: frame?.getBoundingClientRect().bottom ?? null,
                  answerTop: answerBox?.top ?? null,
                };
              },
              TITLE,
              ANSWER,
            ),
          );
          expect(placed.sandbox, "ASSERTION: the page runs scripts alone").toBe("allow-scripts");
          expect(placed.frameBottom).not.toBeNull();
          expect(placed.answerTop, "ASSERTION: the answer stands under the page").not.toBeNull();
          expect(placed.answerTop!).toBeGreaterThanOrEqual(placed.frameBottom!);
          // Its image and its beacon were never asked for: the harness blocks and records any.
          yield* s.then.noExternalNetwork;
        }),
    );
  });

  // Milo, 2026-10-10: every page closed itself 0.4 s after it landed live, saying it had tried to
  // open something else, with no navigation at all: the run settling around it reloaded its frame.
  describe("Decision: only the page's own navigation takes it down.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      it.effect(
        "a page published during a live run is still open 3 s after its run settles and folds",
        () =>
          Effect.gen(function* () {
            const { s, measured, publishLive, answer } = yield* journey(180);
            yield* Effect.sync(publishLive);
            yield* Effect.promise(() => s.page.waitForSelector(`iframe[title="${TITLE}"]`));
            yield* measured;
            yield* Effect.sync(answer);
            yield* settled(s);
            // The title promises a three-second observation after the run folded, not a blind
            // delay: every paint must still have its page and no navigation notice.
            const observed = yield* Effect.promise(() =>
              s.page.evaluate(
                (title) =>
                  new Promise<boolean>((resolve) => {
                    const start = performance.now();
                    let stood = true;
                    const paint = () => {
                      stood &&=
                        document.querySelector(`iframe[title="${title}"]`) !== null &&
                        !document.body.textContent?.includes(
                          "The page tried to open something else",
                        );
                      if (performance.now() - start >= 3000) resolve(stood);
                      else requestAnimationFrame(paint);
                    };
                    requestAnimationFrame(paint);
                  }),
                TITLE,
              ),
            );
            expect(
              observed,
              "ASSERTION: the page stands throughout the three seconds after folding",
            ).toBe(true);
            const state = yield* Effect.promise(() =>
              s.page.evaluate(
                (title) => ({
                  framed: document.querySelector(`iframe[title="${title}"]`) !== null,
                  notice:
                    document.body.textContent?.includes("The page tried to open something else") ??
                    false,
                }),
                TITLE,
              ),
            );
            expect(state, "ASSERTION: the page stands, never closed").toEqual({
              framed: true,
              notice: false,
            });
            yield* s.then.noExternalNetwork;
          }),
      );
      // Milo, 2026-10-10: a new page's row was born twice, half a second apart: the list handed it
      // the earlier page's container, out of order, then sorted its containers, and a frame moved
      // in the document loads its page again.
      it.effect(
        "a page published during a live run loads once as it lands and its run settles",
        () =>
          Effect.gen(function* () {
            const { s, measured, publishLive, workOn, answer } = yield* journey(180, {
              earlierPage: true,
              workOn: true,
            });
            yield* countLoads(s);
            // The conversation stands placed before the page lands: its rows in the document in
            // the order they show.
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => {
                  const tops = [...document.querySelectorAll("[data-timeline-row-id]")].map(
                    (row) => row.getBoundingClientRect().top,
                  );
                  return tops.length > 0 && tops.every((top, i) => i === 0 || top >= tops[i - 1]!);
                },
                { polling: 100 },
              ),
            );
            yield* Effect.sync(publishLive);
            yield* Effect.promise(() => s.page.waitForSelector(`iframe[title="${TITLE}"]`));
            yield* loaded(s, 1);
            yield* measured;
            const beforeWork = yield* Effect.promise(() =>
              s.page.evaluate(() =>
                [...document.querySelectorAll("[data-run-now]")]
                  .map((row) => row.textContent)
                  .join("\n"),
              ),
            );
            yield* Effect.sync(workOn);
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                (before) =>
                  [...document.querySelectorAll("[data-run-now]")]
                    .map((row) => row.textContent)
                    .join("\n") !== before,
                { polling: "raf" },
                beforeWork,
              ),
            );
            yield* Effect.sync(answer);
            yield* settled(s);
            const loads = yield* Effect.promise(
              () =>
                s.page.evaluate(
                  () => (window as unknown as { pageLoads: number[] }).pageLoads.length,
                ) as Promise<number>,
            );
            expect(loads, "ASSERTION: the frame loads once on landing").toBe(1);
            yield* s.then.noExternalNetwork;
          }),
      );
      it.effect("a page whose frame the conversation moves loads again and stays open", () =>
        Effect.gen(function* () {
          const { s, measured, publishLive, answer } = yield* journey(180);
          yield* countLoads(s);
          yield* Effect.sync(publishLive);
          yield* Effect.sync(answer);
          yield* Effect.promise(() => s.page.waitForSelector(`iframe[title="${TITLE}"]`));
          yield* loaded(s, 1);
          yield* measured;
          yield* settled(s);
          // A list moving a row (React reordering keyed rows, the list recycling one) takes the
          // frame out of the document and puts it back: the browser loads its document again.
          yield* Effect.promise(() =>
            s.page.evaluate((title) => {
              const box = document.querySelector(`figure[aria-label="${title}"] > div`)!;
              const parent = box.parentElement!;
              const next = box.nextSibling;
              box.remove();
              parent.insertBefore(box, next);
            }, TITLE),
          );
          yield* loaded(s, 2);
          const loads = yield* Effect.promise(() =>
            s.page.evaluate(() => (window as unknown as { pageLoads: number[] }).pageLoads.length),
          );
          expect(loads, "ASSERTION: moving the frame loaded it again").toBe(2);
          const state = yield* Effect.promise(() =>
            s.page.evaluate(
              (title) => ({
                framed: document.querySelector(`iframe[title="${title}"]`) !== null,
                notice:
                  document.body.textContent?.includes("The page tried to open something else") ??
                  false,
              }),
              TITLE,
            ),
          );
          expect(state, "ASSERTION: a frame loaded again by a move is still the page").toEqual({
            framed: true,
            notice: false,
          });
          yield* s.then.noExternalNetwork;
        }),
      );
    });
  });

  describe("Decision: a page that navigates its own frame is not the page the Mate published.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      const LOGIN = "https://example.com/login";
      for (const trick of [
        { how: "by script", script: `location.href=${JSON.stringify(LOGIN)};` },
        {
          how: "to a data: document",
          script: 'location.href="data:text/html,<h1>Sign in to Zerops</h1>";',
        },
        {
          how: "by a refresh",
          script: `document.head.insertAdjacentHTML("beforeend",'<meta http-equiv="refresh" content="0;url=${LOGIN}">');`,
        },
        {
          how: "by a link it clicks itself",
          script: `var a=document.createElement("a");a.href=${JSON.stringify(LOGIN)};document.body.append(a);a.click();`,
        },
        {
          how: "by a named target",
          script: `window.name="self";window.open(${JSON.stringify(LOGIN)},"self");`,
        },
      ])
        it.effect(
          `a published page that navigates itself ${trick.how} sends nothing and is never shown`,
          () =>
            Effect.gen(function* () {
              const { s, publish } = yield* journey(180, {
                script: `setTimeout(function(){${trick.script}},400);`,
              });
              publish();
              yield* Effect.promise(() => s.page.waitForSelector(`iframe[title="${TITLE}"]`));
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (title) =>
                    document.querySelector(`iframe[title="${title}"]`) === null &&
                    document.body.textContent?.includes("The page tried to open something else"),
                  { polling: "raf" },
                  TITLE,
                ),
              );
              const state = yield* Effect.promise(() =>
                s.page.evaluate(
                  (title) => ({
                    framed: document.querySelector(`iframe[title="${title}"]`) !== null,
                    notice:
                      document.body.textContent?.includes(
                        "The page tried to open something else",
                      ) ?? false,
                  }),
                  TITLE,
                ),
              );
              expect(state, "ASSERTION: a page whose frame loads again is taken down").toEqual({
                framed: false,
                notice: true,
              });
              const readable = yield* Effect.promise(() =>
                Promise.all(
                  s.page
                    .frames()
                    .map((frame) =>
                      frame.evaluate(() => document.body?.textContent ?? "").catch(() => ""),
                    ),
                ),
              );
              expect(
                readable.some((text) => /Sign in to Zerops|Example Domain/.test(text)),
                "ASSERTION: what it navigated to stands nowhere in the conversation",
              ).toBe(false);
              // Nothing left: the harness records any request it would have made.
              yield* s.then.noExternalNetwork;
            }),
        );
    });
  });

  describe("Decision: geometry relations only; no style pins.", () => {
    it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
      for (const shape of [
        {
          title: "a published page stands at its full height in the run, like the answer it is",
          page: 900,
          stands: 900,
        },
        {
          title: "a page taller than 4000 px stands at its full height too: nothing caps it",
          page: 4400,
          stands: 4400,
        },
      ])
        it.effect(shape.title, () =>
          Effect.gen(function* () {
            const { s, publish } = yield* journey(shape.page);
            const samples = yield* sampled(
              s,
              Effect.sync(() => publish()),
            );
            const last = samples.at(-1)!;
            expect(last.frame, "ASSERTION: the frame stands at the page's height").toBe(
              shape.stands,
            );
            expect(
              last.answer!,
              "ASSERTION: the answer stands under the whole page",
            ).toBeGreaterThanOrEqual(shape.stands);
            yield* s.then.noExternalNetwork;
          }),
        );

      it.effect(
        "a page its viewport sizes stands a screen tall and scrolls inside, never growing without end",
        () =>
          Effect.gen(function* () {
            const { s, publish } = yield* journey("600vh");
            const samples = yield* sampled(
              s,
              Effect.sync(() => publish()),
            );
            const last = samples.at(-1)!;
            expect(
              new Set(samples.slice(-20).map((sample) => sample.frame)).size,
              "ASSERTION: the frame holds still",
            ).toBe(1);
            expect(last.frame, "ASSERTION: a screen tall, inside the window").toBeLessThan(1000);
            expect(last.frame, "ASSERTION: past its first box").toBeGreaterThan(240);
            expect(
              last.answer!,
              "ASSERTION: the answer stands under the frame",
            ).toBeGreaterThanOrEqual(last.frame);
            const wrapper = s.page
              .frames()
              .find((frame) => frame.parentFrame() === s.page.mainFrame());
            const inner = wrapper?.childFrames()[0];
            expect(inner, "ASSERTION: the page has its inner scrolling document").toBeDefined();
            const scroll = yield* Effect.promise(() =>
              inner!.evaluate(() => {
                const root = document.scrollingElement!;
                const before = root.scrollTop;
                window.scrollTo(0, root.scrollHeight);
                return {
                  before,
                  after: root.scrollTop,
                  maximum: root.scrollHeight - root.clientHeight,
                };
              }),
            );
            expect(scroll.maximum, "ASSERTION: the page extends below the frame").toBeGreaterThan(
              0,
            );
            expect(scroll.after, "ASSERTION: the page scrolls inside to its bottom").toBe(
              scroll.maximum,
            );
            expect(scroll.after).toBeGreaterThan(scroll.before);
            yield* s.then.noExternalNetwork;
          }),
      );

      it.effect("the first landing glides to the page's height, never cuts", () =>
        Effect.gen(function* () {
          const { s, publish } = yield* journey(900);
          const samples = yield* sampled(
            s,
            Effect.sync(() => publish()),
          );
          const heights = samples.map((sample) => sample.frame);
          expect(heights[0], "ASSERTION: it lands in a modest box").toBe(240);
          expect(heights.at(-1), "ASSERTION: it stands at the page's height").toBe(900);
          expect(
            heights.every((height, i) => i === 0 || height >= heights[i - 1]!),
            `ASSERTION: it only ever grows toward the page, saw ${[...new Set(heights)]}`,
          ).toBe(true);
          const between = new Set(heights.filter((height) => height > 240 && height < 900));
          expect(between.size, "ASSERTION: it glides through the heights between").toBeGreaterThan(
            2,
          );
          yield* s.then.noExternalNetwork;
        }),
      );

      it.effect(
        "a page measured once paints at its height on every later view: nothing moves after its first paint on a reload",
        () =>
          Effect.gen(function* () {
            const { s, measured, publish, reload } = yield* journey(600);
            yield* sampled(
              s,
              Effect.sync(() => publish()),
            );
            expect(yield* measured, "ASSERTION: the view recorded it").toEqual([600]);
            const reloaded = yield* sampled(s, reload, true);
            expect(
              [...new Set(reloaded.map((sample) => sample.frame))],
              "ASSERTION: the frame stands at the page's height from its first paint",
            ).toEqual([600]);
            const offsets = new Set(
              reloaded.flatMap((sample) => (sample.answer === null ? [] : [sample.answer])),
            );
            expect(offsets.size, `ASSERTION: the answer keeps its place, saw ${[...offsets]}`).toBe(
              1,
            );
            yield* s.then.noExternalNetwork;
          }),
      );
    });
  });
});
