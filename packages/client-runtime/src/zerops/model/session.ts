/**
 * `composeSession` — the envelope composed with what this layer derives.
 * `envelope.bootstrap` is nil on the wire (compaction-safe position, never
 * populated today), so the bootstrap session's step comes from the model's
 * own decoded plan, not the envelope. See
 * `mate-session-model-2026-09-05-designs/C-client-domain.md` §1.6.
 */
import type { ZeropsAttemptInfo, ZeropsStateEnvelope } from "@t3tools/contracts";

import type { ZeropsOperation, ZeropsSessionView, ZeropsWorkAttempt } from "./types.ts";

function toWorkAttempts(
  attempts: Record<string, ReadonlyArray<ZeropsAttemptInfo>> | undefined,
): Record<string, ReadonlyArray<ZeropsWorkAttempt>> | undefined {
  if (attempts === undefined) {
    return undefined;
  }
  const out: Record<string, ReadonlyArray<ZeropsWorkAttempt>> = {};
  for (const [hostname, list] of Object.entries(attempts)) {
    out[hostname] = list.map((attempt) => ({ success: attempt.success }));
  }
  return out;
}

/** The running step's label, for the strip's "setting up infrastructure · <step>". */
function currentBootstrapStep(operation: ZeropsOperation): string | undefined {
  return operation.steps.find((step) => step.state === "running")?.label;
}

/** The most recently anchored bootstrap operation — open or already closed. */
function latestBootstrapOperation(
  operations: ReadonlyArray<ZeropsOperation>,
): ZeropsOperation | undefined {
  let latest: ZeropsOperation | undefined;
  for (const operation of operations) {
    if (operation.kind !== "bootstrap") {
      continue;
    }
    if (
      latest === undefined ||
      operation.anchorAt.localeCompare(latest.anchorAt) > 0 ||
      (operation.anchorAt === latest.anchorAt &&
        operation.anchorActivityId.localeCompare(latest.anchorActivityId) > 0)
    ) {
      latest = operation;
    }
  }
  return latest;
}

export function composeSession(
  envelope: ZeropsStateEnvelope | undefined,
  operations: ReadonlyArray<ZeropsOperation>,
): ZeropsSessionView {
  const bootstrapOperation = latestBootstrapOperation(operations);
  const bootstrap = (() => {
    if (bootstrapOperation === undefined) {
      return undefined;
    }
    const intent = bootstrapOperation.session?.intent;
    const step = currentBootstrapStep(bootstrapOperation);
    return {
      key: bootstrapOperation.key,
      sessionIds: bootstrapOperation.session?.sessionIds ?? [],
      ...(intent !== undefined ? { intent } : {}),
      ...(step !== undefined ? { step } : {}),
      completed: bootstrapOperation.session?.completed ?? 0,
      total: bootstrapOperation.session?.total ?? 0,
      phase: bootstrapOperation.phase,
    };
  })();

  if (envelope === undefined) {
    return bootstrap !== undefined ? { bootstrap } : {};
  }

  const workSession = envelope.workSession;
  const work = (() => {
    if (workSession === undefined) {
      return undefined;
    }
    const deploys = toWorkAttempts(workSession.deploys);
    const verifies = toWorkAttempts(workSession.verifies);
    return {
      key: `work:${workSession.createdAt}` as const,
      intent: workSession.intent,
      services: workSession.services,
      ...(deploys !== undefined ? { deploys } : {}),
      ...(verifies !== undefined ? { verifies } : {}),
    };
  })();

  return {
    phase: envelope.phase,
    ...(envelope.phase === "idle" ? { serviceCount: envelope.services.length } : {}),
    ...(envelope.phase === "idle" && envelope.idleScenario !== undefined
      ? { idleScenario: envelope.idleScenario }
      : {}),
    ...(bootstrap !== undefined ? { bootstrap } : {}),
    ...(work !== undefined ? { work } : {}),
  };
}
