import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea as installChat } from "../c-mate/fake.ts";
import { mateChat } from "../c-mate/dsl.ts";
import { changeFixture, review } from "../d-change/dsl.ts";
import { installMutations } from "./fake.ts";
import { mutations, originalMateRemains } from "./dsl.ts";

describe("Lifecycle: Move", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches own Move losing the active conversation/question, duplicating placement in another tab, or taking a sibling/source change with it.
    it.effect(
      "own Move keeps the conversation and source repository change while both tabs converge",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installChat, installMutations]);
          const change = yield* changeFixture(s);
          yield* s.given.project("Bea", { mate: true, app: "Shop" });
          yield* s.given.project("Cara", { mate: true, app: "Other" });
          const chat = mateChat(s);
          chat.fixture().history();
          chat.fixture().question();
          yield* s.given.signedIn;
          const other = yield* s.given.browserActor({
            person: "owner",
            context: s.page.browserContext(),
          });
          yield* other.given.signedIn;
          const otherChat = mateChat({ ...s, page: other.page, when: other.when });
          yield* mutations(s.page).focus;
          yield* s.when.menu.opensMate("Ada");
          yield* chat.then.ready("Ada");
          yield* mutations(other.page).focus;
          yield* other.when.menu.opensMate("Ada");
          yield* otherChat.then.ready("Ada");
          yield* chat.then.text("The existing conversation is still here");
          yield* otherChat.then.text("Which environment should I inspect?");
          yield* mutations(s.page).move("Ada", "Other");
          for (const actor of [s, other]) {
            yield* mutations(actor.page).placement("Ada", "Other");
            yield* mutations(actor.page).placement("Bea", "Shop");
            yield* actor.then.noReload;
          }
          for (const [actor, conversation] of [
            [s, chat],
            [other, otherChat],
          ] as const) {
            yield* mutations(actor.page).focus;
            yield* conversation.then.path("/env-Ada/thread-Ada");
            yield* conversation.then.text("The existing conversation is still here");
            yield* conversation.then.text("Which environment should I inspect?");
          }
          yield* mutations(s.page).focus;
          yield* chat.when.click("Staging");
          yield* mutations(other.page).focus;
          yield* otherChat.then.text("Agent received your response");
          expect(chat.fixture().responseCount()).toBe(1);
          yield* mutations(other.page).focus;
          yield* review({ page: other.page, web: s.web }).direct(change.direct);
          yield* review({ page: other.page, web: s.web }).text(change.title);
          yield* review({ page: other.page, web: s.web }).text(change.description);
          yield* review({ page: other.page, web: s.web }).text("summary.txt");
          originalMateRemains(s.drivers, "Ada", "Other - Ada");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
