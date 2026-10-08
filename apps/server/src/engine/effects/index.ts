/**
 * The engine's effect handlers, one per kind, as the worker finds them.
 *
 * @module engine/effects
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
    return handlersOf(
      yield* makeRunPrepare,
      yield* makeSessionOpen,
      yield* makeProviderSend,
      yield* makeProviderSteer,
      yield* makeProviderInterrupt,
      yield* makeProviderRespond,
      yield* makeSessionClose,
      yield* makeWorkspaceFinish,
      yield* makeHistoryImport(),
    );
  }),
);
