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
import { ThreadId } from "@t3tools/contracts";

import { HandedOverResume } from "./engine/ports.ts";
import { ProviderSessionDirectory } from "./provider/Services/ProviderSessionDirectory.ts";

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
