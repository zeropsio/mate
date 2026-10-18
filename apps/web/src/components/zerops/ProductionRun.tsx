/**
 * A release or a *Put it live* run on its project's production — the overview card's Production
 * and the project page's (the owner, of the run drawn above one Mate's composer: "should this be
 * tied to a single mate also?" No): while it is under way, one line whose step's words replace
 * each other in place, with its clock; once live, "v0.1.1 is live", its address and *Copy link*,
 * for as long as the person keeps it; stopped, the cause and the one action that fixes it. With no
 * run of this tab, it says from the project's flow how a release ended (`putLiveResumed`).
 *
 * The run belongs to the project: it is drawn wherever its production is, never in a Mate's
 * conversation.
 */
import { productionProjectOf } from "@t3tools/client-runtime/zerops";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { useCompactProjectFlows, type ZeropsProjectFlow } from "~/zerops/projectFlows";
import { usePutLive, usePutLiveRun } from "~/zerops/putLive";
import {
  putLiveAddress,
  putLiveProgress,
  putLiveReleased,
  putLiveResumed,
  type PutLiveFlowFacts,
  type PutLiveRun,
} from "~/zerops/putLive.logic";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Button } from "../ui/button";
import { FailureDetails } from "../ui/failure";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useGroupName, useProductionAddresses } from "./review/reviewReads";
import { formatElapsed } from "../ui/progress.logic";
import { Spinner } from "../ui/spinner";

/**
 * The run's step: a spinner and its words. Its clock says how long the step has run, so a long
 * wait reads as one; it ticks here alone, never the line.
 */
export function PutLiveProgress({
  step,
  since,
}: {
  readonly step: string;
  readonly since?: number | undefined;
}) {
  return (
    <span aria-live="polite" className="flex items-center gap-1.5" role="status">
      <Spinner aria-hidden="true" role="presentation" size="xs" />
      <span className="truncate">{step}</span>
      {since === undefined ? null : <PutLiveClock since={since} />}
    </span>
  );
}

function PutLiveClock({ since }: { readonly since: number }) {
  const nowMs = useSecondsNowMs(true);
  // Out of the live region: its words change once a step does, never once a second.
  return (
    <span aria-hidden="true" className="shrink-0 tabular-nums">
      · {formatElapsed(nowMs - since)}
    </span>
  );
}

export interface PutLiveRowProps {
  readonly run: PutLiveRun;
  /** Production's address, once read. */
  readonly address: { readonly url: string; readonly host: string } | undefined;
  readonly nowMs: number;
  readonly copied: boolean;
  readonly onCopy: (url: string) => void;
  readonly onAgain: () => void;
  readonly onOpenProject: () => void;
  readonly onDismiss: () => void;
}

const FAILURE_ACTION = {
  again: "Try again",
  project: "Open the project",
  release: "Release",
} as const;

/** The run on production: under way, live, or stopped with its one action. */
export function PutLiveRow(props: PutLiveRowProps) {
  const { run, address } = props;
  const progress = putLiveProgress(run);
  if (run.phase === "live") {
    return (
      <div className="pp-run" data-zerops-production-run="live" role="status">
        <p className="pp-run-line">
          <i aria-hidden="true" className="ov-dot" data-dot="running" />
          <span className="truncate">
            {run.tag === undefined ? progress.title : `${run.tag} is live`}
          </span>
          <span className="pp-run-quiet">{putLiveReleased(run, props.nowMs)}</span>
          <DismissButton onDismiss={props.onDismiss} />
        </p>
        {address === undefined ? null : (
          <p className="pp-run-acts">
            <a className="pp-road-place-link" href={address.url} rel="noreferrer" target="_blank">
              {address.host}
            </a>
            <Button
              onClick={() => {
                props.onCopy(address.url);
              }}
              size="sm"
              variant="link"
            >
              {props.copied ? "Copied" : "Copy link"}
            </Button>
          </p>
        )}
      </div>
    );
  }
  if (run.phase === "failed") {
    const action = run.failure?.action ?? "again";
    return (
      <div className="pp-run" data-zerops-production-run="failed" role="status">
        <p className="pp-run-line" data-tone="failed">
          <i aria-hidden="true" className="ov-dot" data-dot="failed" />
          <span className="truncate">{progress.title}</span>
          <DismissButton onDismiss={props.onDismiss} />
        </p>
        <div className="pp-run-cause">
          {progress.step}
          {run.failure?.detail === undefined ? null : (
            <FailureDetails>{run.failure.detail}</FailureDetails>
          )}
        </div>
        <p className="pp-run-acts">
          <Button
            onClick={
              action === "again" || action === "release" ? props.onAgain : props.onOpenProject
            }
            size="sm"
          >
            {FAILURE_ACTION[action]}
          </Button>
          {run.failure?.alsoProject === true ? (
            <Button onClick={props.onOpenProject} size="sm" variant="link">
              {FAILURE_ACTION.project}
            </Button>
          ) : null}
        </p>
      </div>
    );
  }
  return (
    <div aria-label={progress.title} className="pp-run" data-zerops-production-run="progress">
      <p className="pp-run-line" data-tone="releasing">
        <PutLiveProgress since={progress.since} step={progress.step} />
      </p>
    </div>
  );
}

function DismissButton({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button aria-label="Dismiss" onClick={onDismiss} size="icon-sm" variant="ghost" />}
      >
        <XIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="top">Hide</TooltipPopup>
    </Tooltip>
  );
}

/** What a run resumed from the project's flow reads; `undefined` until it is read. */
function putLiveFlowFacts(flow: ZeropsProjectFlow | undefined): PutLiveFlowFacts | undefined {
  if (flow === undefined || !flow.declarationsRead || !flow.releasesKnown) return undefined;
  return {
    production: productionProjectOf(flow.environments),
    gate: flow.release.gate,
    releases: flow.releases,
    inFlight: flow.release.inFlight,
    suggestion: flow.release.suggestion,
  };
}

/**
 * How a project's release ended where no run of this tab is under way (`putLiveResumed`): a run
 * to follow is kept, and the host drives it; an attempt no longer the person's is forgotten.
 */
function usePutLiveResumed(groupId: string, current: PutLiveRun | undefined) {
  const orgId = useZeropsSession().activeOrganization?.id;
  const project = useGroupName(groupId);
  const kept = usePutLive((state) => state.kept.get(groupId));
  const restore = usePutLive((state) => state.restore);
  const forget = usePutLive((state) => state.forget);
  const flow = useCompactProjectFlows(useMemo(() => [groupId], [groupId])).flows.get(groupId);
  const resumed = useMemo(
    () =>
      orgId === undefined
        ? ({ kind: "none" } as const)
        : putLiveResumed({
            orgId,
            groupId,
            project: project ?? "The project",
            current,
            kept,
            facts: putLiveFlowFacts(flow),
          }),
    [current, flow, groupId, kept, orgId, project],
  );
  useEffect(() => {
    if (resumed.kind === "follow") restore(resumed.run);
    else if (resumed.kind === "forget") forget(groupId);
  }, [forget, groupId, restore, resumed]);
  return resumed;
}

/**
 * A project's run on its production, while it has one of this tab or one the person's own run made
 * (`kept`): only then does it read the project's flow to resume it.
 */
export function ProductionRun({ groupId }: { readonly groupId: string }) {
  const known = usePutLive((state) => state.runs.has(groupId) || state.kept.has(groupId));
  return known ? <ProductionRunRead groupId={groupId} /> : null;
}

function ProductionRunRead({ groupId }: { readonly groupId: string }) {
  const stored = usePutLiveRun(groupId);
  const resumed = usePutLiveResumed(groupId, stored);
  // Drawn in the frame the flow says it, before the store holds it.
  const run = resumed.kind === "follow" || resumed.kind === "stopped" ? resumed.run : stored;
  const restore = usePutLive((state) => state.restore);
  const step = usePutLive((state) => state.step);
  const forget = usePutLive((state) => state.forget);
  const navigate = useNavigate();
  const nowMs = useNowMs();
  const addresses = useProductionAddresses(run?.phase === "live" ? run.productionId : undefined);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  if (resumed.kind === "reading" || run === undefined) return null;
  return (
    <PutLiveRow
      address={putLiveAddress(addresses)}
      copied={isCopied}
      nowMs={nowMs}
      onAgain={() => {
        // A row said from the flow becomes the run its press resumes: production is released to.
        restore(run);
        step(groupId, { kind: "again", at: Date.now() });
      }}
      onCopy={(url) => {
        copyToClipboard(url, undefined);
      }}
      onDismiss={() => {
        forget(groupId);
      }}
      onOpenProject={() => {
        forget(groupId);
        void navigate({ to: "/group/$groupId/flow", params: { groupId } });
      }}
      run={run}
    />
  );
}
