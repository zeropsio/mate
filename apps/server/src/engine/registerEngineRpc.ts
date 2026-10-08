/**
 * Registers the Mate engine's conversation wire (`subscribeEngineConversation`,
 * `subscribeEngineRows`, `engine.*`), spread by `ws.ts` beside `registerZeropsRpc`. Scopes stay in
 * `auth/RpcAuthorization.ts`: reading the conversation is the same read as V1's
 * `subscribeThread`, a send, stop, answer, dismissal or steer the same authority as a V1 dispatch.
 *
 * Every handler answers from the `MateEngine` the server was built with: its wire answers
 * `unserved` in V1 mode, and in mate mode serves the engine. The caller is the connecting session
 * (its subject from the authenticated session, never from RPC input); the revision its records
 * carry is the Mate's environment and start epoch, as its attention counts them.
 *
 * @module engine/registerEngineRpc
 */
import {
  WS_METHODS,
  type EnvironmentAuthorizationError,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { MateEngineService } from "./MateEngine.ts";
import type { WireCaller } from "./wire/EngineWire.ts";

type EngineRpcTag =
  | typeof WS_METHODS.subscribeEngineConversation
  | typeof WS_METHODS.subscribeEngineRows
  | typeof WS_METHODS.engineReadEarlier
  | typeof WS_METHODS.engineReadRun
  | typeof WS_METHODS.engineReadDetail
  | typeof WS_METHODS.engineReceipt
  | typeof WS_METHODS.engineSend
  | typeof WS_METHODS.engineStop
  | typeof WS_METHODS.engineAnswer
  | typeof WS_METHODS.engineDismiss
  | typeof WS_METHODS.engineSteer
  | typeof WS_METHODS.engineSwitchModel
  | typeof WS_METHODS.engineSetRuntimeMode
  | typeof WS_METHODS.engineAssignAgent;

type EngineRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: EngineRpcTag }>;

/** The handler function types `WsRpcGroup.of({...})` expects for exactly these tags. */
type EngineRpcHandlers = {
  readonly [Current in EngineRpc as Current["_tag"]]: Rpc.ToHandlerFn<Current, never>;
};

export interface RegisterEngineRpcDeps {
  /** The connecting session's subject: a client never names its own. */
  readonly subject: string;
  /**
   * `ws.ts`'s update admission: while a Mate update waits, a call that changes something is
   * refused (or, for a continuation, let through) so the update starts once work is done.
   */
  readonly admit: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    updateContinuation?: boolean,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly engine: Pick<MateEngineService, "wire">;
  /** The Mate's environment and this start's epoch: the revision every record carries. */
  readonly source: Effect.Effect<{ readonly environmentId: string; readonly epoch: number }>;
}

export const registerEngineRpc = ({ engine, source, subject, admit }: RegisterEngineRpcDeps) => {
  const wire = engine.wire;
  const caller: Effect.Effect<WireCaller> = Effect.map(source, (known) => ({
    subject,
    environmentId: known.environmentId,
    epoch: known.epoch,
  }));
  const asCaller = <A, E>(use: (who: WireCaller) => Effect.Effect<A, E>) =>
    Effect.flatMap(caller, use);
  return {
    [WS_METHODS.subscribeEngineConversation]: (input) =>
      Stream.unwrap(Effect.map(caller, (who) => wire.subscribe(input, who))),
    [WS_METHODS.subscribeEngineRows]: (input) =>
      Stream.unwrap(Effect.map(caller, (who) => wire.subscribeRows(input, who))),
    [WS_METHODS.engineReadEarlier]: (input) => wire.readEarlier(input),
    [WS_METHODS.engineReadRun]: (input) => wire.readRun(input),
    [WS_METHODS.engineReadDetail]: (input) => wire.readDetail(input),
    [WS_METHODS.engineReceipt]: (input) => wire.receipt(input),
    [WS_METHODS.engineSend]: (input) =>
      admit(
        WS_METHODS.engineSend,
        asCaller((who) => wire.send(input, who)),
      ),
    [WS_METHODS.engineStop]: (input) =>
      admit(
        WS_METHODS.engineStop,
        asCaller((who) => wire.stop(input, who)),
      ),
    [WS_METHODS.engineAnswer]: (input) =>
      admit(
        WS_METHODS.engineAnswer,
        asCaller((who) => wire.answer(input, who)),
      ),
    [WS_METHODS.engineDismiss]: (input) =>
      admit(
        WS_METHODS.engineDismiss,
        asCaller((who) => wire.dismiss(input, who)),
      ),
    [WS_METHODS.engineSteer]: (input) =>
      admit(
        WS_METHODS.engineSteer,
        asCaller((who) => wire.steer(input, who)),
      ),
    [WS_METHODS.engineSwitchModel]: (input) =>
      admit(
        WS_METHODS.engineSwitchModel,
        asCaller((who) => wire.switchModel(input, who)),
      ),
    [WS_METHODS.engineSetRuntimeMode]: (input) =>
      admit(
        WS_METHODS.engineSetRuntimeMode,
        asCaller((who) => wire.setRuntimeMode(input, who)),
      ),
    [WS_METHODS.engineAssignAgent]: (input) =>
      admit(
        WS_METHODS.engineAssignAgent,
        asCaller((who) => wire.assignAgent(input, who)),
      ),
  } satisfies EngineRpcHandlers;
};
