/**
 * `run.prepare` (replay-safe, lane `side`): the run's one admission, then its workspace capture,
 * before the agent starts work (D7).
 *
 * Admission is asked here, for the run's principal and trigger, at the run's admitted
 * transition; a refusal ends the run with its words before anything of it ran. Every capture
 * outcome lets the message go: a service it cannot snapshot is logged and the run's changes show
 * it, a capture that broke is recorded as the run's gap, and a restart that cut it requeues it,
 * adopting its journal row.
 *
 * @module engine/effects/runPrepare
 */
import * as Effect from "effect/Effect";
import type { Principal, RunTrigger, ThreadId } from "@t3tools/contracts";

import { WorkspaceHistory } from "../../checkpointing/WorkspaceHistory.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { AgentWorkspace } from "../ports.ts";
import { makeAdmit } from "./admission.ts";
import { failed, ok, wordsOf } from "./shared.ts";

interface Payload {
  readonly runId: string;
  readonly instanceId: string | null;
  readonly principal: Principal;
  readonly trigger: RunTrigger;
  /** False for a maintenance command: admitted, nothing captured (absent: captured). */
  readonly capture?: boolean;
}

export const makeRunPrepare = Effect.gen(function* () {
  const admit = yield* makeAdmit;
  const history = yield* WorkspaceHistory;
  const workspace = yield* AgentWorkspace;
  return {
    kind: "run.prepare",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as Payload;
        const refused = yield* admit(payload);
        if (refused !== null) return failed(refused, { refused: true });
        if (payload.capture === false) return ok();
        const setup = yield* workspace.of(row.conversationId);
        // Best effort: a capture that broke never holds the message back or tries again.
        const broke = yield* history
          .prepare({
            threadId: row.conversationId as string as ThreadId,
            runId: payload.runId,
            cwd: setup.cwd,
          })
          .pipe(
            Effect.as(null),
            Effect.catchCause((cause) => Effect.succeed(wordsOf(cause))),
          );
        // Each service the capture could not snapshot is the run's to record, with its reason.
        const gaps = [
          ...(yield* history.gapsOf(row.conversationId as string as ThreadId, payload.runId)),
          ...(broke === null ? [] : [{ service: "workspace", reason: broke }]),
        ];
        return gaps.length === 0 ? ok() : ok({ gaps });
      }),
  } satisfies EffectHandler;
});
