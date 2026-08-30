/**
 * The lifecycle strip's wording, projected from the envelope.
 *
 * This is a projection, never a state machine: the envelope IS the state, and
 * every phrase here is a reading of it plus two things the envelope cannot
 * know — whether a question is waiting for the user, and whether a tool is
 * running right now.
 *
 * The phrases are the ones in the brief's journey table (§7), so they are
 * asserted verbatim in `strip.test.ts` rather than approximated.
 */
import type { ZeropsLifecycle, ZeropsStateEnvelope, ZeropsWorkSession } from "@t3tools/contracts";

export type ZeropsStripTone = "idle" | "active" | "waiting" | "done";

export interface ZeropsStripState {
  readonly tone: ZeropsStripTone;
  readonly label: string;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

const lastAttemptSucceeded = (
  attempts: ReadonlyArray<{ readonly success: boolean }> | undefined,
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
function workSessionLabel(session: ZeropsWorkSession): string {
  return session.services
    .map((hostname) => {
      const deployed = lastAttemptSucceeded(session.deploys?.[hostname]);
      const verified = lastAttemptSucceeded(session.verifies?.[hostname]);
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

function phaseState(envelope: ZeropsStateEnvelope): ZeropsStripState {
  switch (envelope.phase) {
    case "bootstrap-active": {
      const step = envelope.bootstrap?.step;
      return {
        tone: "active",
        label:
          step === undefined || step.length === 0
            ? "setting up infrastructure"
            : `setting up infrastructure · ${step}`,
      };
    }
    case "idle":
      return envelope.idleScenario === "empty"
        ? { tone: "idle", label: "no services yet" }
        : {
            tone: "idle",
            label: `infrastructure ready · ${plural(envelope.services.length, "service")}`,
          };
    case "develop-active": {
      const session = envelope.workSession;
      if (session === undefined || session.services.length === 0) {
        return { tone: "active", label: "developing" };
      }
      const hasAttempts =
        Object.keys(session.deploys ?? {}).length > 0 ||
        Object.keys(session.verifies ?? {}).length > 0;
      return {
        tone: "active",
        label: hasAttempts
          ? workSessionLabel(session)
          : `developing ${session.services.join(", ")}`,
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
      return { tone: "idle", label: envelope.phase };
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
  lifecycle: ZeropsLifecycle | undefined,
  options: { readonly pendingUserInput: boolean },
): ZeropsStripState | undefined {
  const envelope = lifecycle?.envelope;
  if (lifecycle === undefined || envelope === undefined) {
    return undefined;
  }
  if (options.pendingUserInput) {
    return { tone: "waiting", label: "waiting for you" };
  }
  const running = lifecycle.recentTools.find((tool) => tool.status === "inProgress");
  if (running !== undefined) {
    return { tone: "active", label: `${running.toolName} running` };
  }
  return phaseState(envelope);
}
