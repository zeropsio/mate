import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { changeFixture } from "../../fakes/d-change/changes.ts";

const browser = '[data-zerops-surface="repository-browser"]';
describe("Git repository detail", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "source navigation preserves project context, commit links and the selected overview",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario();
          const change = yield* changeFixture(s);
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
            await s.page.goto(`${s.web.origin}/git`);
            await s.page.locator('::-p-aria(All repositories[role="button"])').click();
            await s.page.locator('[data-zerops-git-repository="appdev"] a').click();
            await s.page.locator(`${browser} ::-p-text(${change.title})`).wait();
            expect(await s.page.$eval(`${browser} nav`, (node) => node.textContent)).toContain(
              "Git / Shop / appdev",
            );
            await s.page.waitForSelector(`${browser} select`);
            expect(await s.page.$eval(`${browser} details`, (node) => node.open)).toBe(false);
            await s.page.select(`${browser} select`, "refs/heads/mate/Ada/1");
            await s.page.locator(`${browser} ::-p-text(summary.txt)`).wait();
            await s.page.locator(`${browser} summary`).click();
            await s.page.locator(`${browser} ::-p-text(No Git password yet.)`).wait();
            expect(await s.page.$eval(`${browser} details`, (node) => node.textContent)).toContain(
              "git clone",
            );
            await s.page.locator(`${browser} summary`).click();
            await s.page.locator(`${browser} ::-p-text(summary.txt)`).click();
            await s.page.locator(`${browser} ::-p-text(Order total: 42)`).wait();
            expect(new URL(s.page.url()).searchParams.get("rev")).toMatch(/^[a-f0-9]{40}$/u);
            expect(new URL(s.page.url()).searchParams.get("path")).toBe("summary.txt");
            expect(await s.page.$eval(`${browser} nav`, (node) => node.textContent)).toContain(
              "Shop",
            );
            await s.page.goBack();
            await s.page.locator(`${browser} ::-p-text(summary.txt)`).wait();
            await s.page.locator(`${browser} ::-p-aria(Git[role="button"])`).click();
            await s.page.waitForSelector('[aria-label="Repository view"]', { visible: true });
            expect(
              await s.page.$eval(
                '[aria-label="Repository view"] button[aria-pressed="true"]',
                (node) => node.textContent,
              ),
            ).toBe("All repositories");
            expect(await s.page.$(browser)).toBeNull();
          });
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
