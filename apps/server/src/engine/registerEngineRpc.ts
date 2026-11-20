/**
 * Registers the Mate engine's conversation wire (`subscribeEngineConversation`,
 * `subscribeEngineRows`, `engine.*`), spread by `ws.ts` beside `registerZeropsRpc`. Scopes stay in
 * `auth/RpcAuthorization.ts`: reading the conversation is the same read as a thread's
 * (`orchestration:read`); a send, stop, answer, dismissal or steer needs `orchestration:operate`.
 *
 * Every handler answers from the `MateEngine` the server was built with. The caller is the connecting session
 * (its subject from the authenticated session, never from RPC input); the revision its records
 * carry is the Mate's environment and start epoch, as its attention counts them.
 *
 * @module engine/registerEngineRpc
 */
import {
  ENGINE_WIRE_BUDGETS,
  WS_METHODS,
  type EnvironmentAuthorizationError,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { StreamWindows } from "../RpcStreamWindow.ts";
import type { MateEngineService } from "./MateEngine.ts";
import type { WireCaller } from "./wire/EngineWire.ts";

type EngineRpcTag =
  | typeof WS_METHODS.subscribeEngineConversation
  | typeof WS_METHODS.subscribeEngineRows
  | typeof WS_METHODS.engineReadEarlier
  | typeof WS_METHODS.engineReadRun
  | typeof WS_METHODS.engineReadDetail
  | typeof WS_METHODS.engineReceipt
  | typeof WS_METHODS.engineRecordPageHeight
  | typeof WS_METHODS.engineSend
  | typeof WS_METHODS.engineStop
  | typeof WS_METHODS.engineContinue
  | typeof WS_METHODS.engineAnswer
  | typeof WS_METHODS.engineDismiss
  | typeof WS_METHODS.engineSteer
  | typeof WS_METHODS.engineSwitchModel
  | typeof WS_METHODS.engineSetArchived
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
   * The update admission, whose rule is `rpcAdmitOf` in `apps/server/src/RpcUpdateAdmission.ts`:
   * while a Mate update waits, a call that changes something is refused (or, for a continuation,
   * let through) so the update starts once work is done. Typed by shape: the engine may not import it.
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

/**
 * A conversation's opening (the reset, each run's `outcome` frames, the window and `synchronized`)
 * leaves without waiting for the client to acknowledge each message, so it costs the round trips
 * the link needs for its bytes, never one a message. The messages stay apart: each is a frame the
 * client decodes on its own, and its arrival is the socket's sign of life.
 *
 * The window is as much as a run's page, the largest answer this socket already sends as one
 * message: a typical opening leaves whole, the largest the budgets allow in three steps, and no
 * other frame on the socket, a pong among them, waits behind more than it did. A web build older
 * than 2026-11-11 drops a socket after three unanswered pings, and an opening sent whole (1.25 MB)
 * would hold its pongs back that long on a slow link. A client that reads nothing is owed at most
 * this and one message more, of an opening the server holds whole either way. The count is a
 * second fence, for small messages. The window ends with the message carrying `synchronized`: what is live goes on
 * as it did, a message once the client has acknowledged every one before it, so a client that
 * falls behind gets what happened meanwhile joined, never a queue of small messages.
 */
export const engineStreamWindows: StreamWindows = {
  [WS_METHODS.subscribeEngineConversation]: {
    chunks: 64,
    bytes: ENGINE_WIRE_BUDGETS.runPageBytes,
    endsWith: (values) =>
      values.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          "type" in frame &&
          frame.type === "synchronized",
      ),
  },
};

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
    [WS_METHODS.engineRecordPageHeight]: (input) => wire.recordPageHeight(input),
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
    [WS_METHODS.engineContinue]: (input) =>
      admit(
        WS_METHODS.engineContinue,
        asCaller((who) => wire.continue(input, who)),
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
    [WS_METHODS.engineSetArchived]: (input) =>
      admit(
        WS_METHODS.engineSetArchived,
        asCaller((who) => wire.setArchived(input, who)),
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
