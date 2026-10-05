/**
 * A Mate's container restart, at Zerops: restarted, or — failed — stopped and, once the store's
 * facts say its stop's process has ended, started. Answers with the last verb's process as the
 * operation's handle.
 *
 * @module data/operations/executors/mateRestart
 */
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";

import { ZeropsApiError } from "../../../zerops/api.ts";
import { zeropsFault } from "../../../zerops/data/zeropsWire.ts";
import type { OperationReceipt } from "../../model.ts";
import type { StreamFault } from "../../streamMachine.ts";
import type { OwnerUnobservable, UncertainAcceptance } from "../coordinator.ts";
import type { IntentOf } from "../kind.ts";
import { untilStopSettles } from "../mateRestart.ts";
import type { AccountStore } from "../../store.ts";

/** The platform's three service verbs, each answering with the process it started. */
export interface MateRestartPlatform {
  readonly restartService: (
    serviceId: string,
  ) => Promise<{ readonly processId?: string | undefined }>;
  readonly stopService: (serviceId: string) => Promise<{ readonly processId?: string | undefined }>;
  readonly startService: (
    serviceId: string,
  ) => Promise<{ readonly processId?: string | undefined }>;
}

/**
 * A failed write whose answer may have been lost — no answer, a dropped socket, a server error —
 * may have applied: uncertain, never sent again blindly. A refusal keeps what Zerops said.
 */
function faultOf(cause: unknown): StreamFault | UncertainAcceptance {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!(cause instanceof ZeropsApiError)) return { outcome: "uncertain-acceptance", message };
  if (
    cause.kind === "network" ||
    cause.kind === "uncertain" ||
    (cause.status !== null && cause.status >= 500)
  )
    return { outcome: "uncertain-acceptance", message };
  return { ...zeropsFault(cause), message };
}

const verb = (call: () => Promise<{ readonly processId?: string | undefined }>) =>
  Effect.tryPromise({ try: call, catch: faultOf });

/**
 * Zerops as the owner of a Mate's restart. A failed container's stop holds its project's process
 * history from the moment it is sent, so a reconnect's baseline shows a stop that ended meanwhile;
 * the start follows the stop's end. A stop whose end can no longer be observed — its organization
 * or account left, its link refused — is never started blindly: Zerops answers it as unobservable,
 * with the stop's process kept and starting the Mate as the person's next action.
 */
export function mateRestartOwner(ports: {
  readonly platform: MateRestartPlatform;
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  /** Holds a project's process history as a demanded detail; answers its release. */
  readonly holdHistory: (projectId: string) => () => void;
}) {
  const { platform } = ports;
  const stopSettles = untilStopSettles(ports.store, ports.registry);

  const stopThenStart = (intent: IntentOf<"mate-restart">) =>
    Effect.acquireUseRelease(
      Effect.sync(() => ports.holdHistory(intent.projectId)),
      () =>
        Effect.gen(function* () {
          const stopped = yield* verb(() => platform.stopService(intent.serviceId));
          if (stopped.processId !== undefined) {
            const stop = stopped.processId;
            const watch = yield* stopSettles(intent.orgId, intent.projectId, stop);
            if (watch === "unobservable")
              return {
                unobservable: {
                  nextActor: "person",
                  nextAction: "Start the Mate",
                  handles: [stop],
                },
              } satisfies OwnerUnobservable;
          }
          return yield* verb(() => platform.startService(intent.serviceId));
        }),
      (release) => Effect.sync(release),
    );

  return {
    submit: (
      requestId: string,
      intent: IntentOf<"mate-restart">,
    ): Effect.Effect<OperationReceipt | OwnerUnobservable, StreamFault | UncertainAcceptance> =>
      Effect.gen(function* () {
        const started =
          intent.way === "restart"
            ? yield* verb(() => platform.restartService(intent.serviceId))
            : yield* stopThenStart(intent);
        if ("unobservable" in started) return started;
        const processId = started.processId;
        return {
          requestId,
          operationId: processId ?? requestId,
          executor: "zerops",
          affected: processId === undefined ? [] : [{ family: "process", id: processId }],
          handles: processId === undefined ? [] : [processId],
          acceptance: { kind: "accepted" },
          outcome: { kind: "pending" },
        } satisfies OperationReceipt;
      }),
  };
}
