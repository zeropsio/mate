/**
 * `workspace.finish` (replay-safe, lane `side`): every run that asked for a capture releases it,
 * whatever ended it — finished against the turn its message went into, or released when it never
 * started. Without it the next run's capture waits for this one.
 *
 * @module engine/effects/workspaceFinish
 */
import * as Effect from "effect/Effect";
import type { ThreadId, TurnId } from "@t3tools/contracts";

import { WorkspaceHistory } from "../../checkpointing/WorkspaceHistory.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { AgentWorkspace } from "../ports.ts";
import { ok } from "./shared.ts";

interface Payload {
  readonly runId: string;
  readonly started: boolean;
  readonly providerTurnId?: string | null;
}

export const makeWorkspaceFinish = Effect.gen(function* () {
  const history = yield* WorkspaceHistory;
  const workspace = yield* AgentWorkspace;
  return {
    kind: "workspace.finish",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as Payload;
        const thread = row.conversationId as string as ThreadId;
        const turn = payload.providerTurnId ?? null;
        if (payload.started && turn !== null) {
          const setup = yield* workspace.of(row.conversationId).pipe(
            Effect.catchTags({
              WorkspaceUnavailable: (unavailable) => Effect.succeed(unavailable),
            }),
          );
          // A workspace that cannot be told now is read again: the turn's capture waits for it.
          if ("_tag" in setup)
            return { _tag: "Retry", reason: setup.message, patient: true } as const;
          yield* history.finish({ threadId: thread, turnId: turn as TurnId, cwd: setup.cwd });
        } else {
          yield* history.release(thread, undefined, payload.runId);
        }
        return ok();
      }),
  } satisfies EffectHandler;
});
