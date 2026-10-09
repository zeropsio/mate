/**
 * The engine's effect handlers, one per kind, as the worker finds them.
 *
 * @module engine/effects
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { contentAssetsAt } from "../../assets/ContentAssets.ts";
import { ServerConfig } from "../../config.ts";

import * as Context from "effect/Context";

import type { Conversations } from "../Conversations.ts";
import { EffectHandlers, handlersOf, type EffectHandler } from "../outbox/EffectWorker.ts";
import { makeHistoryImport } from "./historyImport.ts";
import { makeProviderInterrupt } from "./providerInterrupt.ts";
import { makeProviderRespond } from "./providerRespond.ts";
import { makeProviderSend } from "./providerSend.ts";
import { makeProviderSteer } from "./providerSteer.ts";
import { makeRunPrepare } from "./runPrepare.ts";
import { makeSessionClose } from "./sessionClose.ts";
import { makeSessionOpen } from "./sessionOpen.ts";
import { makeWorkspaceFinish } from "./workspaceFinish.ts";

/**
 * Handlers of another owner kind's effects (the crew's), built with the engine's own conversations
 * at hand: a crew delivery tells a crewmate's conversation. Absent: the engine's own handlers only.
 */
export class EngineEffectExtensions extends Context.Service<
  EngineEffectExtensions,
  Effect.Effect<ReadonlyArray<EffectHandler>, never, Conversations>
>()("t3/engine/effects/EngineEffectExtensions") {}

export const layer = Layer.effect(
  EffectHandlers,
  Effect.gen(function* () {
    // The import keeps V1's pictures where the server keeps every picture.
    const config = yield* Effect.serviceOption(ServerConfig);
    const extensions = yield* Effect.serviceOption(EngineEffectExtensions);
    const extra = Option.isSome(extensions) ? yield* extensions.value : [];
    return handlersOf(
      yield* makeRunPrepare,
      yield* makeSessionOpen,
      yield* makeProviderSend,
      yield* makeProviderSteer,
      yield* makeProviderInterrupt,
      yield* makeProviderRespond,
      yield* makeSessionClose,
      yield* makeWorkspaceFinish,
      yield* makeHistoryImport({
        pictures: () =>
          Option.match(config, {
            onNone: () => null,
            onSome: (value) => contentAssetsAt(value.stateDir),
          }),
      }),
      ...extra,
    );
  }),
);
