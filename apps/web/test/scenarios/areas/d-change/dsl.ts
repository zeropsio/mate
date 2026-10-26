import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { ElementHandle } from "puppeteer-core";
import { openAccountMenu } from "../../harness/browser.ts";
import type { createScenario } from "../../harness/scenario.ts";
export { changeFixture, anotherOrganization } from "../../fakes/d-change/changes.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function review(s: Pick<Scenario, "page" | "web">) {
  let guardedDocument: number | undefined;
  const text = (words: string) =>
    Effect.promise(async () => {
      try {
        await s.page.waitForFunction(
          (words) =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="review"], [role="dialog"]',
              ),
            ].some(
              (node) => node.getBoundingClientRect().height > 0 && node.innerText.includes(words),
            ),
          { polling: "raf" },
          words,
        );
      } catch (error) {
        throw new Error(
          `Review missing: ${words}\n${await s.page.evaluate(() => document.body.innerText)}`,
          { cause: error },
        );
      }
    });
  const waitUntilMergeEnabled = async () => {
    try {
      await s.page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>("button")].some(
            (button) =>
              button.innerText.trim().startsWith("Merge") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        { polling: "raf" },
      );
    } catch (error) {
      throw new Error(
        `Merge unavailable\n${await s.page.evaluate(() => document.body.innerText)}`,
        { cause: error },
      );
    }
  };
  const mergeEnabled = Effect.promise(waitUntilMergeEnabled);
  /**
   * Opens a section the sheet folds to its row — Files, Conversation — as a person does; one the
   * frame shows unfolded (a change's page) is already open.
   */
  const unfold = async (title: string) => {
    const heading = await s.page.waitForFunction(
      (title) =>
        [...document.querySelectorAll<HTMLElement>(".rv-sec-h")].find(
          (node) =>
            node.getBoundingClientRect().height > 0 &&
            node.closest("[inert]") === null &&
            node.innerText.trim().startsWith(title),
        ) ?? null,
      { polling: "raf" },
      title,
    );
    const fold = await (heading.asElement() as ElementHandle<HTMLElement>).$(
      '.rv-fold-row[aria-expanded="false"]',
    );
    await fold?.click();
  };
  return {
    text,
    /** A file it changes, read where the sheet lists them: under Files, opened. */
    file: (name: string) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => unfold("Files"));
        yield* text(name);
      }),
    mergeEnabled,
    waitUntilMergeEnabled,
    chooseInitialOrganization: (name: string) =>
      Effect.promise(async () => {
        await s.page.locator("::-p-text(Choose an organization)").wait();
        await s.page.locator(`::-p-text(${name})`).click();
      }),
    switchOrganization: (name: string) =>
      Effect.promise(async () => {
        await openAccountMenu(s.page);
        try {
          await s.page.locator(`::-p-aria(${name}[role="menuitemradio"])`).click();
        } catch (cause) {
          const offered = await s.page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map(
              (item) => `${item.getAttribute("role")}: ${item.innerText.trim()}`,
            ),
          );
          throw new Error(`The account menu offered no ${name}: ${offered.join(" | ")}`, {
            cause,
          });
        }
        await s.page.waitForFunction(
          (name) =>
            [
              ...document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-account-organization"]',
              ),
            ].some(
              (node) => node.getBoundingClientRect().height > 0 && node.innerText.trim() === name,
            ),
          { polling: "raf" },
          name,
        );
      }),
    rememberUnknownPermission: Effect.promise(async () => {
      guardedDocument = await s.page.evaluate(() => {
        const history: string[] = [];
        Object.assign(window, { dChangeUnknownOffers: history });
        let visible = false;
        const check = () => {
          const shown = [
            ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="review"]'),
          ].some(
            (node) =>
              node.getBoundingClientRect().height > 0 &&
              node.innerText.includes("HQ has not said yet"),
          );
          if (shown && !visible) history.push("HQ has not said yet");
          visible = shown;
        };
        new MutationObserver(check).observe(document, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        check();
        return performance.timeOrigin;
      });
    }),
    sameDocument: Effect.promise(async () => {
      expect(await s.page.evaluate(() => performance.timeOrigin)).toBe(guardedDocument);
    }),
    unknownPermissionHistory: Effect.promise(() =>
      s.page.evaluate(
        () => (window as unknown as { dChangeUnknownOffers: string[] }).dChangeUnknownOffers,
      ),
    ),
    // A Mate's change waiting on the viewer: its project's row marks it, and the conversation it
    // opens holds the Review in its header.
    open: Effect.promise(async () => {
      await s.page.locator('[data-zerops-surface="sidebar-project-review-mark"]').click();
      await s.page
        .locator('.chat-header-review [data-zerops-surface="sidebar-project-review"]')
        .click();
    }),
    direct: (path: string) =>
      Effect.promise(async () => {
        await s.page.goto(s.web.origin + path);
      }),
    comment: (body: string) =>
      Effect.promise(async () => {
        await unfold("Conversation");
        await s.page.locator("::-p-aria(Say something on this change)").fill(body);
        await s.page.locator('::-p-aria(Comment[role="button"])').click();
      }),
    writeDraft: (body: string) =>
      Effect.promise(async () => {
        await unfold("Conversation");
        await s.page.locator("::-p-aria(Say something on this change)").fill(body);
      }),
    draftIs: (body: string) =>
      Effect.promise(async () => {
        await s.page.waitForFunction(
          (body) =>
            [
              ...document.querySelectorAll<HTMLTextAreaElement>(
                '[aria-label="Say something on this change"]',
              ),
            ].some((box) => box.value === body),
          {},
          body,
        );
      }),
    close: Effect.promise(async () => {
      await s.page.keyboard.press("Escape");
      await s.page.waitForSelector('[data-zerops-surface="review"]', {
        hidden: true,
      });
    }),
    // "Merge to <stage>" where the change has a stage: the button by what it does.
    merge: Effect.promise(async () => {
      await s.page.locator('[data-zerops-primary-action="Merge"]').click();
    }),
    askClose: Effect.promise(async () => {
      await s.page.locator('::-p-aria(Close without merging…[role="button"])').click();
    }),
    confirmClose: Effect.promise(async () => {
      await s.page.locator('::-p-aria(Close without merging[role="button"])').click();
    }),
    cannotClose: Effect.promise(async () => {
      expect(
        await s.page.evaluate(() =>
          [...document.querySelectorAll<HTMLButtonElement>("button")].some(
            (button) =>
              button.innerText.trim().startsWith("Close without merging") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        ),
      ).toBe(false);
    }),
    cannotMerge: Effect.promise(async () => {
      expect(
        await s.page.evaluate(() =>
          [...document.querySelectorAll<HTMLButtonElement>("button")].some(
            (button) =>
              button.innerText.trim().startsWith("Merge") &&
              !button.disabled &&
              button.getBoundingClientRect().height > 0,
          ),
        ),
      ).toBe(false);
    }),
  };
}
