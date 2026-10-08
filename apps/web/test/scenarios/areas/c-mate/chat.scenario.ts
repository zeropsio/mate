import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat, projectAccessRevoked } from "./dsl.ts";

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  chat.fixture().history();
  return { s, chat };
});

describe("C: opening a Mate and chat", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a broken identity door/OAuth exchange or a slow first opening that never reaches the chosen chat.
    it.effect("first open crosses the door and OAuth", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches returning to a parked Mate losing its history, opening another chat, or repeating the cold door.
    it.effect("returning to a parked Mate preserves history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.project("Bea", { mate: true });
        chat.fixture("Bea").history("Bea's conversation history");
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.when.open("Bea", "Bea's conversation history");
        yield* chat.when.returnTo();
        yield* chat.when.type("Keep this draft with Ada");
        yield* chat.when.open("Bea", "Bea's conversation history");
        yield* chat.when.returnTo();
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.draft("Keep this draft with Ada");
        yield* chat.then.noButton("Sign in");
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a saved conversation link failing in a browser that has never opened this Mate.
    it.effect("cold direct conversation URL opens the named Mate and its history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        expect(chat.fixture().doorCount()).toBe(0);
        yield* chat.when.visit("/env-Ada/thread-Ada");
        yield* chat.then.ready("Ada");
        yield* chat.then.headerName("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches the project-level Mate URL stranding a signed-in user on the arrival page instead of the chat.
    it.effect("/mate/project-id opens the Mate conversation from a cold door", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.visit("/mate/Ada");
        yield* chat.then.ready("Ada");
        yield* chat.then.headerName("Ada");
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches reload losing the selected chat/history or turning a kept session into a slow cold opening.
    it.effect("reload restores history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.reload();
        yield* chat.then.headerName("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Enter dropping a prompt, showing it only in the editor, or losing the acknowledged message on reload.
    it.effect("sending a message puts it in the durable visible conversation", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.send("Please inspect the Shop project");
        yield* chat.then.once("Please inspect the Shop project");
        yield* chat.when.reload("Ada", "Please inspect the Shop project");
        yield* chat.then.headerName("Ada");
        yield* chat.then.once("Please inspect the Shop project");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an agent's approval never appearing or Approve failing to release the pending command.
    it.effect("approve an agent command and see it resolve", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        chat.fixture().approval();
        yield* chat.then.text("Command approval");
        yield* chat.then.text("vp run build");
        yield* chat.when.click("Approve");
        yield* chat.then.text("Agent received your response");
        yield* chat.then.noButton("Approve");
        expect(chat.fixture().commandDecisions()).toEqual(["approved"]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Decline silently approving the command or leaving the approval stuck in the composer.
    it.effect("decline an agent command and see it resolve", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        chat.fixture().approval();
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("vp run build");
        yield* chat.when.click("Decline");
        yield* chat.then.text("Agent received your response");
        yield* chat.then.noButton("Decline");
        expect(chat.fixture().commandDecisions()).toEqual(["declined"]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an agent question disappearing, sending the display label instead of its answer, or remaining unanswered after selection.
    it.effect("answer an agent question with a suggested option", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.enabledControl("GPT-5.4");
        chat.fixture().question();
        yield* chat.then.text("Which environment should I inspect?");
        yield* chat.when.click("Staging");
        yield* chat.then.text("Agent received your response");
        yield* chat.then.noText("Which environment should I inspect?");
        expect(chat.fixture().receivedStagingAnswer()).toBe(true);
        expect(chat.fixture().responseCount()).toBe(1);
        yield* chat.step(
          "a free answer carries only the picture attached to that question",
          Effect.gen(function* () {
            chat.fixture().run("question-custom-run", "running");
            chat.fixture().question("question-custom", "question-custom-run");
            yield* chat.then.text("Which environment should I inspect?");
            yield* chat.when.type("Inspect the preview shown here");
            yield* chat.when.pastePicture("question-preview.png");
            yield* chat.then.text("Attached to this answer");
            chat.fixture().responseRefusal = "Your answer was refused. Sign in and retry.";
            yield* chat.when.key("Enter");
            yield* chat.then.text("Your answer was refused. Sign in and retry.");
            yield* chat.then.composerText("Inspect the preview shown here");
            yield* chat.then.text("question-preview.png");
            chat.fixture().responseRefusal = null;
            yield* chat.when.key("Enter");
            const answer = yield* Effect.promise(() =>
              chat.fixture().waitForAnswer("question-custom"),
            );
            expect(answer).toMatchObject({
              requestId: "question-custom",
              answers: { target: "Inspect the preview shown here" },
              attachmentsByQuestionId: { target: [{ name: "question-preview.png" }] },
            });
            chat.fixture().run("question-custom-run", "completed");
            yield* chat.then.once("Inspect the preview shown here");
            yield* chat.when.activateLast("Show work");
            yield* chat.when.press("Open question-preview.png");
            yield* chat.then.text("question-preview.png");
            yield* chat.when.key("Escape");
            yield* chat.then.noText("Attached to this answer");
            yield* chat.then.draft("");
            yield* chat.when.reload();
            yield* chat.when.activateLast("Show work");
            yield* chat.then.once("Inspect the preview shown here");
            yield* chat.then.control("Open question-preview.png");
          }),
        );
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a removed signer's login leaving Send enabled in an open chat.
    it.effect("offboarding the signer blocks new turns without losing history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        chat.fixture().ownership = "owner";
        yield* s.given.signedIn;
        yield* chat.when.open();
        const sent = chat.fixture().sentTurnCount();
        chat.fixture().offboardSigner();
        yield* chat.then.signInRequired;
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.when.attemptSend("Do not start a turn on the removed login");
        yield* chat.then.noText("Do not start a turn on the removed login");
        expect(chat.fixture().sentTurnCount()).toBe(sent);
        expect(chat.fixture().responseCount()).toBe(0);
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a still-ponging platform receiver keeping a revoked conversation or write controls.
    it.effect("project revocation withdraws the open Mate while its receiver still pongs", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.project("Bea", { mate: true });
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("The existing conversation is still here");
        const sent = chat.fixture().sentTurnCount();
        yield* projectAccessRevoked(s, "Ada");
        yield* chat.then.noText("The existing conversation is still here");
        yield* chat.then.noComposer;
        yield* s.then.menu.row("Bea").appears();
        expect(chat.fixture().sentTurnCount()).toBe(sent);
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a composer sending on an unrecorded personal login despite the missing permission to run that agent.
    it.effect("an unrecorded personal login blocks Send with an explanation", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        chat.fixture().ownership = "unrecorded";
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.attemptSend("This must not reach the agent");
        yield* chat.then.blockedPromptRemains("This must not reach the agent");
        yield* chat.then.sendDisabled;
        yield* chat.then.text("This agent's sign-in was not recorded");
        yield* chat.then.noText("This must not reach the agent");
        expect(chat.fixture().sentTurnCount()).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches another member's personal Mate exposing a composer or approval controls while its history is still readable.
    it.effect("someone else's personal Mate is readable but cannot be sent to or approved", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        chat.fixture().approval();
        chat.fixture().ownership = "colleague";
        yield* s.given.signedIn;
        yield* chat.when.openReadOnly();
        yield* chat.then.text("only they can run this agent");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.text("vp run build");
        yield* chat.then.text("Waiting for the agent's owner");
        yield* chat.then.noComposer;
        yield* chat.then.noButton("Approve");
        yield* chat.then.noButton("Decline");
        expect(chat.fixture().responseCount()).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
