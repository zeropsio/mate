/**
 * Conversation and provider-session identities at the server wiring boundary: the current
 * provider thread, retained-image ownership, and the engine's `ThreadResume` port. The engine
 * reaches drivers only through `ProviderService`; this wiring hands it what the directory holds.
 *
 * @module engineSessionDirectory
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ConversationId, ThreadId } from "@t3tools/contracts";

import { MateEngine, providerThreadOf } from "./engine/MateEngine.ts";
import { ThreadResume, threadResumeOf } from "./engine/ports.ts";
import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory.ts";

/** Resolve a client's conversation to its current provider thread. */
export const currentProviderThread = Effect.gen(function* () {
  const engine = yield* MateEngine;
  return Effect.fn("currentProviderThread")(function* (threadId: ThreadId | undefined) {
    if (threadId === undefined) return threadId;
    const conversation = ConversationId.make(threadId);
    const generation = yield* engine.generation(conversation);
    return generation === undefined ? undefined : providerThreadOf(conversation, generation);
  });
});

/**
 * What a session of the thread resumes, from the conversation the provider's session directory
 * keeps on its binding. No directory, or an unreadable one, reads as nothing saved.
 */
export const serverThreadResume = Layer.effect(
  ThreadResume,
  Effect.map(Effect.serviceOption(ProviderSessionDirectory), (directory) =>
    ThreadResume.of({
      of: ({ thread, instanceId }) =>
        Option.match(directory, {
          onNone: () => Effect.succeed(threadResumeOf(undefined, instanceId)),
          onSome: (sessions) =>
            sessions.getBinding(ThreadId.make(thread)).pipe(
              Effect.map((binding) =>
                threadResumeOf(
                  Option.match(binding, {
                    onNone: () => undefined,
                    onSome: ({ providerInstanceId, resumeCursor }) => ({
                      instanceId: providerInstanceId,
                      cursor: resumeCursor,
                    }),
                  }),
                  instanceId,
                ),
              ),
              Effect.orElseSucceed(() => threadResumeOf(undefined, instanceId)),
            ),
        }),
    }),
  ),
);

/** Metadata and protected bytes use the same conversation owner: the engine's. */
export const resolveAssetContext = Effect.fn("resolveAssetContext")(function* (thread: ThreadId) {
  const engine = yield* Effect.serviceOption(MateEngine);
  return Option.isNone(engine) ? undefined : yield* engine.value.assetContext(thread);
});
