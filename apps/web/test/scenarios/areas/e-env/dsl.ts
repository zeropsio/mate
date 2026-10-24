// @effect-diagnostics preferSchemaOverJson:off -- human-readable failure diagnostics.
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { expect } from "@effect/vitest";
import type { Page } from "puppeteer-core";
import type { environmentFixture } from "./fake.ts";
import { endBuild } from "../../fakes/e-env/builds.ts";

type Fixture = Effect.Success<typeof environmentFixture>;

export function environmentActions(f: Fixture, page: Page = f.s.page) {
  const { s, appId } = f;
  const text = (wanted: string, selector = "body") =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (wanted, selector) =>
            [...document.querySelectorAll<HTMLElement>(selector)].some((element) =>
              element.innerText.includes(wanted),
            ),
          { polling: "raf" },
          wanted,
          selector,
        );
      } catch (cause) {
        throw new Error(
          `Expected visible ${JSON.stringify(wanted)}\n${await page.evaluate(() => document.body.innerText)}`,
          { cause },
        );
      }
    });
  const open = (tier: "stage" | "production") =>
    Effect.promise(() => page.goto(`${s.web.origin}/group/${appId}/Shop-${tier}`));
  const openFromNavigation = Effect.gen(function* () {
    yield* Effect.promise(() =>
      page
        .locator(
          '[data-zerops-group="' + appId + '"] [data-zerops-surface="sidebar-project-sites"]',
        )
        .click(),
    );
    yield* Effect.promise(() =>
      page
        .locator(
          '[data-zerops-surface="sidebar-project-sites-popover"] [data-sites-place="production"] [data-zerops-surface="sidebar-project-sites-place"]',
        )
        .click(),
    );
  });
  const reviewFromReleaseTag = Effect.gen(function* () {
    yield* Effect.promise(() =>
      page
        .locator(
          `[data-zerops-group="${appId}"] [data-zerops-surface="sidebar-project-release-mark"]`,
        )
        .click(),
    );
    expect(page.url()).not.toContain(`/Shop-production`);
  });
  /** The release's review lists what goes out: the changes it carries, by their titles. */
  const releaseEntriesShow = (title: string) =>
    Effect.promise(() =>
      page.waitForFunction(
        (title) => {
          const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
          return dialog?.innerText.includes("What goes out") && dialog.innerText.includes(title);
        },
        { polling: "raf" },
        title,
      ),
    );
  const productionBuildCount = Effect.sync(
    () =>
      s.drivers.zerops
        .rows("process")
        .filter((row) => row.projectId === "Shop-production" && row.actionName === "stack.build")
        .length,
  );
  const deployment = Effect.fn("e-env.deployment")(function* (tier: "stage" | "production") {
    return yield* Effect.sync(() =>
      s.drivers.zerops
        .rows("process")
        .find(
          (row) =>
            row.projectId === `Shop-${tier}` &&
            row.actionName === "stack.build" &&
            row.status === "RUNNING",
        ),
    ).pipe(
      Effect.filterOrFail((row) => row !== undefined),
      Effect.retry(Schedule.spaced("25 millis")),
      Effect.tap((process) =>
        s.drivers.core.deploys.changes.pipe(
          Stream.mapEffect(() => s.drivers.core.deploys.operations(appId)),
          Stream.filter((rows) =>
            rows.some(
              (row) => row.projectId === `Shop-${tier}` && row.handles.includes(process.id),
            ),
          ),
          Stream.take(1),
          Stream.runDrain,
        ),
      ),
      Effect.timeout("10 seconds"),
      Effect.tapError(() =>
        Effect.gen(function* () {
          const jobs = yield* s.drivers.core.sql`
            SELECT kind, project_id, sha, label, process_id, state, reason, evidence
            FROM hq_deploy_job WHERE project_id = ${`Shop-${tier}`}`;
          yield* Effect.logError("Build receipt missing", {
            tier,
            jobs,
            processes: s.drivers.zerops.rows("process"),
            versions: s.drivers.zerops.rows("app-version"),
            browser: yield* Effect.promise(() =>
              page.evaluate(() => ({
                route: location.pathname,
                visibility: document.visibilityState,
                text: document.body.innerText,
              })),
            ),
          });
        }),
      ),
    );
  });
  const finishImport = Effect.fn("e-env.finishImport")(function* (tier: "stage" | "production") {
    const process = yield* Effect.sync(() =>
      s.drivers.zerops
        .rows("process")
        .find(
          (row) =>
            row.projectId === `Shop-${tier}` &&
            row.actionName === "service-stack.create" &&
            row.status === "RUNNING",
        ),
    ).pipe(
      Effect.filterOrFail((row) => row !== undefined),
      Effect.retry(Schedule.spaced("25 millis")),
      Effect.timeout("10 seconds"),
    );
    s.drivers.zerops.writes.transition(process.id, "FINISHED");
  });
  const finish = Effect.fn("e-env.finish")(function* (
    tier: "stage" | "production",
    outcome: "FINISHED" | "FAILED" = "FINISHED",
  ) {
    const process = yield* deployment(tier);
    endBuild(s.drivers.zerops, process.id, outcome);
  });
  /**
   * Someone rolls the tier's service back in Zerops to the version it ran before, no build, and
   * its deploy ends.
   */
  const rollBackOnZerops = Effect.fn("e-env.rollBackOnZerops")(function* (
    tier: "stage" | "production",
  ) {
    const zerops = s.drivers.zerops;
    const previous = zerops
      .rows("app-version")
      .filter((row) => row.serviceStackId === `web-${tier}` && row.status === "BACKUP")
      .toSorted((left, right) => String(right.created).localeCompare(String(left.created)))[0];
    if (previous === undefined) return yield* Effect.die(`No earlier version of web-${tier}`);
    const processId = zerops.writes.activate(previous.id);
    zerops.writes.transition(processId, "FINISHED");
  });
  const click = (label: string) =>
    Effect.promise(() => page.locator(`::-p-aria(${label}[role="button"])`).click());
  const rowShows = (tag: string, words: string, options: { within?: number } = {}) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (tag, words) =>
            [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="environment-name"]'),
            ].some(
              (el) =>
                el.innerText === tag &&
                el.closest<HTMLElement>("[data-zerops-environment-row]")?.innerText.includes(words),
            ),
          { timeout: options.within ?? 30_000, polling: "raf" },
          tag,
          words,
        );
      } catch (cause) {
        throw new Error(
          `Release ${tag} must show ${words}\n${await page.evaluate(() => document.body.innerText)}`,
          { cause },
        );
      }
    });
  const keepsWord = (tag: string, word: string) =>
    Effect.promise(async () => {
      const guard = await recordReleaseWords(page, tag);
      s.drivers.cleanup.push(async () => {
        await guard.evaluate((state) => state.observer?.disconnect());
        await guard.dispose();
      });
      return Effect.promise(async () => {
        const words = await guard.evaluate((state) => {
          state.observer?.disconnect();
          return state.words;
        });
        expect(words, `Release ${tag} must continuously show ${word}`).toEqual([word]);
      });
    });
  const releaseFromReview = Effect.gen(function* () {
    yield* click("Review release");
    yield* text("Version");
    yield* click("Release v0.1.0 to production");
  });
  const reload = Effect.promise(async () => {
    await page.reload();
  });
  const rollBack = (tag: string) =>
    Effect.promise(async () => {
      await page
        .locator(
          `::-p-xpath(//*[@data-zerops-surface="environment-name" and normalize-space(.)="${tag}"]/ancestor::*[@data-zerops-environment-row][1]//button[normalize-space(.)="Roll back to this"])`,
        )
        .click();
    });
  const editVersion = (value: string) =>
    Effect.promise(() => page.locator('::-p-aria(Version[role="textbox"])').fill(value));
  const releaseDisabled = Effect.promise(async () => {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>("button")].some(
          (button) => button.innerText.startsWith("Release v") && button.disabled,
        ),
      { polling: "raf" },
    );
  });
  const keepsDocument = Effect.promise(async () => {
    const origin = await page.evaluate(() => performance.timeOrigin);
    return Effect.promise(async () =>
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin),
    );
  });
  const running = (tier: "stage" | "production") =>
    Effect.gen(function* () {
      const process = yield* deployment(tier);
      const jobs = yield* s.drivers.core.sql<{
        state: string;
        process_id: string;
      }>`SELECT state, process_id FROM hq_deploy_job WHERE project_id = ${`Shop-${tier}`} AND process_id = ${process.id}`;
      expect(jobs).toEqual([{ state: "building", process_id: process.id }]);
    });
  return {
    when: {
      open,
      openFromNavigation,
      reviewFromReleaseTag,
      finish,
      finishImport,
      rollBackOnZerops,
      click,
      releaseFromReview,
      reload,
      rollBack,
      editVersion,
    },
    // oxlint-disable-next-line unicorn/no-thenable -- `then` is the DSL's assertion step, never awaited.
    then: {
      text,
      rowShows,
      running,
      releaseDisabled,
      keepsDocument,
      keepsWord,
      releaseEntriesShow,
      productionBuildCount,
    },
    deployment,
  };
}

// Observe visible release words, retaining transient text changes between browser callbacks.
export function recordReleaseWords(page: Page, tag: string) {
  return page.evaluateHandle((tag) => {
    const state = {
      words: [] as string[],
      observer: undefined as MutationObserver | undefined,
    };
    const words = new Set(["Deploy failed", "Approved", "Live", "Refused"]);
    const record = (word: string) => {
      if (state.words.at(-1) !== word) state.words.push(word);
    };
    const isRow = (row: Element | null) =>
      row !== null &&
      [...row.querySelectorAll<HTMLElement>('[data-zerops-surface="environment-name"]')].some(
        (name) => name.innerText === tag,
      );
    const check = () => {
      const name = [
        ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="environment-name"]'),
      ].find((name) => name.innerText === tag);
      const row = name?.closest("[data-zerops-environment-row]");
      if (!row) return record("missing");
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const word = node.textContent?.trim() ?? "";
        if (words.has(word) && node.parentElement!.getBoundingClientRect().height > 0)
          return record(word);
      }
      record("missing word");
    };
    check();
    state.observer = new MutationObserver((mutations) => {
      // Old values also catch a word that flashed and changed back before this callback ran.
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          const parent =
            mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (isRow(parent?.closest("[data-zerops-environment-row]") ?? null)) {
            for (const node of [...mutation.removedNodes, ...mutation.addedNodes]) {
              const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
              const recordNode = (node: Node) => {
                const word = node.textContent?.trim() ?? "";
                if (words.has(word)) record(word);
              };
              if (node.nodeType === Node.TEXT_NODE) recordNode(node);
              while (walker.nextNode()) recordNode(walker.currentNode);
            }
          }
        }
        if (
          mutation.type === "characterData" &&
          words.has(mutation.oldValue?.trim() ?? "") &&
          isRow(mutation.target.parentElement?.closest("[data-zerops-environment-row]") ?? null)
        )
          record(mutation.oldValue!.trim());
      }
      check();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });
    return state;
  }, tag);
}
