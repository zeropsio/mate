import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

export const composerStates = ["plain", "notice", "stack", "review"] as const;

// Shared real-client input for geometry and the separate transparency compatibility check.
export const composerLayout = Effect.fn("composerLayout")(function* (
  state: (typeof composerStates)[number],
) {
  const s = yield* createScenario([installArea]);
  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
  if (state === "review") yield* changeFixture(s);
  else yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  const wire = chat.fixture();
  wire.history("Read this long conversation");
  for (let i = 0; i < 25; i++)
    wire.exchange(
      `Earlier question ${i}`,
      "> Important: keep this conversation readable.\n\n".repeat(8),
    );
  wire.exchange("Finish here", "The last answer is above the composer.");
  if (state === "notice" || state === "stack") {
    wire.claudeLoginFacts("ready");
    wire.activity("context-window.updated", "Context used", { usedTokens: 180_000 });
    wire.snapshot({
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "sonnet",
      },
    });
    if (state === "stack") {
      const primary = wire.mate.thread;
      wire.run("other-work", "running");
      wire.threadCollection(primary, [
        { ...wire.mate.thread, id: ThreadId.make("other-chat"), title: "Other work" },
      ]);
    }
  }
  yield* s.given.signedIn;
  yield* chat.when.open("Ada", "Finish here");
  yield* chat.then.text("The last answer is above the composer.");
  yield* Effect.promise(() =>
    s.page.waitForFunction(
      () => {
        const list = document.querySelector<HTMLElement>(".timeline-legend-list");
        return (
          list &&
          !document.querySelector(
            '[data-conversation-opening]:not([data-conversation-opening="complete"])',
          ) &&
          !document.querySelector("[data-timeline-placing]") &&
          Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop) <= 2
        );
      },
      { polling: "raf", timeout: 8000 },
    ),
  );
  if (state === "notice" || state === "stack") yield* chat.then.text("Resume with less context");
  if (state === "review") yield* chat.then.text("Ada is waiting for your review of #1");

  return { s, chat };
});
