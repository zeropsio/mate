import { scenarioSuite } from "../../harness/suite.ts";
import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import {
  reportConversation,
  reportAttention,
  restartMate,
  relayAttention,
  speakFromRunBefore,
} from "../b-menu/fake.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// Z26/Z35: what a Mate reports and what each person read keep their own meaning.
describe("C: reading, replay and attention", () => {
  scenarioSuite((it) => {
    it.effect("a source epoch and each person's reading evidence keep their own meaning", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        s.given.person("dev", {
          role: "Developer",
          grants: { Ada: "BASIC_USER", Bea: "BASIC_USER" },
        });
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history();
        chat.fixture("Bea").history("Bea is the conversation I parked on");
        yield* s.given.signedIn;
        // The owner first visits Ada only to read: the fake stamps its result on its fixed day,
        // before any visit, and an earlier visit would already prove that result seen.
        const colleague = yield* s.given.browserActor({ person: "dev" });
        yield* colleague.given.signedIn;
        const theirs = mateChat({ ...s, ...colleague });
        yield* chat.when.open("Bea", "Bea is the conversation I parked on");
        // Bea is the owner's: a colleague reads it along, no composer of theirs on it.
        yield* theirs.when.openReadOnly("Bea");
        yield* theirs.then.text("Bea is the conversation I parked on");
        wire.run("attention-result", "running");
        wire.say("Ada finished the newer inspection", "attention-result");
        wire.run("attention-result", "completed");
        const runId = wire.runOf("attention-result");
        const latestTurn = wire.latestTurn()!;
        const completedAt = latestTurn.completedAt!;
        const results = [
          {
            threadId: ThreadId.make("thread-Ada"),
            turnId: TurnId.make(runId),
            completedAt,
          },
        ];
        yield* reportConversation(s.drivers, "Ada", {
          latestTurn,
          session: { status: "ready", lastError: null },
        });
        yield* reportAttention(s.drivers, "Ada", { results });
        yield* chat.then.control("Ada, Unseen reply");
        yield* theirs.then.control("Ada, Unseen reply");
        yield* chat.when.open();
        yield* chat.when.read("Ada finished the newer inspection");
        yield* chat.then.control("Ada, Unseen reply", "button", false);
        yield* theirs.then.control("Ada, Unseen reply");
        yield* restartMate(s.drivers, "Ada");
        yield* relayAttention(s.drivers, "Ada", { results });
        yield* theirs.then.control("Ada, Unseen reply");
        yield* chat.then.control("Ada, Unseen reply", "button", false);
        yield* speakFromRunBefore(s.drivers, "Ada", {
          working: 1,
          waiting: 0,
          results: [],
          questions: [],
        });
        yield* relayAttention(s.drivers, "Ada", { results });
        yield* theirs.then.control("Ada, Unseen reply");
        yield* chat.then.control("Ada, Unseen reply", "button", false);
        // A still-open reader witnesses the late message's delivery after the owner closes.
        yield* theirs.when.openReadOnly("Ada");
        yield* theirs.then.text("Ada finished the newer inspection");
        yield* chat.when.press("Account: owner");
        yield* chat.when.press("Sign out", "menuitem");
        yield* chat.then.control("Continue with your Zerops account");
        wire.say("This late reply belongs to the closed account");
        wire.browser({ type: "state", status: "live", title: "Old account's browser" });
        yield* theirs.then.text("This late reply belongs to the closed account");
        yield* chat.then.noText("This late reply belongs to the closed account");
        yield* chat.then.noText("Old account's browser");
        yield* chat.then.noText("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
