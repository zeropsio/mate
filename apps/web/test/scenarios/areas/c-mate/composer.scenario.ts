import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { installArea } from "./fake.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { mateChat } from "./dsl.ts";

describe("C: agent selection and contextual drafts", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // What waits for review moved from the composer to the conversation's header (the owner,
    // 2026-10-13: "add it somewhere to the app bar in detail"): the same pill for the Mate's owner
    // and for a colleague reading along, with Review for anyone who may review.
    it.effect(
      "a Mate's change waiting for a review stands in its conversation's header, for its owner and a colleague reading along, and opens from there",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          s.given.person("dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
          const change = yield* changeFixture(s);
          const chat = mateChat(s);
          chat.fixture().history();
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerViewport(s.page));
          yield* s.when.menu.opensMate("Ada");
          yield* s.then.conversation.appears;
          const openHeaderReview = (page: typeof s.page) =>
            Effect.promise(async () => {
              const button =
                '[class~="@container/header-actions"] button[aria-label="Review Add the order summary"]';
              await page.waitForSelector(button, { visible: true });
              const header = page.locator(button);
              expect(
                await page.$eval(
                  '[class~="@container/header-actions"]',
                  (node) => node.textContent,
                ),
                "ASSERTION: review waits in the conversation header",
              ).toContain("Review");
              await header.click();
            });
          yield* chat.then.text("Review");
          yield* openHeaderReview(s.page);
          yield* chat.then.text("What it does");
          yield* chat.then.text(change.description);
          yield* chat.when.key("Escape");
          const colleague = yield* s.given.browserActor({ person: "dev" });
          yield* colleague.given.signedIn;
          const theirs = mateChat({ ...s, ...colleague });
          yield* theirs.when.openReadOnly("Ada");
          yield* theirs.then.text("Review");
          yield* openHeaderReview(colleague.page);
          yield* theirs.then.text("What it does");
          yield* theirs.then.text(change.description);
          yield* theirs.when.key("Escape");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
