import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { Page } from "puppeteer-core";
import { createScenario } from "../../harness/scenario.ts";

// How many visible timeline rows' text nodes read exactly `text`.
const shownTimes = (page: Page, text: string) =>
  Effect.promise(() =>
    page.evaluate((text) => {
      let count = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const element = walker.currentNode.parentElement;
        if (
          walker.currentNode.textContent === text &&
          element?.closest("[data-timeline-row-kind]") &&
          element.getBoundingClientRect().height > 0
        )
          count++;
      }
      return count;
    }, text),
  );

describe("foundation: the real Mate", () => {
  scenarioSuite((it) => {
    // Catches a send that never reaches the provider, or a reply duplicated by reload or restart.
    it.effect(
      "a sent message reaches the provider and its reply shows once across reload and restart",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* s.given.project("Ada", { mate: true });
          const ada = s.drivers.realMates.get("Ada")!;
          yield* s.given.signedIn;
          yield* s.when.menu.opensMate("Ada");
          yield* s.then.conversation.appears;
          yield* ada.provider.turn([{ kind: "say", text: "The Shop project looks healthy" }]);
          yield* s.when.conversation.sends("Please inspect the Shop project");
          expect((yield* ada.provider.received).input.input).toBe(
            "Please inspect the Shop project",
          );
          yield* s.then.conversation.showsMessage("The Shop project looks healthy");
          expect(yield* shownTimes(s.page, "The Shop project looks healthy")).toBe(1);

          // Reloaded, the reply waits for the Mate's answer to the conversation read, then shows once.
          const conversationRead = ada.gate.hold((tag) => tag === "subscribeEngineConversation");
          yield* Effect.promise(() => s.page.reload());
          yield* Effect.promise(() => conversationRead.held);
          yield* s.then.conversation.appears;
          expect(yield* shownTimes(s.page, "The Shop project looks healthy")).toBe(0);
          conversationRead.release();
          yield* s.then.conversation.showsMessage("The Shop project looks healthy");
          expect(yield* shownTimes(s.page, "The Shop project looks healthy")).toBe(1);

          yield* Effect.promise(() => ada.server.restart());
          yield* Effect.promise(() => s.page.reload());
          yield* s.then.conversation.showsMessage("Please inspect the Shop project");
          yield* s.then.conversation.showsMessage("The Shop project looks healthy");
          expect(yield* shownTimes(s.page, "The Shop project looks healthy")).toBe(1);
          expect(ada.provider.sends).toHaveLength(1);
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches a door that lets a read-only member into a Mate's conversation.
    it.effect("a read-only member is refused the Mate's conversation at its door", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* s.given.project("Ada", { mate: true });
        s.given.asPerson("reader");
        yield* s.given.signedIn;
        yield* s.when.menu.opensMate("Ada");
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () => document.body.innerText.includes("Ada isn't available with your access."),
            { polling: "raf" },
          ),
        );
        expect(yield* Effect.promise(() => s.page.$$('[role="textbox"]'))).toHaveLength(0);
        expect(s.drivers.realMates.get("Ada")!.provider.sends).toEqual([]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches one Mate's turn reaching another Mate's provider or timeline.
    it.effect("two Mates each answer only their own conversation", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.project("Bea", { mate: true });
        const ada = s.drivers.realMates.get("Ada")!;
        const bea = s.drivers.realMates.get("Bea")!;
        yield* s.given.signedIn;

        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* ada.provider.turn([{ kind: "say", text: "Ada checked the logs" }]);
        yield* s.when.conversation.sends("Ada, check the logs");
        yield* s.then.conversation.showsMessage("Ada checked the logs");

        const adaUrl = s.page.url();
        yield* s.when.menu.opensMate("Bea");
        // Ada's composer stays until Bea's conversation replaces it.
        yield* Effect.promise(() =>
          s.page.waitForFunction((adaUrl) => location.href !== adaUrl, { polling: 100 }, adaUrl),
        );
        yield* s.then.conversation.appears;
        yield* bea.provider.turn([{ kind: "say", text: "Bea ran the tests" }]);
        yield* s.when.conversation.sends("Bea, run the tests");
        yield* s.then.conversation.showsMessage("Bea ran the tests");
        expect(yield* shownTimes(s.page, "Ada checked the logs")).toBe(0);

        expect(ada.provider.sends.map((send) => send.input.input)).toEqual(["Ada, check the logs"]);
        expect(bea.provider.sends.map((send) => send.input.input)).toEqual(["Bea, run the tests"]);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
