/**
 * `task.change` (replay-safe, lane `workspace`, run by the Mate-wide fibers): a change a taken
 * task's conversation opened, linked to that task in HQ by the Mate's own key (`TaskChangeLink`),
 * so HQ ends the task when the change merges. HQ takes a link it already holds as done, so a link
 * asked again after a restart changes nothing.
 *
 * It settles `ok` with HQ's answer, a refusal included (HQ said no: asking again says no again);
 * HQ not answering is tried again, as a replay-safe effect is.
 *
 * @module engine/effects/taskChange
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TaskChangePayload } from "../domain/decide.taskChange.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { TaskChangeLink } from "../ports.ts";
import { ok } from "./shared.ts";

export const makeTaskChange = Effect.gen(function* () {
  const port = yield* Effect.serviceOption(TaskChangeLink);
  return {
    kind: "task.change",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as TaskChangePayload;
        if (Option.isNone(port)) return ok({ ...payload, result: { outcome: "no-hq" } });
        const result = yield* Effect.interruptible(port.value.link(payload));
        if (result.outcome === "unreachable") {
          return { _tag: "Retry", reason: `HQ did not answer the link: ${result.why}` } as const;
        }
        if (result.outcome === "refused") {
          yield* Effect.logWarning("Mate engine: HQ refused a taken task's change link", {
            taskId: payload.taskId,
            change: `${payload.repo}#${String(payload.number)}`,
            status: result.status,
            code: result.code,
          });
        }
        return ok({ ...payload, result });
      }),
  } satisfies EffectHandler;
});
