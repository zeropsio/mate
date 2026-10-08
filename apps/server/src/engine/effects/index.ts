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

import { EffectHandlers, handlersOf } from "../outbox/EffectWorker.ts";
import { makeHistoryImport } from "./historyImport.ts";
import { makeProviderInterrupt } from "./providerInterrupt.ts";
import { makeProviderRespond } from "./providerRespond.ts";
import { makeProviderSend } from "./providerSend.ts";
import { makeProviderSteer } from "./providerSteer.ts";
import { makeRunPrepare } from "./runPrepare.ts";
import { makeSessionClose } from "./sessionClose.ts";
import { makeSessionOpen } from "./sessionOpen.ts";
import { makeWorkspaceFinish } from "./workspaceFinish.ts";

export const layer = Layer.effect(
  EffectHandlers,
  Effect.gen(function* () {
    // The import keeps V1's pictures where the server keeps every picture.
    const config = yield* Effect.serviceOption(ServerConfig);
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
    );
  }),
);
