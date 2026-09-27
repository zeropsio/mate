/**
 * Registers the crew RPCs (`subscribeZeropsCrew`, `zerops.crew.files.get`,
 * `zerops.crew.files.put`, `zerops.crew.command`), spread by `ws.ts` beside
 * `registerZeropsRpc`. Scopes stay in `auth/RpcAuthorization.ts`.
 *
 * This is the crew layer's inert form (ARCHITECTURE §2 *Activation*): the feed
 * sends one snapshot saying crew mode is off, and every request is refused as
 * `unavailable`. The live form arrives behind this same function with the
 * crew engine.
 */
import {
  CrewCommandError,
  WS_METHODS,
  type CrewSnapshot,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type { RegisterZeropsRpcDeps } from "../registerZeropsRpc.ts";

type CrewRpcTag =
  | typeof WS_METHODS.subscribeZeropsCrew
  | typeof WS_METHODS.zeropsCrewFilesGet
  | typeof WS_METHODS.zeropsCrewFilesPut
  | typeof WS_METHODS.zeropsCrewCommand;

type CrewRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: CrewRpcTag }>;

/** The handler function types `WsRpcGroup.of({...})` expects for exactly these four tags. */
type CrewRpcHandlers = {
  readonly [Current in CrewRpc as Current["_tag"]]: Rpc.ToHandlerFn<Current, never>;
};

type RegisterCrewRpcDeps = Pick<RegisterZeropsRpcDeps, "observeRpcEffect" | "observeRpcStream">;

/** What the feed sends where crew mode is not on. */
export const CREW_OFF_SNAPSHOT: CrewSnapshot = {
  status: "off",
  seq: 0,
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  landedNotDelivered: 0,
  lastError: null,
};

const unavailable = Effect.fail(new CrewCommandError({ reason: "unavailable", detail: null }));

const traceAttributes = { "rpc.aggregate": "zerops" } as const;

export const registerCrewRpc = ({ observeRpcEffect, observeRpcStream }: RegisterCrewRpcDeps) =>
  ({
    [WS_METHODS.subscribeZeropsCrew]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsCrew,
        Stream.make(CREW_OFF_SNAPSHOT),
        traceAttributes,
      ),
    [WS_METHODS.zeropsCrewFilesGet]: (_input) =>
      observeRpcEffect(WS_METHODS.zeropsCrewFilesGet, unavailable, traceAttributes),
    [WS_METHODS.zeropsCrewFilesPut]: (_input) =>
      observeRpcEffect(WS_METHODS.zeropsCrewFilesPut, unavailable, traceAttributes),
    [WS_METHODS.zeropsCrewCommand]: (_input) =>
      observeRpcEffect(WS_METHODS.zeropsCrewCommand, unavailable, traceAttributes),
  }) satisfies CrewRpcHandlers;
