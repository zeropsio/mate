/**
 * The lifecycle strip's wording, projected from the model.
 *
 * This is a projection, never a state machine: `session` and `running` ARE
 * the state (composed by `model/session.ts` and `model/deriveThreadModel.ts`
 * from the envelope and the call ledger), and every phrase here is a reading
 * of them plus the one thing neither can know — whether a question is
 * waiting for the user.
 *
 * The phrases are the ones in the brief's journey table (§7), so they are
 * asserted verbatim in `strip.test.ts` rather than approximated.
 */
import type { ZeropsOperation, ZeropsSessionView, ZeropsWorkAttempt } from "./model/types.ts";

export type ZeropsStripTone = "idle" | "active" | "waiting" | "done";

export interface ZeropsStripState {
  readonly tone: ZeropsStripTone;
  readonly label: string;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const lastAttemptSucceeded = (
  attempts: ReadonlyArray<ZeropsWorkAttempt> | undefined,
): boolean | undefined =>
  attempts === undefined || attempts.length === 0
    ? undefined
    : attempts[attempts.length - 1]?.success;

/**
 * `kanbandev deployed ✓ verified ✓ · kanbanstage pending`.
 *
 * Only the LAST attempt counts: a service that failed once and then deployed is
 * deployed, and one that deployed and then failed is broken. Reading the whole
 * history would let an early success hide a current failure.
 */
function workSessionLabel(work: NonNullable<ZeropsSessionView["work"]>): string {
  return work.services
    .map((hostname) => {
      const deployed = lastAttemptSucceeded(work.deploys?.[hostname]);
      const verified = lastAttemptSucceeded(work.verifies?.[hostname]);
      if (deployed === false) {
        return `${hostname} deploy failed`;
      }
      if (deployed === undefined) {
        return `${hostname} pending`;
      }
      if (verified === false) {
        return `${hostname} deployed ✓ verify failed`;
      }
      return verified === true ? `${hostname} deployed ✓ verified ✓` : `${hostname} deployed ✓`;
    })
    .join(" · ");
}

function phaseState(session: ZeropsSessionView): ZeropsStripState {
  switch (session.phase) {
    case "bootstrap-active": {
      const step = session.bootstrap?.step;
      return {
        tone: "active",
        label:
          step === undefined || step.length === 0
            ? "setting up infrastructure"
            : `setting up infrastructure · ${step}`,
      };
    }
    case "idle":
      return session.idleScenario === "empty"
        ? { tone: "idle", label: "no services yet" }
        : {
            tone: "idle",
            label: `infrastructure ready · ${plural(session.serviceCount ?? 0, "service")}`,
          };
    case "develop-active": {
      const work = session.work;
      if (work === undefined || work.services.length === 0) {
        return { tone: "active", label: "developing" };
      }
      const hasAttempts =
        Object.keys(work.deploys ?? {}).length > 0 || Object.keys(work.verifies ?? {}).length > 0;
      return {
        tone: "active",
        label: hasAttempts ? workSessionLabel(work) : `developing ${work.services.join(", ")}`,
      };
    }
    case "develop-closed-auto":
      return { tone: "done", label: "task complete" };
    case "strategy-setup":
      return { tone: "active", label: "choosing how to deploy" };
    case "export-active":
      return { tone: "active", label: "exporting the project" };
    case "launch-production-active":
      return { tone: "active", label: "launching production" };
    default:
      // zcp adds phases independently of this build — `launch-production-active`
      // arrived that way. Show it as itself rather than blanking the strip or
      // silently reading it as one of the phases above.
      return { tone: "idle", label: session.phase! };
  }
}

/**
 * What the strip should say, or undefined when there is nothing to say yet —
 * a thread whose agent has not run a workflow-aware Zerops tool.
 *
 * Precedence, highest first: a question waiting for the user blocks everything
 * else; a tool running now is more current than the phase it will land in; the
 * phase otherwise.
 */
export function zeropsStripState(
  session: ZeropsSessionView | undefined,
  running: ZeropsOperation | undefined,
  pendingQuestion: boolean,
): ZeropsStripState | undefined {
  if (session === undefined || session.phase === undefined) {
    return undefined;
  }
  if (pendingQuestion) {
    return { tone: "waiting", label: "waiting for you" };
  }
  if (running !== undefined) {
    return { tone: "active", label: `${running.kicker} running` };
  }
  return phaseState(session);
}
