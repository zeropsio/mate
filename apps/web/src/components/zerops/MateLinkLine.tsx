/** Recovery actions and optional collapsed diagnostics, aligned below the Mate's state line. */
import { mateRecoveryActionLabel } from "~/zerops/mateRecovery.logic";
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
import { MateStateDetails } from "./MateStateDetails";
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
    <MateStateDetails label={`Project services (${services.length})`}>
      <div className="grid gap-2" data-zerops-surface="mate-link-processes">
        {services.map((service) => (
          <ArrivalServices key={service.name} services={[service]} />
        ))}
      </div>
    </MateStateDetails>
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
    <>
      {recovery.feedback}
      <MateLinkLineView
        onContainerAction={recovery.feedback === null ? recovery.act : undefined}
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
    </>
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
    <div className="flex w-full flex-col items-center gap-5.5">
      {processes}
      <MateOpeningLine
        onContainerAction={onContainerAction}
        busy={busy}
        onTryNow={onTryNow}
        phrase={{ text: voice.text, actions: voice.actions }}
        details={voice.details}
        projects={projects}
        projectUrl={projectUrl}
      />
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
  details,
  projectUrl,
  onTryNow,
  projects,
  onContainerAction,
  busy,
}: {
  readonly onContainerAction?: ((action: "start" | "restart") => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly phrase: RouteGatePhrase;
  readonly details?: string | undefined;
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
    <div
      className="flex w-full flex-col items-center gap-3 text-center"
      data-zerops-surface="mate-opening"
    >
      {phrase.text === null ? null : (
        <p className="text-sm text-muted-foreground" role="status">
          {phrase.text}
        </p>
      )}
      {askAgain !== null ||
      openInZerops ||
      toProjects ||
      (containerAction !== null && onContainerAction !== undefined) ? (
        <div className="arrival-acts">
          {containerAction === null || onContainerAction === undefined ? null : (
            <Button
              disabled={busy}
              onClick={() => onContainerAction(containerAction)}
              size="compact"
              variant="pill"
            >
              {mateRecoveryActionLabel(containerAction, busy)}
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
      {details ? (
        <MateStateDetails>
          <p className="mt-3 whitespace-pre-wrap break-words text-left">{details}</p>
        </MateStateDetails>
      ) : null}
    </div>
  );
}
