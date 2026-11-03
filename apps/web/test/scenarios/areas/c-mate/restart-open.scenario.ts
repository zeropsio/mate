import { scenarioSuite } from "../../harness/suite.ts";
import { describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { createScenario } from "../../harness/scenario.ts";

const REPLY = "The Shop project looks healthy";
const RESTARTING = "Ada is restarting.";
// Bounded on purpose: a Mate that answers again opens within its next reads, never minutes later.
const WITHIN_MS = 45_000;

/** Waits until `holds` is true in the page, or fails with what the page shows. */
const until = (page: Page, why: string, holds: (reply: string, restarting: string) => boolean) =>
  Effect.promise(async () => {
    try {
      await page.waitForFunction(holds, { timeout: WITHIN_MS, polling: 250 }, REPLY, RESTARTING);
    } catch (cause) {
      throw new Error(`${why}\n${await page.evaluate(() => document.body.innerText)}`, { cause });
    }
  });

/**
 * Ada's conversation open, then Restart from its menu row: Zerops runs it as a process while the
 * tab never reads its container as RESTARTING (Juno, 2026-11-03), and its server goes down.
 */
const restartedFromItsMenu = Effect.gen(function* () {
  const s = yield* createScenario([], { mate: "real" });
  yield* s.given.project("Ada", { mate: true });
  const ada = s.drivers.realMates.get("Ada")!;
  s.drivers.zerops.writes.autoComplete = false;
  const restart = Promise.withResolvers<string>();
  s.drivers.zerops.handlers.unshift(async (request) => {
    if (
      request.method !== "PUT" ||
      !request.url.pathname.endsWith("/service-stack/service-Ada/restart")
    )
      return undefined;
    const id = s.drivers.zerops.writes.start("Ada", "stack.restart", ["service-Ada"]);
    restart.resolve(id);
    return { body: { id } };
  });
  yield* s.given.signedIn;
  yield* s.when.menu.opensMate("Ada");
  yield* s.then.conversation.appears;
  yield* ada.provider.turn([{ kind: "say", text: REPLY }]);
  yield* s.when.conversation.sends("Please inspect the Shop project");
  yield* s.then.conversation.showsMessage(REPLY);
  yield* Effect.promise(async () => {
    await s.page.locator("::-p-aria(More for Ada)").click();
    await s.page.locator('::-p-aria(Restart[role="menuitem"])').click();
    await s.page.locator('[role="dialog"] ::-p-aria(Restart[role="button"])').click();
  });
  const processId = yield* Effect.promise(() => restart.promise);
  yield* Effect.promise(() => ada.server.stop());
  yield* until(s.page, "Ada says it is restarting", (_reply, restarting) =>
    document.body.innerText.includes(restarting),
  );
  return { s, ada, processId };
});

describe("C: a Mate restarted under its open conversation", () => {
  scenarioSuite((it) => {
    // Juno, 2026-11-03: "Restart completed.", and its composer still said it was restarting.
    it.effect(
      "a Mate restarted from its menu stops saying it restarts once Zerops finished it",
      () =>
        Effect.gen(function* () {
          const { s, ada, processId } = yield* restartedFromItsMenu;
          s.drivers.zerops.writes.transition(processId, "FINISHED");
          yield* until(
            s.page,
            "Ada no longer says it is restarting",
            (_reply, restarting) => !document.body.innerText.includes(restarting),
          );
          yield* Effect.promise(() => ada.server.restart());
          yield* s.then.conversation.showsMessage(REPLY);
          yield* s.then.noExternalNetwork;
        }),
    );

    // Juno, 2026-11-03: reopened in the tab it was restarted from, its conversation stayed on its
    // stand-in for minutes, through reloads, until a fresh browser.
    it.effect("a Mate restarted from its menu opens after a reload as soon as it answers", () =>
      Effect.gen(function* () {
        const { s, ada, processId } = yield* restartedFromItsMenu;
        yield* Effect.promise(() => s.page.reload());
        yield* Effect.promise(() => ada.server.restart());
        // The platform's restart process ends as its container is back.
        s.drivers.zerops.writes.transition(processId, "FINISHED");
        yield* until(
          s.page,
          "Ada's conversation opens",
          (reply, restarting) =>
            [...document.querySelectorAll("[data-timeline-row-kind]")].some((row) =>
              row.textContent?.includes(reply),
            ) && !document.body.innerText.includes(restarting),
        );
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
