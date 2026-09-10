/**
 * The update line plus the one verb (spec-mate.md §2.9, MU-2), for a
 * connected environment: self-contained, so it can sit inside a list row
 * (the Mate card) or the thread header without the caller managing a hook
 * per candidate. Reads the live descriptor off `useEnvironment` — the same
 * subscription `serverConfig` already rides — never a version comparison
 * of its own (MU-1).
 *
 * A hook cannot live inside a plain menu-building function, so the same
 * update state that draws the line also supplies the Mate card's "Update to
 * x.y.z" menu item: `children` is a render prop over both, kept in one
 * place so a click from either surface drives the identical confirm/update
 * flow (MU-2).
 */
import type { ReactNode } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { useEnvironment } from "../../state/environments";
import { mateUpdateLine } from "../../zerops/mateUpdate";
import { useZeropsMateUpdate } from "../../zerops/useZeropsMateUpdate";
import { MateUpdateLine } from "./MateUpdateLine";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import type { ZeropsMenuAction } from "./ZeropsProjectMenu";

export interface ZeropsMateUpdateView {
  readonly line: ReactNode;
  /** The menu's items for this control — "Check for updates" plus, when
      available, "Update to x.y.z" — in the order they should appear. */
  readonly menuActions: ReadonlyArray<ZeropsMenuAction>;
}

export function ZeropsMateUpdateControl({
  environmentId,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly children: (view: ZeropsMateUpdateView) => ReactNode;
}) {
  const environment = useEnvironment(environmentId)?.serverConfig?.environment;
  const mateUpdate = useZeropsMateUpdate(environmentId, environment?.serverVersion);

  if (environment === undefined) return children({ line: null, menuActions: [] });
  // The RPC's on-demand answer, once one has run this mount; otherwise the
  // descriptor's own field. Either way this is the server's answer, relayed
  // as-is — MU-1: nothing here compares versions.
  const effectiveUpdate = mateUpdate.checked ?? environment.update;
  const line = mateUpdateLine(effectiveUpdate, environment.serverVersion);
  const capable = environment.capabilities.mateUpdate === true;
  const checkingNow = mateUpdate.state.phase === "checking";

  // The check has its own capability: a server that offers `mateUpdate` but
  // predates `zerops.mate.checkUpdate` would answer the check with an
  // unknown-request defect — exactly the skew this control is here to name.
  const checkActions: ReadonlyArray<ZeropsMenuAction> =
    environment.capabilities.mateUpdateCheck === true
      ? [
          {
            id: "check-for-updates",
            label: checkingNow ? "Checking…" : "Check for updates",
            onSelect: mateUpdate.check,
            disabled: checkingNow,
          },
        ]
      : [];

  if (!capable) {
    return children({ line: <MateUpdateLine line={line} />, menuActions: [] });
  }

  const offerVerb = effectiveUpdate?.available === true;

  if (!offerVerb) {
    return children({
      line: <MateUpdateLine line={line} />,
      menuActions: checkActions,
    });
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
    ) : state.phase === "checking" ? (
      <ZeropsMateVerb label="Update" onClick={mateUpdate.request} />
    ) : state.phase === "already-current" ? (
      <span className="text-muted-foreground">Already up to date</span>
    ) : (
      <span className="text-muted-foreground">Updated to {state.to}</span>
    );

  const updateAction: ZeropsMenuAction | null =
    state.phase === "idle" || state.phase === "failed"
      ? {
          id: "update",
          label: `Update to ${effectiveUpdate?.latest ?? ""}`,
          onSelect: mateUpdate.request,
        }
      : null;

  return children({
    line: (
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
    ),
    menuActions: updateAction === null ? checkActions : [...checkActions, updateAction],
  });
}
