import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { backfillThreadMedia } from "../assets/ConversationMedia.ts";
import { projectThreadDetailSnapshot } from "./ActivityPayloadProjection.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentNotFound,
  failEnvironmentOperationForbidden,
  requireEnvironmentScope,
  EnvironmentHttpRequestStartedAt,
} from "../auth/http.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.orchestration.snapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          // Serve the lightweight command read model (thread bodies empty)
          // instead of the fully hydrated snapshot. Hydrating every message
          // and activity payload in the database has OOM-killed servers, and
          // the route's only consumer (the project CLI) reads projects alone —
          // UI clients load the shell and per-thread snapshots instead.
          return yield* projectionSnapshotQuery
            .getCommandReadModel()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* projectionSnapshotQuery
            .getShellSnapshot()
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_snapshot_failed", cause),
              ),
            );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          const started = (yield* EnvironmentHttpRequestStartedAt) ?? performance.now();
          const stages: Array<{ name: string; duration: number }> = [];
          let stageStarted = started;
          const endStage = (name: string) => {
            const now = performance.now();
            stages.push({ name, duration: now - stageStarted });
            stageStarted = now;
          };
          yield* HttpEffect.appendPreResponseHandler((_request, response) => {
            // Runs after the typed response has been encoded. Compression may stream after
            // headers: its remaining work and transferred bytes belong to transport timing.
            endStage("encode");
            return Effect.succeed(
              HttpServerResponse.setHeader(
                response,
                "server-timing",
                [...stages, { name: "snapshot", duration: performance.now() - started }]
                  .map(({ name, duration }) => `${name};dur=${duration.toFixed(2)}`)
                  .join(", "),
              ),
            );
          });
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          endStage("authorize");
          const snapshot = yield* projectionSnapshotQuery
            .getThreadDetailSnapshot(
              args.params.threadId,
              args.payload.turnLimit === undefined
                ? undefined
                : {
                    turnLimit: args.payload.turnLimit,
                    ...(args.payload.beforeCursor !== undefined
                      ? { beforeCursor: args.payload.beforeCursor }
                      : {}),
                  },
            )
            .pipe(
              Effect.catch((cause) =>
                failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
              ),
            );
          endStage("read");
          if (Option.isNone(snapshot)) {
            return yield* failEnvironmentNotFound("thread_not_found");
          }
          const workspaceRoot =
            snapshot.value.thread.worktreePath !== null
              ? Option.some(snapshot.value.thread.worktreePath)
              : yield* projectionSnapshotQuery
                  .getProjectWorkspaceRootById(snapshot.value.thread.projectId)
                  .pipe(
                    Effect.catch((cause) =>
                      failEnvironmentInternal("orchestration_thread_snapshot_failed", cause),
                    ),
                  );
          endStage("project");
          const root = Option.getOrUndefined(workspaceRoot);
          const compact = root ? yield* backfillThreadMedia(snapshot.value, root) : snapshot.value;
          endStage("media");
          const projected = projectThreadDetailSnapshot(
            compact,
            args.payload.reasoningMessages === "true",
          );
          endStage("projection");
          return projected;
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          // The Mate engine owns every conversation: only an app older than it dispatches here.
          return yield* failEnvironmentOperationForbidden("engine_moved");
        }),
      );
  }),
);
