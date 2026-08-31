/**
 * "Preparing your project" — every wait says what it is waiting for and how
 * long it will wait, and a wait that runs out offers a way on rather than an
 * error. Presentational: the states come from `provisioning.ts`.
 */

import { ExternalLinkIcon, RotateCcwIcon } from "lucide-react";

import type { ProvisioningState } from "@t3tools/client-runtime/zerops/provisioning";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/** The platform GUI's own project page — traced from its route table. */
export function zeropsGuiProjectUrl(projectId: string | null): string {
  return projectId ? `https://app.zerops.io/project/${projectId}` : "https://app.zerops.io";
}

function capLabel(capMs: number): string {
  const seconds = Math.round(capMs / 1000);
  // A minute still reads better in seconds; past that, minutes.
  return seconds > 60 ? `up to ${Math.round(seconds / 60)} min` : `up to ${seconds}s`;
}

export function ZeropsProvisioningPanel({
  state,
  busy,
  error,
  onRetry,
  onEnable,
}: {
  readonly state: ProvisioningState;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onEnable: () => void;
}) {
  // A restart was already tried this wait, and the container still predates
  // Zerops Code: it is not stale, it is a zcp release that does not carry z3
  // yet, and offering Enable again would only restart it into the same state.
  const notYetAvailable =
    state.phase === "not-yet-available" ||
    (state.phase === "timed-out" && state.expiredPhase === "awaiting-health" && state.enabled);

  // A container that never answered is either from before Zerops Code or away;
  // both are fixed by the same restart, so once the health wait has run out
  // the panel offers it rather than only ever saying "keep waiting" — unless
  // a restart already ran and changed nothing.
  const canRestart =
    !notYetAvailable &&
    state.phase === "timed-out" &&
    state.expiredPhase === "awaiting-health" &&
    state.containerServiceId !== null;

  const guiLink = (
    <Button
      size="sm"
      variant="ghost"
      render={
        <a href={zeropsGuiProjectUrl(state.projectId)} target="_blank" rel="noreferrer">
          <ExternalLinkIcon className="size-4" />
          Check it in the Zerops GUI
        </a>
      }
    />
  );

  return (
    <div className="space-y-4">
      {state.capMs === null ? null : (
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Spinner className="size-4" />
          <span>{state.waitingFor}</span>
          <span className="text-xs text-muted-foreground">({capLabel(state.capMs)})</span>
        </div>
      )}

      {state.detail ? <p className="text-xs text-muted-foreground">{state.detail}</p> : null}

      {state.phase === "needs-enable" || canRestart ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            {state.phase === "needs-enable"
              ? "This container is not serving Zerops Code: either its zcp predates it, or ZCP_Z3_ENABLED is not set on the service. Restarting installs the current zcp — set that flag first if it is missing. Your files, history and services are untouched."
              : "This container has not answered. Restarting it installs the current version and brings it back — your files, history and services are untouched."}
          </p>
          <Button className="w-full" disabled={busy} onClick={onEnable}>
            {busy ? <Spinner className="size-4" /> : null}
            Enable Zerops Code
          </Button>
        </div>
      ) : null}

      {notYetAvailable ? (
        <p className="text-sm text-foreground">
          Restarting did not bring Zerops Code up. Either it is not in this container&apos;s zcp
          release yet, or ZCP_Z3_ENABLED is not set on the service — check that flag, then press
          Enable Zerops Code again.
        </p>
      ) : null}

      {state.phase === "timed-out" ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Still {state.waitingFor.toLowerCase()}. It may simply be taking longer than usual.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onRetry}>
              <RotateCcwIcon className="size-4" />
              Keep waiting
            </Button>
            {guiLink}
          </div>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <p className="text-sm text-foreground">Zerops Code is ready in this project.</p>
      ) : null}

      {state.phase === "pool-exhausted" ? (
        <p className="text-sm text-foreground">
          No ready-made project was available, so one has to be created.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
