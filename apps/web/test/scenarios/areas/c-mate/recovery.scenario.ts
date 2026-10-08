import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, reportContainer, projectGrant, deleteProjectEvidence } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const setup = (freezeClock = true) =>
  Effect.gen(function* () {
    const s = yield* createScenario([installArea]);
    yield* s.given.project("Wren", { mate: true });
    const chat = mateChat(s);
    const wire = chat.fixture("Wren");
    wire.history();
    if (freezeClock) yield* Effect.promise(() => s.clock.install());
    yield* s.given.signedIn;
    yield* chat.when.open("Wren");
    return { s, chat, wire };
  });

describe("C: source failures keep the conversation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // A proved restart failure must name both the Mate and startup cause, not an intentional stop.
    it.effect("a failed restart has its cause and a direct restart action", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        reportContainer(s.drivers, "Wren", "ACTION_FAILED", true);
        wire.disconnect();
        yield* chat.then.text("Wren couldn't restart.");
        yield* chat.then.text("Its startup command failed.");
        yield* chat.then.control("Retry restart");
        yield* chat.then.text("Open in Zerops");
        yield* chat.then.noText("I'm stopped.");
        yield* chat.then.once("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );
    // An intentional stop must offer the platform start operation directly beside the conversation.
    it.effect("a stopped container offers Start beside retained history", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        reportContainer(s.drivers, "Wren", "STOPPED");
        wire.disconnect();
        yield* chat.then.text("Wren's container is stopped.");
        yield* chat.then.text("Start Wren to reconnect.");
        yield* chat.then.control("Start");
        yield* chat.when.press("Start");
        yield* Effect.promise(() =>
          s.drivers.zerops.waitForRequest("PUT /service-stack/service-Wren/start"),
        );
        yield* chat.then.once("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );
    // A 403 and projectNotFound are different owner facts; restoration must release the retained gate.
    it.effect(
      "revoked project access is named and an authoritative regrant reopens its route",
      () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup();
          projectGrant(s.drivers, "Wren", false);
          yield* chat.then.text("You no longer have access to Wren's project");
          yield* chat.then.noText("The existing conversation is still here");
          yield* chat.then.noText("was deleted");
          projectGrant(s.drivers, "Wren", true);
          yield* Effect.promise(() => s.clock.advanceStepped(30_000));
          yield* chat.then.once("The existing conversation is still here");
          yield* chat.then.noText("You no longer have access");
          yield* s.then.noExternalNetwork;
        }),
    );
    // Confirmed deletion must remove the dead platform link on both chat and project routes.
    it.effect("project deletion is named and leaves no dead Open in Zerops link", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup();
        deleteProjectEvidence(s.drivers, "Wren");
        yield* chat.then.text("Wren's project was deleted");
        yield* chat.then.noText("The existing conversation is still here");
        yield* chat.then.noText("Open in Zerops");
        yield* Effect.promise(() => s.page.goto(`${s.page.url().split("/env-")[0]}/mate/Wren`));
        // A cold URL holds only its id; it must not invent a name from that id.
        yield* chat.then.text("The Mate's project was deleted");
        yield* chat.then.noText("Open in Zerops");
        yield* s.then.noExternalNetwork;
      }),
    );
    // A lost socket cannot decide that an active turn completed, failed or vanished.
    it.effect(
      "an active run interrupted during transport loss returns with history and draft",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup(false);
          wire.run("active-run", "running");
          yield* chat.then.control("Stop generation", "button");
          yield* chat.when.type("Keep this draft through the interruption");
          wire.disconnect();
          wire.run("active-run", "interrupted");
          yield* chat.then.once("The existing conversation is still here");
          yield* chat.then.draft("Keep this draft through the interruption");
          yield* chat.then.control("Stop generation", "button", false);
          expect(wire.sentTurnCount()).toBe(0);
          yield* s.then.noExternalNetwork;
        }),
    );
    // Elapsed time alone must never end a provider's reported running turn.
    it.effect("a long run stays working until the provider reports its result", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        wire.run("long-run", "running");
        yield* chat.then.control("Stop generation", "button");
        yield* Effect.promise(() => s.clock.advance(4 * 60 * 60 * 1000, true));
        yield* chat.then.control("Stop generation", "button");
        yield* chat.then.once("The existing conversation is still here");
        yield* chat.then.noText("couldn't restart");
        wire.message("long-result", "assistant", "The long inspection finished", "long-run");
        wire.run("long-run", "completed", null, "long-result");
        yield* chat.then.once("The long inspection finished");
        yield* chat.then.control("Stop generation", "button", false);
        yield* s.then.noExternalNetwork;
      }),
    );
    // Expiry of a recorded provider login must offer sign-in without hiding history.
    it.effect("an expired Codex login blocks sending and preserves the conversation", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup();
        wire.expireLogin();
        yield* chat.then.once("The existing conversation is still here");
        yield* chat.then.text("Sign in");
        yield* chat.then.text("Codex");
        yield* chat.when.type("Keep my unsent request");
        yield* chat.when.key("Enter");
        yield* chat.then.draft("Keep my unsent request");
        expect(wire.sentTurnCount()).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
