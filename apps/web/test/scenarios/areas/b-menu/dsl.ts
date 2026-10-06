import * as Effect from "effect/Effect";
import { clickText } from "../../harness/browser.ts";
import type { ScenarioExtension } from "../../harness/scenario.ts";
import type { OverviewMain, MateThreadKind } from "@t3tools/shared/mateLink";
import { createScenario } from "../../harness/scenario.ts";
import {
  installMenu,
  reportConversation,
  moveMate,
  removeProject,
  denyProjectRead,
  settleProjectRefusal,
  startStageBuild,
  stageService,
  holdDetails,
  releaseDetails,
} from "./fake.ts";

export const menuScenario = Effect.fn("menu.scenario")(function* (
  extensions: ScenarioExtension[] = [],
) {
  const s = yield* createScenario([installMenu, ...extensions]);
  const menu = {
    text: (name: string, words: string, surface = "sidebar-mate") =>
      Effect.promise(async () => {
        try {
          await s.page.waitForFunction(
            (name, words, surface) =>
              [
                ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]'),
              ].some(
                (row) =>
                  row
                    .querySelector<HTMLElement>('[data-zerops-surface="sidebar-mate-name"]')
                    ?.innerText.trim() === name &&
                  row.getBoundingClientRect().height > 0 &&
                  (surface === "sidebar-mate"
                    ? row
                    : row.querySelector<HTMLElement>(`[data-zerops-surface="${surface}"]`)
                  )?.innerText.includes(words),
              ),
            { timeout: 15_000, polling: "raf" },
            name,
            words,
            surface,
          );
        } catch (cause) {
          throw new Error(
            `Menu ${name} did not show ${words}\n${await s.page.evaluate(() => document.body.innerText)}\nChips: ${await s.page.evaluate(() => [...document.querySelectorAll('[data-zerops-surface="sidebar-production-chip"]')].map((chip) => chip.getAttribute("aria-label")))}`,
            { cause },
          );
        }
      }),
    absent: (name: string) =>
      Effect.promise(async () => {
        await s.page.waitForFunction(
          (name) =>
            ![
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-mate-name"], [data-zerops-surface="sidebar-project-toggle"]',
              ),
            ].some(
              (row) =>
                row.getBoundingClientRect().height > 0 &&
                row.innerText.split("\n").some((line) => line.trim() === name),
            ),
          { timeout: 15_000, polling: "raf" },
          name,
        );
      }),
    grouped: (name: string, app: string) =>
      Effect.promise(async () => {
        await s.page.waitForFunction(
          (name, app) => {
            const headings = [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-project"]'),
            ].filter((heading) => heading.getBoundingClientRect().height > 0);
            return [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-mate-name"]',
              ),
            ].some((row) => {
              if (row.getBoundingClientRect().height === 0 || row.innerText.trim() !== name)
                return false;
              const heading = headings.findLast(
                (heading) =>
                  (heading.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
              );
              return heading?.innerText.split("\n")[0]?.trim() === app;
            });
          },
          { timeout: 15_000, polling: "raf" },
          name,
          app,
        );
      }),
    toggle: (app: string) => Effect.promise(() => clickText(s.page, "sidebar-project-toggle", app)),
    chip: (words: string, within = 15_000) =>
      Effect.promise(async () => {
        try {
          await s.page.waitForFunction(
            (words) =>
              [
                ...document.querySelectorAll<HTMLElement>(
                  '[data-zerops-surface="sidebar-production-chip"]',
                ),
              ].some(
                (chip) =>
                  chip.getBoundingClientRect().height > 0 &&
                  new RegExp(words, "i").test(chip.getAttribute("aria-label") ?? ""),
              ),
            { timeout: within, polling: "raf" },
            words,
          );
        } catch (cause) {
          throw new Error(
            `Menu environment chip did not show ${words}\n${await s.page.evaluate(() => document.body.innerText)}\nChips: ${await s.page.evaluate(() => [...document.querySelectorAll('[data-zerops-surface="sidebar-production-chip"]')].map((chip) => chip.getAttribute("aria-label")))}`,
            { cause },
          );
        }
      }),
  };
  return {
    ...s,
    menu,
    stage: (name: string, app: string) =>
      Effect.gen(function* () {
        yield* s.given.project(name, { app, kind: "stage", environmentName: "stage" });
        yield* stageService(s.drivers, name);
      }),
    colleague: {
      reports: (name: string, patch: Partial<OverviewMain> = {}, kind: MateThreadKind = "idle") =>
        reportConversation(s.drivers, name, patch, kind),
      holdsDetails: (app: string) => holdDetails(s.drivers, app),
      releasesDetails: releaseDetails(s.drivers),
      moves: (name: string, app: string | null) => moveMate(s.drivers, name, app),
      deletes: (name: string) => removeProject(s.drivers, name),
      denies: (name: string) => denyProjectRead(s.drivers, name),
      settlesRefusal: (name: string) =>
        settleProjectRefusal(s.drivers, name, s.clock.advance, () =>
          s.page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          ),
        ),
      builds: (name: string) => startStageBuild(s.drivers, name),
    },
  };
});
