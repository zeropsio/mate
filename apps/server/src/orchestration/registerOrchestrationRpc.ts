import {
  ORCHESTRATION_WS_METHODS,
  type OrchestrationDispatchCommandError,
  OrchestrationGetSnapshotError,
  OrchestrationSearchThreadsError,
  type WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type * as Scope from "effect/Scope";

import type { ServerConfig } from "../config.ts";
import type { RpcAdmit } from "../RpcUpdateAdmission.ts";
import type { OrchestrationEngineShape } from "./Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { makeShellStream } from "./shellStream.ts";
import { readWorkflowScript } from "./workflowScriptQuery.ts";

type OrchestrationRpcTag =
  | typeof ORCHESTRATION_WS_METHODS.dispatchCommand
  | typeof ORCHESTRATION_WS_METHODS.getWorkflowScript
  | typeof ORCHESTRATION_WS_METHODS.searchThreads
  | typeof ORCHESTRATION_WS_METHODS.subscribeShell
  | typeof ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot;

type OrchestrationRpc = Extract<
  RpcGroup.Rpcs<typeof WsRpcGroup>,
  { readonly _tag: OrchestrationRpcTag }
>;

type OrchestrationRpcHandlers = {
  readonly [Current in OrchestrationRpc as Rpc.Tag<Current>]: Rpc.ToHandlerFn<
    Current,
    Rpc.Tag<Current> extends typeof ORCHESTRATION_WS_METHODS.getWorkflowScript
      ? ServerConfig
      : Rpc.Tag<Current> extends typeof ORCHESTRATION_WS_METHODS.subscribeShell
        ? Scope.Scope
        : never
  >;
};

interface RegisterOrchestrationRpcDeps {
  readonly projectionSnapshotQuery: ProjectionSnapshotQueryShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly admit: RpcAdmit;
  readonly engineMoved: () => OrchestrationDispatchCommandError;
}

export const registerOrchestrationRpc = ({
  projectionSnapshotQuery,
  orchestrationEngine,
  admit,
  engineMoved,
}: RegisterOrchestrationRpcDeps) => {
  const shellStream = makeShellStream({ projectionSnapshotQuery, orchestrationEngine });
  return {
    // The Mate engine owns every conversation: only an app older than it dispatches here.
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: () =>
      admit(ORCHESTRATION_WS_METHODS.dispatchCommand, Effect.fail(engineMoved())),
    [ORCHESTRATION_WS_METHODS.getWorkflowScript]: (input) =>
      readWorkflowScript({ scriptPath: input.scriptPath }),
    [ORCHESTRATION_WS_METHODS.searchThreads]: (input) =>
      projectionSnapshotQuery.searchThreads(input).pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationSearchThreadsError({
              message: "Failed to search threads",
              cause,
            }),
        ),
      ),
    [ORCHESTRATION_WS_METHODS.subscribeShell]: (input) => shellStream(input),
    [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: (_input) =>
      projectionSnapshotQuery.getArchivedShellSnapshot().pipe(
        Effect.tapError((cause) =>
          Effect.logError("orchestration archived shell snapshot load failed", { cause }),
        ),
        Effect.mapError(
          (cause) =>
            new OrchestrationGetSnapshotError({
              message: "Failed to load archived orchestration shell snapshot",
              cause,
            }),
        ),
      ),
  } satisfies OrchestrationRpcHandlers;
};
