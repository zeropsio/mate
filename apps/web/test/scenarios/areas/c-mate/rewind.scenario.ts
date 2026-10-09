import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

describe("C: rewind into the composer", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "rewinding keeps the unsent draft before the restored prompt and leaves its old attachments behind",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.message("original", "user", "Inspect the original screenshot", "original-run", {
            attachments: [
              {
                type: "image",
                id: "old-picture",
                name: "original.png",
                mimeType: "image/png",
                sizeBytes: 10,
                width: 1,
                height: 1,
              },
            ],
          });
          wire.run("original-run", "completed");
          wire.checkpoint("original-run");
          yield* s.given.signedIn;
          yield* chat.when.open("Ada", "Inspect the original screenshot");
          yield* chat.when.type("Keep this unsent draft");
          yield* chat.when.press("Revert to this message");
          yield* chat.when.press("Revert and keep changes");
          const command = yield* Effect.promise(() =>
            wire.waitForCommand("thread.conversation.revert"),
          );
          expect(command).toMatchObject({ threadId: "thread-Ada", turnCount: 0 });
          expect(command).not.toHaveProperty("restoreFiles");
          wire.event("thread.reverted", { threadId: wire.mate.thread.id, turnCount: 0 });
          wire.snapshot({ messages: [], activities: [], checkpoints: [], latestTurn: null });
          yield* chat.then.composerText("Inspect the original screenshot");
          const restored = yield* Effect.promise(() =>
            s.page.evaluate(
              () =>
                [...document.querySelectorAll('[role="textbox"]')].find(
                  (element) => element.getBoundingClientRect().height > 0,
                )?.textContent,
            ),
          );
          expect(restored).toContain("Keep this unsent draft");
          expect(restored!.indexOf("Keep this unsent draft")).toBeLessThan(
            restored!.indexOf("Inspect the original screenshot"),
          );
          yield* chat.when.key("Enter");
          const sent = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start"));
          expect(sent).toMatchObject({
            message: {
              text: "Keep this unsent draft\n\nInspect the original screenshot",
              attachments: [],
            },
          });
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
