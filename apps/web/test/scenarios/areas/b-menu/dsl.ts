import type { MateFake } from "../../fakes/mate.ts";
import { expect } from "@effect/vitest";
import type { Page } from "puppeteer-core";
import * as Effect from "effect/Effect";
import type { ElementHandle } from "puppeteer-core";
import { clickText, menuMateIn } from "../../harness/browser.ts";
import type { ScenarioExtension, ScenarioOptions } from "../../harness/scenario.ts";
import type { OverviewMain, MateThreadKind } from "@t3tools/shared/mateLink";
import { createScenario } from "../../harness/scenario.ts";
import {
  conversationHistory,
  relayAttention,
  restartMate,
  speakFromRunBefore,
  reportAttention,
  reportConversation,
  moveMate,
  removeProject,
  denyProjectRead,
  startStageBuild,
  stageService,
  holdDetails,
  releaseDetails,
} from "./fake.ts";

/** Read the application's actual environment buttons, in the page's order: production, then its stages. */
export function environmentRows(page: Page, expected: ReadonlyArray<string>) {
  return Effect.promise(async () => {
    await page
      .waitForFunction(
        (expected) => {
          const section = [...document.querySelectorAll("main section")].find(
            (section) => section.querySelector("h2")?.textContent === "Environments",
          );
          const rows = [
            ...(section?.querySelectorAll("button[data-zerops-environment-id]") ?? []),
          ].flatMap((row) => {
            const name = row.firstChild?.textContent?.trim();
            return name === undefined ? [] : [name];
          });
          return JSON.stringify(rows) === JSON.stringify(expected);
        },
        { polling: "raf" },
        expected,
      )
      .catch(async (cause) => {
        const actual = await page.evaluate(() => {
          const section = [...document.querySelectorAll("main section")].find(
            (section) => section.querySelector("h2")?.textContent === "Environments",
          );
          return [
            ...(section?.querySelectorAll("button[data-zerops-environment-id]") ?? []),
          ].flatMap((row) => {
            const name = row.firstChild?.textContent?.trim();
            return name === undefined ? [] : [name];
          });
        });
        expect(actual, "The application retains its exact environment rows.").toEqual(expected);
        throw cause;
      });
    expect(
      await page.evaluate(() => {
        const section = [...document.querySelectorAll("main section")].find(
          (section) => section.querySelector("h2")?.textContent === "Environments",
        );
        return [...(section?.querySelectorAll("button[data-zerops-environment-id]") ?? [])].flatMap(
          (row) => {
            const name = row.firstChild?.textContent?.trim();
            return name === undefined ? [] : [name];
          },
        );
      }),
    ).toEqual(expected);
  });
}

export function openEnvironment(page: Page, appId: string, name: string, id: string) {
  return Effect.promise(async () => {
    const button = await page.waitForFunction(
      (name) => {
        const section = [...document.querySelectorAll("main section")].find(
          (section) => section.querySelector("h2")?.textContent === "Environments",
        );
        return [...(section?.querySelectorAll("button[data-zerops-environment-id]") ?? [])].find(
          (row) => row.firstChild?.textContent?.trim() === name,
        );
      },
      { polling: "raf" },
      name,
    );
    await (button.asElement() as ElementHandle<HTMLElement>).click();
    await page
      .waitForFunction(
        (path) => location.pathname === path,
        { polling: "raf" },
        `/group/${appId}/${id}`,
      )
      .catch((cause) => {
        expect(new URL(page.url()).pathname, `Opening ${name} reaches its environment route.`).toBe(
          `/group/${appId}/${id}`,
        );
        throw cause;
      });
    expect(new URL(page.url()).pathname).toBe(`/group/${appId}/${id}`);
  });
}

export const menuScenario = Effect.fn("menu.scenario")(function* (
  extensions: ScenarioExtension[] = [],
  options: ScenarioOptions = {},
) {
  const s = yield* createScenario(extensions, options);
  const menu = {
    actions: (name: string, expected: ReadonlyArray<string>) =>
      Effect.promise(async () => {
        await s.page.locator(`[data-zerops-mate-row="${name}"]`).click({ button: "right" });
        await s.page.waitForSelector('[data-zerops-mate-menu="open"]', {
          visible: true,
        });
        const mutations = ["rename", "face", "assign", "move", "delete"];
        await s.page.waitForFunction(
          (expected, mutations) =>
            expected.every((id) => {
              const entry = document.querySelector(`[data-zerops-mate-menu="${id}"]`);
              return entry !== null && entry.getAttribute("aria-disabled") !== "true";
            }) &&
            [...document.querySelectorAll("[data-zerops-mate-menu]")].filter((entry) =>
              mutations.includes(entry.getAttribute("data-zerops-mate-menu")!),
            ).length === expected.length,
          { polling: "raf" },
          expected,
          mutations,
        );
        expect(
          await s.page.$$eval(
            "[data-zerops-mate-menu]",
            (entries, mutations) =>
              entries
                .map((entry) => entry.getAttribute("data-zerops-mate-menu")!)
                .filter((id) => mutations.includes(id)),
            mutations,
          ),
        ).toEqual(expected);
        await s.page.keyboard.press("Escape");
      }),
    text: (name: string, words: string, surface = "sidebar-mate", within = 15_000) =>
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
            { timeout: within, polling: "raf" },
            name,
            words,
            surface,
          );
        } catch (cause) {
          throw new Error(
            `Menu ${name} did not show ${words}\n${await s.page.evaluate(() => document.body.innerText)}\nChips: ${await s.page.evaluate(() => [...document.querySelectorAll('[data-zerops-surface="sidebar-project-env-tag"]')].map((chip) => chip.getAttribute("aria-label")))}`,
            { cause },
          );
        }
      }),
    /** The row of Mate `name` shows no `surface` line within `within` ms. */
    lacks: (name: string, surface: string, within: number) =>
      Effect.promise(() =>
        s.page.waitForFunction(
          (name, surface) =>
            [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]'),
            ].some(
              (row) =>
                row
                  .querySelector<HTMLElement>('[data-zerops-surface="sidebar-mate-name"]')
                  ?.innerText.trim() === name &&
                row.getBoundingClientRect().height > 0 &&
                row.querySelector(`[data-zerops-surface="${surface}"]`) === null,
            ),
          { timeout: within, polling: "raf" },
          name,
          surface,
        ),
      ),
    /** The row of Mate `name` shows no `surface` line at any moment of the next `during` ms. */
    keepsLacking: (name: string, surface: string, during: number) =>
      Effect.promise(async () => {
        const shown = await s.page
          .waitForFunction(
            (name, surface) =>
              [
                ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]'),
              ].some(
                (row) =>
                  row
                    .querySelector<HTMLElement>('[data-zerops-surface="sidebar-mate-name"]')
                    ?.innerText.trim() === name &&
                  row.querySelector(`[data-zerops-surface="${surface}"]`) !== null,
              ),
            { timeout: during, polling: "raf" },
            name,
            surface,
          )
          .then(
            () => true,
            () => false,
          );
        if (shown) throw new Error(`Menu ${name} showed ${surface} within ${during} ms`);
      }),
    /**
     * The row of Mate `name` says `tone` within `within` ms: no dot since round 5 — its face carries
     * the state, and its accessible name says it in words.
     */
    dot: (name: string, tone: "attention" | "unread" | "failed", within: number) =>
      Effect.promise(() =>
        s.page.waitForFunction(
          (name, words) =>
            [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="sidebar-mate"]'),
            ].some(
              (row) =>
                row
                  .querySelector<HTMLElement>('[data-zerops-surface="sidebar-mate-name"]')
                  ?.innerText.trim() === name &&
                row.getAttribute("aria-label") === `${name}, ${words}`,
            ),
          { timeout: within, polling: "raf" },
          name,
          { attention: "Waiting for you", unread: "Unseen reply", failed: "Stopped on an error" }[
            tone
          ],
        ),
      ),
    absent: (name: string) =>
      Effect.promise(async () => {
        await s.page.waitForFunction(
          (name) =>
            ![
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-mate-name"], [data-zerops-surface="sidebar-project-name"]',
              ),
            ].some(
              (row) =>
                row.getBoundingClientRect().height > 0 &&
                row.innerText.split(/\n|\s·\s/).some((line) => line.trim() === name),
            ),
          { polling: "raf" },
          name,
        );
      }),
    keepsConversation: (url: string, page: Page = s.page) =>
      Effect.promise(async () => {
        expect(page.url()).toBe(url);
        expect(await page.$('[role="textbox"]')).not.toBeNull();
      }),
    opensApplication: (name: string) =>
      Effect.promise(async () => {
        // The project's ···: its group's, or the one its only Mate's row shares with it.
        const more = await s.page.waitForFunction(
          (name) => {
            const said = (node: Element | null) =>
              node?.textContent
                ?.replaceAll("\u00a0", " ")
                .replace(/, \d+ Mates$/, "")
                .trim();
            const row = [
              ...document.querySelectorAll<HTMLElement>(
                // A lone Mate's ··· sits in its row's box, beside the row's own button.
                '[data-zerops-surface="sidebar-project-row"], [data-zerops-surface="sidebar-mate-row"]',
              ),
            ].find((row) => {
              const words = said(
                row.querySelector(
                  '[data-zerops-surface="sidebar-project-name"], [data-zerops-surface="sidebar-mate-name"]',
                ),
              );
              return words === name || words?.startsWith(`${name} · `) === true;
            });
            return row?.querySelector<HTMLElement>('button[aria-label^="More for"]') ?? null;
          },
          { polling: "raf" },
          name,
        );
        await (more.asElement() as ElementHandle<HTMLElement>).click();
        await s.page.locator("::-p-aria(Open project)").click();
        await s.page.waitForFunction(
          (name) =>
            [...document.querySelectorAll("h1")].some((heading) => heading.textContent === name),
          { polling: "raf" },
          name,
        );
      }),
    movesMate: (name: string, app: string) =>
      Effect.promise(async () => {
        await s.page.locator(`[data-zerops-mate-row="${name}"]`).click({ button: "right" });
        await s.page.locator('[data-zerops-mate-menu="move"]').click();
        const form = '[data-zerops-surface="move-to-group-form"]';
        await s.page.locator(`${form} ::-p-aria(${app})`).click();
        await s.page.locator(`${form} ::-p-aria(Move)`).click();
        await s.page.waitForSelector(form, { hidden: true });
      }),
    environmentSlots: (words: string, offered: ReadonlyArray<"Add stage" | "Put it live">) =>
      Effect.promise(async () => {
        try {
          await s.page.waitForFunction(
            (words, offered) => {
              const main = document.querySelector("main");
              const buttons = [...(main?.querySelectorAll("button") ?? [])]
                .map((button) => button.innerText.trim())
                .filter((name) => name === "Add stage" || name === "Put it live");
              return (
                main?.innerText.includes(words) === true &&
                buttons.length === offered.length &&
                offered.every((name) => buttons.includes(name))
              );
            },
            { polling: "raf" },
            words,
            offered,
          );
        } catch (cause) {
          throw new Error(
            `Environment slots did not show ${words} with ${offered.join(", ")}\n${await s.page.evaluate(() => document.body.innerText)}`,
            { cause },
          );
        }
      }),
    grouped: (name: string, app: string, page: Page = s.page) =>
      Effect.promise(() => menuMateIn(page, name, app)),
    toggle: (app: string) => Effect.promise(() => clickText(s.page, "sidebar-project", app)),
    chip: (words: string, within = 15_000) =>
      Effect.promise(async () => {
        try {
          await s.page.waitForFunction(
            (words) =>
              [
                ...document.querySelectorAll<HTMLElement>(
                  '[data-zerops-surface="sidebar-project-env-tag"]',
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
            `Menu places tag did not show ${words}\n${await s.page.evaluate(() => document.body.innerText)}\nChips: ${await s.page.evaluate(() => [...document.querySelectorAll('[data-zerops-surface="sidebar-project-env-tag"]')].map((chip) => chip.getAttribute("aria-label")))}`,
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
      said: (name: string, text: string) => conversationHistory(s.drivers, name, text),
      reports: (name: string, patch: Partial<OverviewMain> = {}, kind: MateThreadKind = "idle") =>
        reportConversation(s.drivers, name, patch, kind),
      attends: (name: string, says: Parameters<MateFake["publishAttention"]>[0]) =>
        reportAttention(s.drivers, name, says),
      /** Its attention moves up its link to HQ only. */
      relays: (name: string, says: Parameters<MateFake["reviseAttention"]>[0]) =>
        relayAttention(s.drivers, name, says),
      /** Its server restarts: its attention's next word is its next epoch's first revision. */
      restarts: (name: string) => restartMate(s.drivers, name),
      /** Its run before the last restart, back from a partition, says `says` late. */
      speaksFromRunBefore: (name: string, says: Parameters<MateFake["lateFromRunBefore"]>[0]) =>
        speakFromRunBefore(s.drivers, name, says),
      holdsDetails: (app: string) => holdDetails(s.drivers, app),
      releasesDetails: releaseDetails(s.drivers),
      moves: (
        name: string,
        app: string | null,
        kind?: "mate" | "stage" | "production" | "devstage",
      ) => moveMate(s.drivers, name, app, kind),
      deletes: (name: string) => removeProject(s.drivers, name),
      denies: (name: string) => denyProjectRead(s.drivers, name),
      builds: (name: string) => startStageBuild(s.drivers, name),
    },
  };
});
