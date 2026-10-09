/**
 * The engine's `HandedOverResume` port, read from the provider's session directory: the engine
 * reaches the drivers only through `ProviderService`, and the wiring hands it what the directory
 * holds.
 *
 * @module engineSessionDirectory
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ConversationId, ThreadId } from "@t3tools/contracts";

import { MateEngine, providerThreadOf } from "./engine/MateEngine.ts";
import { HandedOverResume } from "./engine/ports.ts";
import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory.ts";

/** Resolve a client's conversation to the current provider thread, or the V1 thread. */
export const currentProviderThread = Effect.gen(function* () {
  const engine = yield* MateEngine;
  return Effect.fn("currentProviderThread")(function* (threadId: ThreadId | undefined) {
    if (threadId === undefined || !engine.live) return threadId;
    const conversation = ConversationId.make(threadId);
    const generation = yield* engine.generation(conversation);
    return generation === undefined ? undefined : providerThreadOf(conversation, generation);
  });
});

/**
 * What another instance of the driver left on the thread, from the provider's session directory:
 * its resume cursor, unless the binding is the picked instance's own (the provider resumes that
 * itself). No directory, or an unreadable one, reads as nothing left.
 */
export const serverHandedOverResume = Layer.effect(
  HandedOverResume,
  Effect.map(Effect.serviceOption(ProviderSessionDirectory), (directory) =>
    HandedOverResume.of({
      of: ({ thread, instanceId }) =>
        Option.match(directory, {
          onNone: () => Effect.succeed(undefined),
          onSome: (sessions) =>
            sessions.getBinding(ThreadId.make(thread)).pipe(
              Effect.map((binding) =>
                Option.isSome(binding) &&
                binding.value.providerInstanceId !== undefined &&
                binding.value.providerInstanceId !== instanceId &&
                binding.value.resumeCursor != null
                  ? binding.value.resumeCursor
                  : undefined,
              ),
              Effect.orElseSucceed(() => undefined),
            ),
        }),
    }),
  ),
);
