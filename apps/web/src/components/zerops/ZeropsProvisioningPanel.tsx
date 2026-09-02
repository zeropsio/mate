/**
 * "Preparing your project" — every wait says what it is waiting for and how
 * long it will wait, and a wait that runs out offers a way on rather than an
 * error. Presentational: the states come from `provisioning.ts`.
 */

import { ExternalLinkIcon } from "lucide-react";

import type { ProvisioningState } from "@t3tools/client-runtime/zerops/provisioning";

import { Button } from "../ui/button";
import { FlatCard, MicroLabel, Pill, StatusDot } from "./primitives";

/** The platform GUI's own project page — traced from its route table. */
export function zeropsGuiProjectUrl(projectId: string | null): string {
  return projectId ? `https://app.zerops.io/project/${projectId}` : "https://app.zerops.io";
}

function capLabel(capMs: number): string {
  const seconds = Math.round(capMs / 1000);
  // A minute still reads better in seconds; past that, minutes.
  return seconds > 60 ? `up to ${Math.round(seconds / 60)} min` : `up to ${seconds}s`;
}

function provisioningStatus(state: ProvisioningState): {
  readonly label: string;
  readonly pulse?: boolean;
  readonly tone: "ok" | "busy" | "attention" | "failed";
} {
  switch (state.phase) {
    case "ready":
      return { label: "Ready", tone: "ok" };
    case "needs-enable":
      return { label: "Needs Zerops Mate", tone: "attention" };
    case "not-yet-available":
      return { label: "Not available", tone: "attention" };
    case "timed-out":
      return { label: "Taking longer", tone: "attention" };
    case "pool-exhausted":
      return { label: "Project required", tone: "attention" };
    default:
      return { label: "Preparing", pulse: true, tone: "busy" };
  }
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
  // Enable was already tried this wait — the flag was written and the container
  // restarted — and it still is not serving Zerops Mate. With the flag no
  // longer in question, what is left is a zcp release that does not carry mate
  // yet, and pressing Enable again would change nothing.
  const notYetAvailable =
    state.phase === "not-yet-available" ||
    (state.phase === "timed-out" && state.expiredPhase === "awaiting-health" && state.enabled);

  // A container that never answered is either from before Zerops Mate or away;
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
  const status = provisioningStatus(state);

  return (
    <FlatCard
      aria-busy={busy}
      className="space-y-5 p-5 sm:p-6"
      data-zerops-provisioning-phase={state.phase}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <MicroLabel className="text-muted-foreground">Project setup</MicroLabel>
          <h2 className="text-lg font-medium text-foreground">
            {state.phase === "ready" ? "Project ready" : "Preparing your project"}
          </h2>
        </div>
        <StatusDot
          label={status.label}
          tone={status.tone}
          {...(status.pulse === undefined ? {} : { pulse: status.pulse })}
        />
      </div>

      {state.capMs === null ? null : (
        <div className="rounded-[var(--zerops-card-radius)] bg-muted/55 px-4 py-3">
          <p className="text-sm text-foreground">{state.waitingFor}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This step can take {capLabel(state.capMs)}.
          </p>
        </div>
      )}

      {state.detail ? <p className="text-xs text-muted-foreground">{state.detail}</p> : null}

      {state.phase === "needs-enable" || canRestart ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            {state.phase === "needs-enable"
              ? "This container is not serving Zerops Mate. Enabling turns it on for the container and restarts it, which installs the current version. Your files, history and services are untouched."
              : "This container has not answered. Restarting it installs the current version and brings it back — your files, history and services are untouched."}
          </p>
          <Pill
            className="w-full"
            disabled={busy}
            label={busy ? "Enabling…" : "Enable Zerops Mate"}
            onClick={onEnable}
          />
        </div>
      ) : null}

      {notYetAvailable ? (
        <p className="text-sm text-foreground">
          Zerops Mate was turned on for this container and it was restarted, and it still is not
          serving it — so this container&apos;s zcp release does not carry Zerops Mate yet.
          Restarting again will not change that.
        </p>
      ) : null}

      {state.phase === "timed-out" ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Still {state.waitingFor.toLowerCase()}. It may simply be taking longer than usual.
          </p>
          <div className="flex flex-wrap gap-2">
            <Pill disabled={busy} label="Keep waiting" onClick={onRetry} tone="secondary" />
            {guiLink}
          </div>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <p className="text-sm text-foreground">Zerops Mate is ready in this project.</p>
      ) : null}

      {state.phase === "pool-exhausted" ? (
        <p className="text-sm text-foreground">
          No ready-made project was available, so one has to be created.
        </p>
      ) : null}

      {error ? (
        <div
          className="space-y-3 rounded-[var(--zerops-card-radius)] bg-destructive/8 px-4 py-3 text-destructive-foreground"
          role="alert"
        >
          <p className="text-sm">{error}</p>
          <Pill disabled={busy} label="Try again" onClick={onRetry} tone="secondary" />
        </div>
      ) : null}
    </FlatCard>
  );
}
