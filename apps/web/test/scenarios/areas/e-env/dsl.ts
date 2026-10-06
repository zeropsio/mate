// @effect-diagnostics preferSchemaOverJson:off -- human-readable failure diagnostics.
import { effectReceipt } from "../../harness/waits.ts";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { expect } from "@effect/vitest";
import type { Page } from "puppeteer-core";
import type { environmentFixture } from "./fake.ts";
import { endBuild } from "../../fakes/e-env/builds.ts";

type Fixture = Effect.Success<typeof environmentFixture>;

export function environmentActions(f: Fixture, page: Page = f.s.page) {
  const { s, appId } = f;
  const text = (wanted: string) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (wanted) => document.body.innerText.includes(wanted),
          { timeout: page.getDefaultTimeout(), polling: "raf" },
          wanted,
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
      effectReceipt(`${tier} RUNNING stack.build process`),
    );
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
          { timeout: options.within ?? page.getDefaultTimeout(), polling: "raf" },
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
    yield* click("Release v0.1.0");
  });
  const reload = Effect.promise(async () => {
    await page.reload();
  });
  const rollBack = (tag: string) =>
    Effect.promise(async () => {
      const point = await page.evaluate((tag) => {
        const name = [
          ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="environment-name"]'),
        ].find((el) => el.innerText === tag);
        const button = [
          ...(name?.closest("[data-zerops-environment-row]")?.querySelectorAll("button") ?? []),
        ].find((el) => el.innerText === "Roll back to this");
        if (!button) throw new Error(`No Roll back offered for ${tag}`);
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, tag);
      await page.mouse.click(point.x, point.y);
    });
  const editVersion = (value: string) =>
    Effect.promise(() => page.locator('::-p-aria(Version[role="textbox"])').fill(value));
  const releaseDisabled = Effect.promise(async () => {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLButtonElement>("button")].some(
          (button) => button.innerText.startsWith("Release v") && button.disabled,
        ),
      { timeout: page.getDefaultTimeout(), polling: "raf" },
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
      expect(
        s.drivers.zerops.rows("process").find((row) => row.id === process.id)?.finished,
      ).toBeNull();
    });
  const longRunningGap = Effect.gen(function* () {
    const process = yield* deployment("stage");
    // Age the durable operation beyond the former 75-minute limit, then lose its socket.
    // The reconnect registration must still report the owner's RUNNING state.
    yield* s.drivers.core
      .sql`UPDATE hq_deploy_job SET submitted_at = now() - interval '80 minutes' WHERE process_id = ${process.id}`;
    const zerops = s.drivers.zerops;
    const follow = [...zerops.subscriptions.values()].find(
      (r) =>
        r.apiToken === "hq" &&
        r.kind === "app-version" &&
        r.search.some((filter) => filter.name === "id"),
    );
    expect(follow, "HQ registered the accepted operation through realtime").toBeDefined();
    const registrations = zerops.requests.get("POST /process/search") ?? 0;
    zerops.sockets.get(follow!.receiver)!.close();
    yield* Effect.promise(() => zerops.waitForRequest("POST /process/search", registrations + 2));
  });
  const keepsStageRunning = Effect.promise(async () => {
    const guard = await page.evaluateHandle(() => {
      const state = {
        failures: [] as string[],
        observer: undefined as MutationObserver | undefined,
      };
      const check = () => {
        for (const row of document.querySelectorAll<HTMLElement>(
          '[data-zerops-surface="stop-service-job"]',
        )) {
          const text = row.innerText;
          if (/failed|refused/i.test(text) && !state.failures.includes(text))
            state.failures.push(text);
        }
      };
      check();
      state.observer = new MutationObserver(check);
      state.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      return state;
    });
    s.drivers.cleanup.push(() => guard.dispose());
    return Effect.promise(async () => {
      const failures = await guard.evaluate((state) => {
        state.observer?.disconnect();
        return state.failures;
      });
      expect(
        failures,
        "A RUNNING Zerops build must not be reported failed or refused by HQ's clock",
      ).toEqual([]);
    });
  });
  return {
    when: {
      open,
      longRunningGap,
      finish,
      rollBackOnZerops,
      click,
      releaseFromReview,
      reload,
      rollBack,
      editVersion,
    },
    // oxlint-disable-next-line unicorn/no-thenable
    then: { text, rowShows, running, releaseDisabled, keepsDocument, keepsWord, keepsStageRunning },
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
