/**
 * A wake on the crew owner fired: a question's or a task's wait, the run's time, a claim's request, a frozen host's offer.
 *
 * @module crew/engine/decide.wakes
 */
import { type WakeId } from "@t3tools/contracts";
import { type CrewState } from "./state.ts";
import { type Builder } from "./decide.step.ts";
import { checkLimits } from "./decide.run.ts";
import { moveClaim, releaseClaim } from "./decide.claims.ts";

const wakeKey = (state: CrewState, wakeId: string, kind: string): string =>
  wakeId.slice(`${state.ownerId}/w/${kind}/`.length);

export const wakeFired = (b: Builder, wakeId: WakeId): void => {
  const wake = b.state.wakes[wakeId];
  if (wake === undefined) return;
  const key = wakeKey(b.state, wakeId, wake.kind);
  b.emit({ _tag: "WakeFired", wakeId, dueAt: wake.dueAt });
  switch (wake.kind) {
    case "question":
    case "unattended":
      b.emit({ _tag: "Due", key: `${wake.kind}:${key}` });
      return;
    case "run-time":
      return checkLimits(b);
    case "claim-timeout": {
      const claim = b.state.claims[key];
      if (claim?.state === "requested") moveClaim(b, key, "timeout");
      else if (claim?.state === "held") releaseClaim(b, key, { kind: "engine" }, "timeout");
      return;
    }
    case "thaw-offer":
      if (b.state.hosts[key]?.frozenSince != null) {
        b.emit({
          _tag: "AttentionRaised",
          row: {
            id: `deploy-unreadable:${key}`,
            handle: null,
            taskId: null,
            text: `${key}'s redeploy could not be read`,
            at: b.now,
          },
        });
      }
      return;
    default:
      return;
  }
};
