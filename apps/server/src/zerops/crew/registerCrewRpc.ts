/**
 * Registers the crew RPCs (`subscribeZeropsCrew`, `zerops.crew.files.get`,
 * `zerops.crew.files.put`, `zerops.crew.command`, `zerops.crew.taskPage`), spread by `ws.ts` beside
 * `registerZeropsRpc`. Scopes stay in `auth/RpcAuthorization.ts`.
 *
 * Every handler answers from the `CrewEngine` the server was built with —
 * its inert form where crew mode is off (the feed says `off` once, every
 * request is `unavailable`), the live engine otherwise. A command and a write
 * to the crew home run as the connecting session: its subject comes from the
 * authenticated session in `ws.ts`, never from RPC input; a press that runs or
 * changes the crew is judged as that person on the logins it reaches, and any
 * turn the command starts is admitted as them.
 */
import { WS_METHODS, type WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { RegisterZeropsRpcDeps } from "../registerZeropsRpc.ts";
import type { CrewEngineService } from "./CrewEngine.ts";

type CrewRpcTag =
  | typeof WS_METHODS.subscribeZeropsCrew
  | typeof WS_METHODS.zeropsCrewFilesGet
  | typeof WS_METHODS.zeropsCrewFilesPut
  | typeof WS_METHODS.zeropsCrewCommand
  | typeof WS_METHODS.zeropsCrewTaskPage;

type CrewRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: CrewRpcTag }>;

/** The handler function types `WsRpcGroup.of({...})` expects for exactly these tags. */
type CrewRpcHandlers = {
  readonly [Current in CrewRpc as Current["_tag"]]: Rpc.ToHandlerFn<Current, never>;
};

type RegisterCrewRpcDeps = Pick<
  RegisterZeropsRpcDeps,
  "observeRpcEffect" | "observeRpcStream" | "subject"
> & {
  readonly crew: CrewEngineService;
};

const traceAttributes = { "rpc.aggregate": "zerops" } as const;

export const registerCrewRpc = ({
  crew,
  subject,
  observeRpcEffect,
  observeRpcStream,
}: RegisterCrewRpcDeps) =>
  ({
    [WS_METHODS.subscribeZeropsCrew]: (_input) =>
      observeRpcStream(WS_METHODS.subscribeZeropsCrew, crew.snapshot, traceAttributes),
    [WS_METHODS.zeropsCrewFilesGet]: (_input) =>
      observeRpcEffect(WS_METHODS.zeropsCrewFilesGet, crew.readFiles, traceAttributes),
    [WS_METHODS.zeropsCrewFilesPut]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsCrewFilesPut,
        crew.writeFiles(input, { kind: "session", subject }),
        traceAttributes,
      ),
    [WS_METHODS.zeropsCrewCommand]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsCrewCommand,
        crew.command(input, { kind: "session", subject }),
        traceAttributes,
        input._tag === "pause" || input._tag === "stop",
      ),
    [WS_METHODS.zeropsCrewTaskPage]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsCrewTaskPage,
        // A board that holds every task (V1's) has nothing past it.
        crew.taskPage?.(input) ?? Effect.succeed({ tasks: [], next: null }),
        traceAttributes,
      ),
  }) satisfies CrewRpcHandlers;
