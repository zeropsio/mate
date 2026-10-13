import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { installArea } from "./fake.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { mateChat } from "./dsl.ts";

describe("C: the conversation opening follows readiness", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "one waiting stage hands over to the ready conversation: owner-light-wide-sidebar",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture("Sage");
          wire.exchange("Earlier question", "Sage's conversation is ready");
          const read = wire.engine.holdOpen();
          yield* Effect.addFinalizer(() => Effect.sync(read.release));
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerViewport(s.page));
          yield* chat.when.openReadOnly("Sage");
          yield* Effect.promise(read.requested);
          yield* Effect.promise(() =>
            s.page.waitForSelector('[data-conversation-opening="waiting"]'),
          );
          const stage = yield* Effect.promise(() =>
            s.page.$('[data-conversation-opening="waiting"]'),
          );
          expect(stage).not.toBeNull();
          const count = () =>
            s.page.$$eval(
              "[data-chat-workspace-drop-target] [data-mate-face-state]",
              (faces) =>
                faces.filter(
                  (face) =>
                    face.getBoundingClientRect().height > 0 &&
                    getComputedStyle(face).opacity !== "0",
                ).length,
            );
          expect(yield* Effect.promise(count)).toBe(1);
          yield* chat.then.noText("Sage's conversation is ready");
          read.release();
          yield* chat.then.text("Sage's conversation is ready");
          yield* Effect.promise(() => waitForStillFrames(s.page));
          expect(
            yield* Effect.promise(() =>
              stage!.evaluate((node) => node.getAttribute("data-conversation-opening")),
            ),
          ).toBe("complete");
          expect(yield* Effect.promise(count)).toBe(1);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
