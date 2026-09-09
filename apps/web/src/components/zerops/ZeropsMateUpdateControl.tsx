/**
 * The update line plus the one verb (spec-mate.md §2.9, MU-2), for a
 * connected environment: self-contained, so it can sit inside a list row
 * (the Mate card) or the thread header without the caller managing a hook
 * per candidate. Reads the live descriptor off `useEnvironment` — the same
 * subscription `serverConfig` already rides — never a version comparison
 * of its own (MU-1).
 */
import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironment } from "../../state/environments";
import { mateUpdateLine } from "../../zerops/mateUpdate";
import { useZeropsMateUpdate } from "../../zerops/useZeropsMateUpdate";
import { MateUpdateLine } from "./MateUpdateLine";
import { ZeropsMateVerb } from "./ZeropsMateCard";

export function ZeropsMateUpdateControl({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const environment = useEnvironment(environmentId)?.serverConfig?.environment;
  const mateUpdate = useZeropsMateUpdate(environmentId, environment?.serverVersion);

  if (environment === undefined) return null;
  const line = mateUpdateLine(environment.update, environment.serverVersion);
  const offerVerb =
    environment.capabilities.mateUpdate === true && environment.update?.available === true;

  if (!offerVerb) {
    return <MateUpdateLine line={line} />;
  }

  const state = mateUpdate.state;
  const verb =
    state.phase === "idle" || state.phase === "failed" ? (
      <ZeropsMateVerb label="Update" onClick={mateUpdate.request} />
    ) : state.phase === "confirm" ? (
      <span
        className="inline-flex shrink-0 items-center gap-1.5"
        data-zerops-surface="mate-update-confirm"
      >
        <span className="text-muted-foreground">Running threads stop. Update now?</span>
        <ZeropsMateVerb label="Update" onClick={mateUpdate.confirm} />
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={mateUpdate.cancel}
        >
          Keep running
        </button>
      </span>
    ) : state.phase === "updating" ? (
      <span className="text-muted-foreground">Updating…</span>
    ) : state.phase === "already-current" ? (
      <span className="text-muted-foreground">Already up to date</span>
    ) : (
      <span className="text-muted-foreground">Updated to {state.to}</span>
    );

  return (
    <>
      <MateUpdateLine line={line} verb={verb} />
      {state.phase === "failed" ? (
        <span
          className="text-[var(--zerops-status-failed-text,var(--foreground))]"
          data-zerops-surface="mate-update-error"
        >
          {state.message}
        </span>
      ) : null}
    </>
  );
}
