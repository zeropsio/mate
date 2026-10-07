/** Recovery actions and optional collapsed diagnostics, aligned below the Mate's state line. */
import { useMateRecoveryAction } from "~/zerops/useMateRecoveryAction";
import { askAgainLabel, type RouteGatePhrase } from "@t3tools/client-runtime/zerops/environments";
import type { WebMateVoice as MateVoice } from "../../zerops/mateNoticeVoice";
import { Link } from "@tanstack/react-router";
import { useState, type ReactElement, type ReactNode } from "react";

import { useProjectActivity } from "~/zerops/activity/useProjectActivity";
import { useProjectServices } from "~/zerops/ZeropsAccountData";
import { inFirstSeenOrder } from "~/zerops/mateArrival";
import type { ArrivalService } from "~/zerops/mateArrival";
import { mateLinkProcesses } from "~/zerops/mateLinkProcesses";
import { Button } from "../ui/button";
import { ArrivalServices } from "./ZeropsArrivalSteps";

export type Spoken = Exclude<MateVoice, { readonly surface: "none" }>;

/** The platform's processes under the line, their names in the order first seen. */
export function MateLinkProcesses({
  projectId,
  mateServiceId,
}: {
  readonly projectId: string;
  readonly mateServiceId: string | undefined;
}) {
  const { services } = useProjectServices(projectId);
  const { processes } = useProjectActivity(projectId);
  const read = mateLinkProcesses({
    services,
    processes,
    mateServiceId,
  });
  // A name never trades places while nothing about it changed.
  const [seen, setSeen] = useState<ReadonlyArray<string>>([]);
  const { order, seen: next } = inFirstSeenOrder(
    seen,
    read.map((service) => service.name),
  );
  if (next !== seen) setSeen(next);
  const ordered = order.flatMap((name) => read.filter((service) => service.name === name));
  return <MateLinkProcessesView services={ordered} />;
}

/** Optional diagnostics: one service per line, collapsed until the person asks to see them. */
export function MateLinkProcessesView({
  services,
}: {
  readonly services: ReadonlyArray<ArrivalService>;
}) {
  if (services.length === 0) return null;
  return (
    <details
      className="w-full text-sm text-muted-foreground"
      data-zerops-surface="mate-link-processes"
    >
      <summary className="cursor-pointer">Project services ({services.length})</summary>
      <div className="mt-3 grid gap-2">
        {services.map((service) => (
          <ArrivalServices key={service.name} services={[service]} />
        ))}
      </div>
    </details>
  );
}

/** The stage's slot for its link: its one line, its verb once, and its processes when slow. */
export function MateLinkLine({
  voice,
  projectId,
  mateServiceId,
  projectUrl,
  onTryNow,
}: {
  readonly voice: Spoken;
  readonly projectId: string | null;
  readonly mateServiceId: string | undefined;
  readonly projectUrl: string | undefined;
  readonly onTryNow: (() => void) | undefined;
}) {
  const recovery = useMateRecoveryAction(projectId);
  return (
    <MateLinkLineView
      onContainerAction={recovery.act}
      busy={recovery.busy}
      onTryNow={onTryNow}
      processes={
        voice.processes && projectId !== null ? (
          <MateLinkProcesses mateServiceId={mateServiceId} projectId={projectId} />
        ) : null
      }
      projects={<Link to="/zerops" />}
      projectUrl={projectUrl}
      voice={voice}
    />
  );
}

/** The slot as drawn: the line, its verb once, and what stands under it. */
export function MateLinkLineView({
  voice,
  processes,
  projects,
  projectUrl,
  onTryNow,
  onContainerAction,
  busy,
}: {
  readonly onContainerAction?: ((action: "start" | "restart") => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly voice: Spoken;
  readonly processes: ReactNode;
  readonly projects: ReactElement;
  readonly projectUrl: string | undefined;
  readonly onTryNow: (() => void) | undefined;
}) {
  return (
    <div className="flex w-full flex-col items-start gap-4">
      <MateOpeningLine
        onContainerAction={onContainerAction}
        busy={busy}
        onTryNow={onTryNow}
        phrase={{ text: voice.text, actions: voice.actions }}
        projects={projects}
        projectUrl={projectUrl}
      />
      {processes}
    </div>
  );
}

/**
 * Under a Mate's name while its link is made, or when it cannot be opened: the route gate's words
 * for its verdict (`mateOpeningPhrase`), and each of its verbs once — *Try now* (*Try again* after
 * a refusal) asks its Mate again;
 * *Start*, *Enable* and *Restart* are the projects screen's verbs, so until this view carries the
 * container machine's own they are *Go to projects*, as on the conversation's route.
 */
export function MateOpeningLine({
  phrase,
  projectUrl,
  onTryNow,
  projects,
  onContainerAction,
  busy,
}: {
  readonly onContainerAction?: ((action: "start" | "restart") => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly phrase: RouteGatePhrase;
  /** Its project in Zerops, for "Open in Zerops". */
  readonly projectUrl: string | undefined;
  /** Retries its link; absent while nothing names its target. */
  readonly onTryNow: (() => void) | undefined;
  /** What *Go to projects* is: the router's link to the projects screen. */
  readonly projects: ReactElement;
}): ReactNode {
  const askAgain = onTryNow === undefined ? null : askAgainLabel(phrase.actions);
  const openInZerops = projectUrl !== undefined && phrase.actions.includes("open-in-zerops");
  const containerAction = phrase.actions.includes("start")
    ? "start"
    : phrase.actions.includes("restart")
      ? "restart"
      : null;
  const toProjects = phrase.actions.some(
    (action) =>
      action === "go-to-projects" ||
      ((action === "start" || action === "restart") && onContainerAction === undefined) ||
      action === "enable" ||
      (action === "open-in-zerops" && projectUrl === undefined),
  );
  return (
    <div className="flex w-full flex-col items-start gap-3" data-zerops-surface="mate-opening">
      {phrase.text === null ? null : (
        <p className="text-sm text-muted-foreground" role="status">
          {phrase.text}
        </p>
      )}
      {askAgain !== null ||
      openInZerops ||
      toProjects ||
      (containerAction !== null && onContainerAction !== undefined) ? (
        <div className="flex flex-wrap items-center gap-2">
          {containerAction === null || onContainerAction === undefined ? null : (
            <Button
              disabled={busy}
              onClick={() => onContainerAction(containerAction)}
              size="compact"
              variant="pill"
            >
              {busy ? "Asking Zerops…" : containerAction === "start" ? "Start" : "Retry restart"}
            </Button>
          )}
          {askAgain === null ? null : (
            <Button onClick={onTryNow} size="compact" variant="pill">
              {askAgain}
            </Button>
          )}
          {openInZerops ? (
            <Button
              render={<a href={projectUrl} rel="noreferrer" target="_blank" />}
              size="compact"
              variant="pill"
            >
              Open in Zerops
            </Button>
          ) : null}
          {toProjects ? (
            <Button render={projects} size="compact" variant="pill">
              Go to projects
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
