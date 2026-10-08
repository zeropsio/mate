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
import { cleanupFailedUploadedAttachments, normalizeDispatchCommand } from "./Normalizer.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  failEnvironmentOperationForbidden,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ServerConfig } from "../config.ts";
import { ZeropsTurnAdmission } from "../zerops/ZeropsTurnAdmission.ts";
import { makeFirstTurnEffort } from "../zerops/firstTurnEffort.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

export const orchestrationHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectCloneTracker = yield* ProjectCloneTracker.ProjectCloneTracker;
    const turnAdmission = yield* ZeropsTurnAdmission;
    const serverConfig = yield* ServerConfig;
    // D10: a new conversation's first turn runs on Extra High when it names no effort, and the
    // thread stores what it runs on — over HTTP as over the socket.
    const firstTurnEffort = makeFirstTurnEffort({
      providers: (yield* ProviderRegistry).getProviders,
      threadShell: projectionSnapshotQuery.getThreadShellById,
    });

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
          const started = performance.now();
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
          const session = yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          // The Mate engine owns the conversation: V1's door is closed, before admission.
          if (serverConfig.mateEngine === "mate") {
            return yield* failEnvironmentOperationForbidden("engine_moved");
          }
          yield* ProjectCloneTracker.rejectCommandsDuringClone(
            projectCloneTracker,
            args.payload,
          ).pipe(
            Effect.catch((cause) =>
              failEnvironmentInternal("orchestration_dispatch_failed", cause),
            ),
          );
          const { command: normalizedCommand, store } = yield* normalizeDispatchCommand(
            args.payload,
          ).pipe(
            Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")),
            Effect.flatMap(firstTurnEffort),
          );
          // A turn over HTTP spends the same login a turn over the socket
          // does, so it passes the same gate (D6) as the same person. A
          // refusal is the caller's to hear, not a server failure.
          const result = yield* turnAdmission
            .admit({
              command: normalizedCommand,
              principal: { kind: "session", subject: session.subject },
            })
            .pipe(
              Effect.matchEffect({
                onFailure: (refusal) =>
                  Effect.logInfo("orchestration dispatch refused a turn (D6)", {
                    reason: refusal.message,
                  }).pipe(Effect.andThen(failEnvironmentOperationForbidden("zerops_turn_refused"))),
                onSuccess: () =>
                  (store === undefined ? Effect.void : orchestrationEngine.dispatch(store))
                    .pipe(Effect.andThen(orchestrationEngine.dispatch(normalizedCommand)))
                    .pipe(
                      Effect.catch((cause) =>
                        failEnvironmentInternal("orchestration_dispatch_failed", cause),
                      ),
                    ),
              }),
              Effect.tapError(() =>
                cleanupFailedUploadedAttachments(args.payload, normalizedCommand),
              ),
            );
          yield* ProjectCloneTracker.discardCloneForDeletedProject(
            projectCloneTracker,
            normalizedCommand,
          );
          return result;
        }),
      );
  }),
);
