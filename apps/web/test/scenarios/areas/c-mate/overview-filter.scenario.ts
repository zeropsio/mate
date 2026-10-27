import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";

describe("overview filter history", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("after any sequence of filter switches, All lists every item", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        const names = ["Ada", "Bea", "Cara", "Dana"];
        for (const name of names) yield* s.given.project(name, { mate: true, app: name });
        yield* s.given.signedIn;
        yield* s.drivers.realMates
          .get("Bea")!
          .provider.turn([{ kind: "ask", question: "Which environment should I inspect?" }]);
        yield* s.when.menu.opensMate("Bea");
        yield* s.then.conversation.appears;
        yield* s.when.conversation.sends("Inspect this project");
        yield* Effect.promise(() =>
          s.page.waitForSelector("::-p-text(Which environment should I inspect?)", {
            visible: true,
          }),
        );
        yield* Effect.promise(async () => {
          await s.page.setViewport({ width: 1786, height: 1000 });
          await s.page.goto(`${s.web.origin}/zerops`);
        });
        const assertAll = () =>
          Effect.promise(async () => {
            // Every project All lists, by name: a card out of sight stands in until it is seen.
            await expect
              .poll(() =>
                s.page.$$eval(
                  '[data-zerops-surface="project-cards"] > [role="listitem"]',
                  (items) => items.map((item) => item.getAttribute("aria-label")).sort(),
                ),
              )
              .toEqual([...names].sort());
            const row = await s.page.$eval('[data-zerops-surface="project-cards"]', (row) => ({
              first: row.firstElementChild?.getAttribute("aria-label"),
              scroll: row.scrollLeft,
              width: row.clientWidth,
              total: row.scrollWidth,
              forward: row.parentElement?.hasAttribute("data-can-right"),
            }));
            expect(row.first).toBe("Ada");
            expect(row.scroll, "All starts with the first project").toBe(0);
            expect(row.total).toBeGreaterThan(row.width);
            expect(row.forward, "Every restored project remains reachable").toBe(true);
          });
        yield* assertAll();
        for (const sequence of [
          ["waiting", "all"],
          ["waiting", "mine", "waiting", "all"],
          ["mine", "waiting", "mine", "all"],
        ]) {
          for (const show of sequence) {
            yield* Effect.promise(async () => {
              await s.page
                .locator(`[data-zerops-surface="overview-filters"] [data-show="${show}"]`)
                .click();
              await s.page.waitForFunction(
                (show) =>
                  document
                    .querySelector(`[data-zerops-surface="overview-filters"] [data-show="${show}"]`)
                    ?.getAttribute("data-active-tab") === "true",
                {},
                show,
              );
              if (show === "waiting") {
                await expect
                  .poll(() =>
                    s.page.$$eval(
                      '[data-zerops-surface="project-cards"] [data-zerops-group]',
                      (cards) => cards.map((card) => card.getAttribute("data-zerops-group")),
                    ),
                  )
                  .toEqual([s.appIds.get("Bea")]);
              }
            });
          }
          yield* assertAll();
        }
        // Source data arriving after first paint joins All without changing its selected filter.
        yield* s.given.project("Eva", { mate: true, app: "Eva" });
        names.push("Eva");
        yield* assertAll();
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
