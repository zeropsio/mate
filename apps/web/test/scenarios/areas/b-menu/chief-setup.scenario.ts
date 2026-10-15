import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { resizeMenu } from "../../harness/browser.ts";

describe("Chief setup navigation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a no-Chief viewer sees the setup entry in menu and overview and it opens /chief",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario();
          yield* s.given.project("Ada", { mate: true, app: "Mastermate" });
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await resizeMenu(s.page, 435);
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page.waitForFunction(
              () => document.querySelector(".menu-chief-name")?.textContent === "Your Chief",
            );
            expect(await s.page.$eval(".menu-chief-line", (node) => node.textContent)).toBe(
              "A Mate for the whole organization",
            );
            await s.page.locator("button ::-p-text(Set up Chief)").click();
            await s.page.waitForFunction(() => location.pathname === "/chief");
            expect(new URL(s.page.url()).pathname).toBe("/chief");
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page.locator(".menu-chief-row").click();
            await s.page.waitForFunction(() => location.pathname === "/chief");
            expect(new URL(s.page.url()).pathname).toBe("/chief");
            await s.page.click('button[aria-label="Collapse sidebar"]');
            await s.page
              .locator('[data-zerops-surface="sidebar-chief-row"][aria-label="Your Chief"]')
              .wait();
            await s.page.goto(`${s.web.origin}/zerops`);
            await s.page
              .locator('[data-zerops-surface="sidebar-chief-row"][aria-label="Your Chief"]')
              .click();
            await s.page.waitForFunction(() => location.pathname === "/chief");
            expect(new URL(s.page.url()).pathname).toBe("/chief");
          });
        }),
    );
  });
});
