import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { menuScenario } from "./dsl.ts";

const groups = '[data-zerops-surface="sidebar-environments"] section[data-zerops-group]';

describe("B: automatic project sections", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("Hosted mobile preserves row positions until the drawer is reopened.", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.project("Ada", { mate: true, app: "Alpha", kind: "mate" });
        yield* s.given.project("Ben", { mate: true, app: "Beta", kind: "mate" });
        yield* s.colleague.reports("Ada", {
          latestUserMessageAt: null,
          latestUserMessagePreview: null,
          updatedAt: at,
        });
        yield* s.colleague.reports("Ben", {
          latestUserMessageAt: null,
          latestUserMessagePreview: null,
          updatedAt: at,
        });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Ben").appears();
        const before = yield* Effect.promise(() =>
          s.page.$$eval(groups, (nodes) =>
            nodes.map((node) => node.getAttribute("data-zerops-group")),
          ),
        );
        yield* s.colleague.reports(
          "Ben",
          {
            session: { status: "running", lastError: null },
            liveStep: { kind: "thinking", since: at },
          },
          "working",
        );
        yield* s.menu.text("Ben", "Thinking", "sidebar-mate-live-step");
        yield* Effect.promise(async () => {
          expect(
            await s.page.$$eval(groups, (nodes) =>
              nodes.map((node) => node.getAttribute("data-zerops-group")),
            ),
          ).toEqual(before);
          // The desktop's deliberate reopen applies the new membership too.
          await s.page.locator('button[aria-label="Collapse sidebar"]').click();
          await s.page.locator('button[aria-label="Open main sidebar"]').click();
          await s.page.waitForFunction(() =>
            [...document.querySelectorAll("h2")].some(
              (node) => node.textContent === "Other projects",
            ),
          );
          const active = await s.page.$eval(
            '[data-zerops-project-section="active"]',
            (node) => node.textContent,
          );
          expect(active).toContain("Ben");
          const rail = await s.page.$('[data-sidebar="rail"]');
          const box = (await rail!.boundingBox())!;
          const width = await s.page.$eval(
            '[data-sidebar="sidebar"]',
            (node) => node.getBoundingClientRect().width,
          );
          await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await s.page.mouse.down();
          await s.page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2);
          await s.page.mouse.up();
          await s.page.waitForFunction(
            () =>
              document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect().width ===
              435,
          );
          if (process.env.MENU_ORDER_EVIDENCE) {
            await s.page.screenshot({
              path: `${process.env.MENU_ORDER_EVIDENCE}-desktop-full.png`,
              fullPage: true,
            });
            await s.page.screenshot({
              path: `${process.env.MENU_ORDER_EVIDENCE}-desktop.png`,
              clip: { x: 0, y: 0, width: 435, height: 1000 },
            });
          }
          await s.page.setViewport({ width: 430, height: 932 });
          await s.page.locator('[data-slot="sidebar-trigger"]').click();
          await s.page.waitForSelector('[data-mobile="true"]', { visible: true });
        });
        const mobileBefore = yield* Effect.promise(() =>
          s.page.$$eval(groups, (nodes) =>
            nodes.map((node) => node.getAttribute("data-zerops-group")),
          ),
        );
        yield* s.colleague.reports(
          "Ada",
          {
            session: { status: "running", lastError: null },
            liveStep: { kind: "thinking", since: at },
          },
          "working",
        );
        yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
        yield* Effect.promise(async () => {
          expect(
            await s.page.$$eval(groups, (nodes) =>
              nodes.map((node) => node.getAttribute("data-zerops-group")),
            ),
          ).toEqual(mobileBefore);
          await s.page.evaluate(async () => {
            await Promise.all(
              document
                .getAnimations()
                .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
                .map((animation) => animation.finished.catch(() => undefined)),
            );
          });
          if (process.env.MENU_ORDER_EVIDENCE)
            await s.page.screenshot({
              path: `${process.env.MENU_ORDER_EVIDENCE}-mobile.png`,
              fullPage: true,
            });
          await s.page.keyboard.press("Escape");
          await s.page.locator('[data-slot="sidebar-trigger"]').click();
          await s.page.waitForFunction(
            () =>
              document.querySelectorAll('[data-zerops-project-section="active"]').length === 2 &&
              ![...document.querySelectorAll("h2")].some(
                (node) => node.textContent === "Other projects",
              ),
          );
        });
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
