/**
 * The update line plus the one verb (spec-mate.md §2.9, MU-2), for a
 * connected environment: self-contained, so it can sit inside a list row
 * (the Mate card) or the Mate's home card without the caller managing a hook
 * per candidate. Reads the live descriptor off `useEnvironment` — the same
 * subscription `serverConfig` already rides — never a version comparison
 * of its own (MU-1).
 *
 * A hook cannot live inside a plain menu-building function, so the same
 * update state that draws the line also supplies the Mate menus' *Check for
 * updates* and *Update to x.y.z*: `children` is a render prop over both, kept
 * in one place so a click from any surface is the same update (MU-2).
 *
 * Wherever the verb is pressed, the person is asked in the app's confirm
 * dialog, which every route mounts. A question drawn on the line was seen
 * only where the line was, and the Mate menus draw none: their *Update to
 * x.y.z* armed a question nobody could see (the owner, 2026-09-26). A check
 * that finds a newer version asks the same question at once — whoever asked
 * "is there an update?" is one answer away from it.
 */
import { useCallback, type ReactNode } from "react";

import type { EnvironmentId } from "@t3tools/contracts";

import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironment } from "../../state/environments";
import { mateUpdateLine, mateUpdateQuestion, mateUpdateStatus } from "../../zerops/mateUpdate";
import { useZeropsMateUpdate } from "../../zerops/useZeropsMateUpdate";
import { MateUpdateLine, MateUpdateStatusText } from "./MateUpdateLine";
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
  mateName,
  children,
}: {
  readonly environmentId: EnvironmentId;
  /** Who the confirm dialog asks about; "this Mate" where the surface does not know. */
  readonly mateName?: string | undefined;
  readonly children: (view: ZeropsMateUpdateView) => ReactNode;
}) {
  const environment = useEnvironment(environmentId)?.serverConfig?.environment;
  const mateUpdate = useZeropsMateUpdate(environmentId, environment?.serverVersion);
  const { check, update } = mateUpdate;
  const capable = environment?.capabilities.mateUpdate === true;

  const ask = useCallback(
    (latest: string) => {
      void requestConfirmDialog(mateUpdateQuestion(mateName, latest))?.then((yes) => {
        if (yes) update(latest);
      });
    },
    [mateName, update],
  );
  const checkThenAsk = useCallback(() => {
    void check().then((answer) => {
      if (capable && answer?.available === true) ask(answer.latest);
    });
  }, [ask, capable, check]);

  if (environment === undefined) return children({ line: null, menuActions: [] });
  // The RPC's on-demand answer, once one has run; otherwise the descriptor's
  // own field. Either way this is the server's answer, relayed as-is — MU-1:
  // nothing here compares versions.
  const effectiveUpdate = mateUpdate.checked ?? environment.update;
  const line = mateUpdateLine(effectiveUpdate, environment.serverVersion);
  const { state } = mateUpdate;
  const running = state.phase === "checking" || state.phase === "updating";

  // The check has its own capability: a server that offers `mateUpdate` but
  // predates `zerops.mate.checkUpdate` would answer the check with an
  // unknown-request defect — exactly the skew this control is here to name.
  const checkActions: ReadonlyArray<ZeropsMenuAction> =
    environment.capabilities.mateUpdateCheck === true
      ? [
          {
            id: "check-for-updates",
            label: state.phase === "checking" ? "Checking…" : "Check for updates",
            onSelect: checkThenAsk,
            disabled: running,
          },
        ]
      : [];

  if (!capable) {
    return children({ line: <MateUpdateLine line={line} />, menuActions: [] });
  }

  const latest = effectiveUpdate?.available === true ? effectiveUpdate.latest : null;
  // What was asked is answered where the verb stands; a failure keeps the
  // verb, to try again, and says why under the line.
  const status = mateUpdateStatus(state);
  const verb =
    status !== null && state.phase !== "failed" ? (
      <MateUpdateStatusText className="text-muted-foreground" status={status} />
    ) : latest === null ? undefined : (
      <ZeropsMateVerb label="Update" onClick={() => ask(latest)} />
    );
  const updateAction: ZeropsMenuAction | null =
    latest === null || running
      ? null
      : { id: "update", label: `Update to ${latest}`, onSelect: () => ask(latest) };

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
