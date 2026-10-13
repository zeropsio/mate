import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// "notice": an older session's compaction is offered — a row at the conversation's end since S6.
export const composerStates = ["plain", "notice", "review"] as const;

// Shared real-client input for geometry and the separate transparency compatibility check.
export const composerLayout = Effect.fn("composerLayout")(function* (
  state: (typeof composerStates)[number] | "before-notice",
) {
  const real = state === "plain" || state === "review";
  const s = yield* createScenario(real ? [] : [installArea], { mate: real ? "real" : "fake" });
  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
  if (state === "review") yield* changeFixture(s);
  else yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  const exchanges = [
    ...Array.from(
      { length: 25 },
      (_, i) =>
        [
          `Earlier question ${i}`,
          "> Important: keep this conversation readable.\n\n".repeat(8),
        ] as const,
    ),
    ["Finish here", "The last answer is above the composer."] as const,
  ];
  if (real) {
    const mate = s.drivers.realMates.get("Ada")!;
    yield* s.given.signedIn;
    yield* chat.when.openReadOnly();
    yield* mate.provider.turn([{ kind: "say", text: exchanges[0]![1] }]);
    yield* chat.when.send(exchanges[0]![0]);
    yield* mate.provider.received;
    yield* Effect.promise(() =>
      s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
        polling: "raf",
        timeout: 8000,
      }),
    );
    const conversationId = ConversationId.make(new URL(s.page.url()).pathname.split("/").at(-1)!);
    const protocol = MATE_ENGINE_PROTOCOLS[0]!;
    const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
    const frames = yield* Queue.unbounded<EngineConversationFrame>();
    yield* mate.server.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
      Stream.runForEach((frame) => Queue.offer(frames, frame)),
      Effect.forkScoped,
    );
    const ended = (ordinal: number) =>
      Effect.gen(function* () {
        while (true) {
          const frame = yield* Queue.take(frames);
          if (
            (frame.type === "snapshot" || frame.type === "changes") &&
            frame.runs.some((run) => run.ordinal === ordinal && run.state === "ended")
          )
            return;
        }
      }).pipe(Effect.timeout("8 seconds"));
    yield* ended(1);
    for (const [index, [question, answer]] of exchanges.entries()) {
      if (index === 0) continue;
      yield* mate.provider.turn([{ kind: "say", text: answer }]);
      const receipt = yield* mate.server.engine.wire.send(
        {
          protocol,
          conversationId,
          commandId: CommandId.make(`composer-history-${index}`),
          text: question,
        },
        caller,
      );
      expect(receipt._tag).toBe("Accepted");
      expect((yield* mate.provider.received).input.input).toBe(question);
      yield* ended(index + 1);
    }
    yield* Effect.promise(() => s.page.reload());
  } else {
    // Retained: the scripted OpenCode driver has no Claude login/context snapshot source.
    const wire = chat.fixture();
    wire.history("Read this long conversation");
    for (const [question, answer] of exchanges) wire.exchange(question, answer);
    if (state === "notice") {
      wire.claudeLoginFacts("ready");
      wire.engine.assign({ instanceId: "claudeAgent", model: "sonnet", driver: "claudeAgent" });
      wire.engine.context({ usedTokens: 180_000 });
    }
    yield* s.given.signedIn;
    yield* chat.when.open("Ada", "Finish here");
  }
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
  if (state === "notice") yield* chat.then.text("Resume with less context");
  // What waits for review stands in the conversation's header (2026-10-13), not on the composer.
  if (state === "review") yield* chat.then.text("Review work");

  return { s, chat };
});
