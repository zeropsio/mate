/**
 * `run.prepare` (replay-safe, lane `side`): the run's one admission, then its workspace capture,
 * before the agent starts work (D7).
 *
 * Admission is asked here, for the run's principal and trigger, at the run's admitted
 * transition; a refusal, or an admission that broke, ends the run with its words before anything
 * of it ran — its outcome is never read as the capture's. Every capture
 * outcome lets the message go: a service it cannot snapshot is logged and the run's changes show
 * it, a capture that broke is recorded as the run's gap, and a restart that cut it requeues it,
 * adopting its journal row.
 *
 * @module engine/effects/runPrepare
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { Principal, RunTrigger, ThreadId } from "@t3tools/contracts";

import { WorkspaceHistory } from "../../checkpointing/WorkspaceHistory.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { AgentWorkspace, RunAdmission } from "../ports.ts";
import { failed, ok, wordsOf } from "./shared.ts";

interface Payload {
  readonly runId: string;
  readonly instanceId: string | null;
  readonly principal: Principal;
  readonly trigger: RunTrigger;
}

export const makeRunPrepare = Effect.gen(function* () {
  const admission = yield* RunAdmission;
  const history = yield* WorkspaceHistory;
  const workspace = yield* AgentWorkspace;
  return {
    kind: "run.prepare",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as Payload;
        // Admission's outcome is its own: refused or broken, the run never goes without it.
        const refused = yield* admission
          .admit({
            instanceId: payload.instanceId ?? "",
            principal: payload.principal,
            trigger: payload.trigger,
          })
          .pipe(
            Effect.as(null),
            Effect.catchTag("RunRefused", (refusal) => Effect.succeed(refusal.message)),
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.failCause(cause)
                : Effect.succeed(`The run could not be admitted: ${wordsOf(cause)}`),
            ),
          );
        if (refused !== null) return failed(refused, { refused: true });
        // Best effort: a capture that broke never holds the message back or tries again.
        const broke = yield* Effect.flatMap(workspace.of(row.conversationId), (setup) =>
          history.prepare({
            threadId: row.conversationId as string as ThreadId,
            runId: payload.runId,
            cwd: setup.cwd,
          }),
        ).pipe(
          Effect.as(null),
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed(wordsOf(cause)),
          ),
        );
        return broke === null ? ok() : ok({ gaps: [{ service: "workspace", reason: broke }] });
      }),
  } satisfies EffectHandler;
});
