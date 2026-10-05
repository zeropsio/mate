// @effect-diagnostics preferSchemaOverJson:off -- human-readable failure diagnostics.
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
          { timeout: 15_000, polling: "raf" },
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
      Effect.timeout("10 seconds"),
    );
  });
  const finish = Effect.fn("e-env.finish")(function* (
    tier: "stage" | "production",
    outcome: "FINISHED" | "FAILED" = "FINISHED",
  ) {
    const process = yield* deployment(tier);
    endBuild(s.drivers.zerops, process.id, outcome);
  });
  const click = (label: string) =>
    Effect.promise(() =>
      page.locator(`::-p-aria(${label}[role="button"])`).setTimeout(15_000).click(),
    );
  const rowShows = (tag: string, words: string) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (tag, words) =>
            [
              ...document.querySelectorAll<HTMLElement>('[data-zerops-surface="environment-name"]'),
            ].some((el) => el.innerText === tag && el.closest("li")?.innerText.includes(words)),
          { timeout: 15_000, polling: "raf" },
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
        const button = [...(name?.closest("li")?.querySelectorAll("button") ?? [])].find(
          (el) => el.innerText === "Roll back to this",
        );
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
      { timeout: 10_000, polling: "raf" },
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
  return {
    when: { open, finish, click, releaseFromReview, reload, rollBack, editVersion },
    // oxlint-disable-next-line unicorn/no-thenable
    then: { text, rowShows, running, releaseDisabled, keepsDocument },
    deployment,
  };
}
