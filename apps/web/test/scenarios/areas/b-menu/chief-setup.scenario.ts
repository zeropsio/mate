import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { resizeMenu } from "../../harness/browser.ts";

describe("Chief setup navigation", () => {
  scenarioSuite((it) => {
    it.effect(
      "a person offered a Chief sets it up from the account menu, never from a menu row or the overview",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario();
          yield* s.given.project("Ada", { mate: true, app: "Mastermate" });
          yield* s.given.project("Blog", {
            app: "Blog",
            kind: "production",
            environmentName: "production",
          });
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await resizeMenu(s.page, 435);
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page.locator(".menu-foot-who").click();
            await s.page.locator("[data-zerops-account-chief]").click();
            await s.page.waitForFunction(() => location.pathname === "/chief");
            expect(new URL(s.page.url()).pathname).toBe("/chief");
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page.locator('[data-sidebar="sidebar"] [aria-label^="Account: "]').wait();
            // A Chief that does not exist is no menu row, and the overview does not offer it.
            expect(await s.page.$(".menu-chief-row")).toBeNull();
            expect(
              await s.page.$$eval("button", (buttons) =>
                buttons.some((button) => button.textContent?.trim() === "Set up Chief"),
              ),
            ).toBe(false);
          });
        }),
    );
  });
});
