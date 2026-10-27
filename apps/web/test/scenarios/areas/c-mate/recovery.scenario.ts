import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { rendered } from "../../harness/completedHttp.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea, reportContainer } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// The first wait of a Mate connection's reconnect ladder (spec-mate §3.8).
const FIRST_RECONNECT_RUNG_MS = 2_000;

const setup = () =>
  Effect.gen(function* () {
    const s = yield* createScenario([installArea]);
    yield* s.given.project("Wren", { mate: true });
    const chat = mateChat(s);
    const wire = chat.fixture("Wren");
    wire.history();
    yield* Effect.promise(() => s.clock.install());
    yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
    yield* s.given.signedIn;
    yield* chat.when.open("Wren");
    return { s, chat, wire };
  });

describe("C: source failures keep the conversation", () => {
  scenarioSuite((it) => {
    it.effect(
      "a stopped container offers Start beside retained history",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup();
          reportContainer(s.drivers, "Wren", "STOPPED");
          wire.disconnect();
          yield* chat.then.text("Wren's container is stopped.");
          yield* chat.then.control("Start");
          yield* chat.then.once("The existing conversation is still here");
          yield* chat.when.press("Start");
          yield* Effect.promise(() =>
            s.drivers.zerops.waitForRequest("PUT /service-stack/service-Wren/start"),
          );
          expect(s.drivers.zerops.requests.get("PUT /service-stack/service-Wren/start")).toBe(1);
          yield* chat.then.once("The existing conversation is still here");
          yield* s.then.noExternalNetwork;
        }),
      10_000,
    );
    it.effect(
      "an active run interrupted during transport loss returns with history and draft",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup();
          wire.run("active-run", "running");
          yield* chat.then.control("Stop generation");
          yield* chat.when.type("Keep this draft through the interruption");
          wire.disconnect();
          wire.run("active-run", "interrupted");
          // The client reconnects after its first backoff rung; on the scenario clock that wait
          // passes only when advanced, a rung at a time until the stale Stop control is gone.
          yield* Effect.promise(async () => {
            const stop = '::-p-aria([name="Stop generation"][role="button"])';
            for (let look = 0; look < 40; look++) {
              await rendered(s.page);
              if (!(await s.page.$(stop))) return;
              await s.clock.advance(FIRST_RECONNECT_RUNG_MS);
            }
            throw new Error("Stop generation stayed after 40 reconnect rungs");
          });
          yield* chat.then.once("The existing conversation is still here");
          yield* chat.then.draft("Keep this draft through the interruption");
          expect(wire.sentTurnCount()).toBe(0);
          yield* s.then.noExternalNetwork;
        }),
      10_000,
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
