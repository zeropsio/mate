/**
 * The update line plus the one verb (spec-mate.md §2.9, MU-2), for a
 * connected environment: self-contained, so it can sit inside a list row
 * (the Mate card) or the Mate's home card without the caller managing a hook
 * per candidate. Reads the live descriptor off `useEnvironment` — the same
 * subscription `serverConfig` already rides — never a version comparison
 * of its own (MU-1). What an update came to is read off the same descriptor:
 * its version and its boot (`useMateUpdate`).
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
 *
 * The update installs the newest version there is, so pressing Update checks
 * first and the question names what the check found (run 2: "Update Wren to
 * 0.15.145?" installed 0.15.146, the version an hour-old check knew); where
 * no check can say, it asks about the newest version.
 */
import { useCallback, type ReactNode } from "react";

import type { EnvironmentId, ExecutionEnvironmentUpdate } from "@t3tools/contracts";

import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironment } from "../../state/environments";
import {
  mateUpdateLine,
  mateUpdateQuestion,
  mateUpdateStatusBeside,
  NEWEST_MATE_VERSION,
} from "../../zerops/mateUpdate";
import { useMateUpdate } from "../../zerops/useMateUpdate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateUpdateLine, MateUpdateStatusText } from "./MateUpdateLine";
import { ZeropsMateVerb } from "./ZeropsMateCard";
import type { ZeropsMenuAction } from "./ZeropsProjectMenu";

/** An update already under way: zcp's own, or the Mate's restart waiting on its work. */
function busy(update: ExecutionEnvironmentUpdate): boolean {
  return (
    ["staging", "draining", "switching", "verifying"].includes(update.automatic?.phase ?? "") ||
    update.restart?.phase === "draining" ||
    update.restart?.phase === "restarting"
  );
}

/** What a restart installs, for the question: zcp's version when zcp is what is behind. */
function restartOf(update: ExecutionEnvironmentUpdate): { readonly zcp?: string | undefined } {
  return update.zcp?.behind === true ? { zcp: update.zcp.latest } : {};
}

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
  const mateUpdate = useMateUpdate(environmentId, environment ?? null);
  const { check, update } = mateUpdate;
  const capable = environment?.capabilities.mateUpdate === true;

  const canCheck = environment?.capabilities.mateUpdateCheck === true;

  const ask = useCallback(
    (latest: string | null, restart?: { readonly zcp?: string | undefined }) => {
      void requestConfirmDialog(mateUpdateQuestion(mateName, latest, restart))?.then((yes) => {
        if (!yes) return;
        // A restart for zcp alone says the zcp it installs while it runs.
        const to =
          latest ?? (restart?.zcp === undefined ? NEWEST_MATE_VERSION : `zcp ${restart.zcp}`);
        update(to, restart !== undefined);
      });
    },
    [mateName, update],
  );
  // Check for updates asks only where the check found a newer version; Update, pressed, asks
  // about the newest version where the check could not answer.
  const checkThenAsk = useCallback(
    (pressed: "check" | "update") => {
      void check().then((answer) => {
        if (!capable) return;
        if (answer === undefined) {
          if (pressed === "update") ask(null);
          return;
        }
        if (answer === null || busy(answer)) return;
        if (answer.restart?.needed === true)
          ask(answer.available ? answer.latest : null, restartOf(answer));
        else if (answer.available) ask(answer.latest);
      });
    },
    [ask, capable, check],
  );
  const pressUpdate = useCallback(() => {
    if (canCheck) checkThenAsk("update");
    else ask(null);
  }, [ask, canCheck, checkThenAsk]);

  if (environment === undefined) return children({ line: null, menuActions: [] });
  // The RPC's on-demand answer, once one has run; otherwise the descriptor's
  // own field. Either way this is the server's answer, relayed as-is — MU-1:
  // nothing here compares versions.
  const effectiveUpdate =
    mateUpdate.checked === undefined ? environment.update : mateUpdate.checked;
  const line = mateUpdateLine(effectiveUpdate ?? undefined, environment.serverVersion);
  const { state } = mateUpdate;
  const automaticBusy = effectiveUpdate != null && busy(effectiveUpdate);
  const running = state.phase === "checking" || state.phase === "updating" || automaticBusy;

  // The check has its own capability: a server that offers `mateUpdate` but
  // predates `zerops.mate.checkUpdate` would answer the check with an
  // unknown-request defect — exactly the skew this control is here to name.
  const checkActions: ReadonlyArray<ZeropsMenuAction> = canCheck
    ? [
        {
          id: "check-for-updates",
          label: state.phase === "checking" ? "Checking…" : "Check for updates",
          onSelect: () => checkThenAsk("check"),
          disabled: running,
        },
      ]
    : [];

  if (!capable) {
    return children({ line: <MateUpdateLine line={line} />, menuActions: [] });
  }

  const latest = effectiveUpdate?.available === true ? effectiveUpdate.latest : null;
  // Only a container restart gets this Mate current: the same verb, saying zcp's why on hover.
  const restartWhy =
    effectiveUpdate?.restart?.needed === true
      ? (effectiveUpdate.restart.why ?? "Only a restart gets this Mate current")
      : null;
  const offered = latest !== null || restartWhy !== null;
  // What was asked is answered where the verb stands; a failure keeps the
  // verb, to try again, and says why under the line.
  const status = automaticBusy ? null : mateUpdateStatusBeside(line, state);
  const verb =
    status !== null && state.phase !== "failed" ? (
      <MateUpdateStatusText className="text-muted-foreground" status={status} />
    ) : !offered || automaticBusy ? undefined : restartWhy === null ? (
      <ZeropsMateVerb label="Update" onClick={pressUpdate} />
    ) : (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
          <ZeropsMateVerb description={restartWhy} label="Update" onClick={pressUpdate} />
        </TooltipTrigger>
        <TooltipPopup side="top">{restartWhy}</TooltipPopup>
      </Tooltip>
    );
  const updateAction: ZeropsMenuAction | null =
    !offered || running
      ? null
      : {
          id: "update",
          label: latest === null ? "Update" : `Update to ${latest}`,
          onSelect: pressUpdate,
        };

  return children({
    line: (
      <>
        <MateUpdateLine line={line} verb={verb} />
        {mateUpdate.notice && !automaticBusy ? <span>{mateUpdate.notice}</span> : null}
        {state.phase === "failed" &&
        effectiveUpdate?.automatic?.phase !== "postponed" &&
        effectiveUpdate?.restart?.phase !== "postponed" ? (
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
