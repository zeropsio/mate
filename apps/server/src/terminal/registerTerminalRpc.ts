import {
  type AuthSessionId,
  type TerminalMetadataStreamEvent,
  WS_METHODS,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Stream from "effect/Stream";

import type { RpcAdmit } from "../RpcUpdateAdmission.ts";
import type * as TerminalManager from "./Manager.ts";
import { terminalOutputStream } from "./OutputProtocol.ts";

type TerminalRpcTag =
  | typeof WS_METHODS.terminalOpen
  | typeof WS_METHODS.terminalAttach
  | typeof WS_METHODS.terminalWrite
  | typeof WS_METHODS.terminalResize
  | typeof WS_METHODS.terminalClear
  | typeof WS_METHODS.terminalRestart
  | typeof WS_METHODS.terminalClose
  | typeof WS_METHODS.subscribeTerminalEvents
  | typeof WS_METHODS.subscribeTerminalMetadata;

type TerminalRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: TerminalRpcTag }>;

type TerminalRpcHandlers = {
  readonly [Current in TerminalRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<Current, never>;
};

interface RegisterTerminalRpcDeps {
  readonly terminalManager: TerminalManager.TerminalManager["Service"];
  readonly currentSessionId: AuthSessionId;
  readonly admit: RpcAdmit;
}

export const registerTerminalRpc = ({
  terminalManager,
  currentSessionId,
  admit,
}: RegisterTerminalRpcDeps) =>
  ({
    [WS_METHODS.terminalOpen]: (input) =>
      admit(
        WS_METHODS.terminalOpen,
        terminalManager.open({ ...input, openedBy: currentSessionId }),
      ),
    [WS_METHODS.terminalAttach]: (input) =>
      terminalOutputStream(
        (listener, registerCleanup) =>
          terminalManager.attachStream(
            { ...input, openedBy: currentSessionId },
            listener,
            registerCleanup,
          ),
        (listener, registerCleanup) =>
          terminalManager.resyncStream(input, listener, registerCleanup),
      ),
    [WS_METHODS.terminalWrite]: (input) =>
      admit(WS_METHODS.terminalWrite, terminalManager.write(input)),
    [WS_METHODS.terminalResize]: (input) =>
      admit(WS_METHODS.terminalResize, terminalManager.resize(input)),
    [WS_METHODS.terminalClear]: (input) =>
      admit(WS_METHODS.terminalClear, terminalManager.clear(input)),
    [WS_METHODS.terminalRestart]: (input) =>
      admit(
        WS_METHODS.terminalRestart,
        terminalManager.restart({ ...input, openedBy: currentSessionId }),
      ),
    [WS_METHODS.terminalClose]: (input) =>
      admit(WS_METHODS.terminalClose, terminalManager.close(input)),
    [WS_METHODS.subscribeTerminalEvents]: (_input) =>
      terminalOutputStream(terminalManager.subscribe),
    [WS_METHODS.subscribeTerminalMetadata]: (_input) =>
      Stream.callback<TerminalMetadataStreamEvent>((queue) =>
        Effect.acquireRelease(
          terminalManager.subscribeMetadata((event) => Queue.offer(queue, event)),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
  }) satisfies TerminalRpcHandlers;
