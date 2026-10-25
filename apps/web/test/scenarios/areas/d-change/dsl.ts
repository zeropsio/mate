// @effect-diagnostics nodeBuiltinImport:off -- temporary git checkout for a real Mate push.
import { inProcessCore } from "../../harness/hqCore.ts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { enrollMate } from "../../../../../hq/test/harness/runningCore.ts";
import { gitClient } from "../../../../../hq/test/harness/gitClient.ts";
import { remoteOf } from "../../../../../hq/test/harness/mates.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ChangeDetailResponse } from "@t3tools/shared/hqChanges";
import { MateState } from "@t3tools/shared/mateLink";
import { expect } from "@effect/vitest";
import type { ElementHandle } from "puppeteer-core";
import { openAccountMenu } from "../../harness/browser.ts";
import type { createScenario } from "../../harness/scenario.ts";
import { changeFixture as originalChangeFixture } from "../../fakes/d-change/changes.ts";
export { anotherOrganization } from "../../fakes/d-change/changes.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;
const decodeDetail = Schema.decodeUnknownEffect(ChangeDetailResponse);
const decodeMateState = Schema.decodeUnknownSync(MateState);

/** Real HQ outcomes and another real push; scenarios contain only user actions and assertions. */
export const changeFixture = Effect.fn(function* (s: Scenario) {
  const change = yield* originalChangeFixture(s);
  const appId = s.appIds.get("Shop")!;
  const path = `/api/apps/${appId}/changes/appdev/1`;
  return {
    ...change,
    closedWithBranch: Effect.gen(function* () {
      const response = yield* s.drivers.core.call("GET", path, { session: s.owner });
      expect(response.status).toBe(200);
      const record = yield* decodeDetail(response.body);
      expect(record.change.state).toBe("closed");
      const git = yield* inProcessCore(s.drivers.core).gitHost.git;
      const branches = yield* git.branches({ appId, id: "appdev" });
      expect(branches.items.find((branch) => branch.ref === "refs/heads/mate/Ada/1")?.sha).toBe(
        record.change.head,
      );
    }),
    pushAgain: Effect.gen(function* () {
      const credential = yield* enrollMate(s.drivers.core.call, s.drivers.core.fake, "Ada");
      const git = yield* gitClient;
      yield* git.checked([
        "clone",
        "--branch",
        "mate/Ada/1",
        remoteOf(s.drivers.core.origin, credential, appId, "appdev"),
        "work",
      ]);
      const work = NodePath.join(git.dir, "work");
      yield* Effect.sync(() => NodeFS.writeFileSync(NodePath.join(work, "tax.txt"), "Tax: 4\n"));
      yield* git.checked(["add", "tax.txt"], work);
      yield* git.checked(["commit", "-m", "Show tax"], work);
      const head = yield* git.checked(["rev-parse", "HEAD"], work);
      yield* git.checked(["push", "origin", "HEAD:refs/heads/mate/Ada/1"], work);
      yield* s.drivers.links
        .get("Ada")!
        .takeWhere(
          "HQ recorded the newer change head",
          (frame) =>
            frame.type === "state" &&
            decodeMateState(frame.mate).changes.some(
              (change) => change.repo === "appdev" && change.number === 1 && change.head === head,
            ),
        );
    }),
  };
});

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
