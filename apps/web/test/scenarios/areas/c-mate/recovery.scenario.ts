import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Wren", { mate: true });
  const chat = mateChat(s);
  const wire = chat.fixture("Wren");
  wire.history();
  yield* Effect.promise(() => s.clock.install());
  yield* s.given.signedIn;
  yield* chat.when.open("Wren");
  return { s, chat, wire };
});

describe("C: source failures keep the conversation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Expiry of a recorded provider login must offer sign-in without hiding history.
    it.effect("an expired Codex login blocks sending and preserves the conversation", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup;
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
