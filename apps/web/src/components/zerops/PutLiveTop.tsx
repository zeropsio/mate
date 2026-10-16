/**
 * *Put it live* in the conversation, at the composer's top where the change waited (G7, G8): while
 * the run is under way, the one wait row — its step's words replacing each other in place; once
 * live, the live card — the address, large and the way in, *Copy link*, and the release it runs;
 * stopped, the cause and the one action that fixes it.
 *
 * The wait row is drawn by `PutLiveProgress` alone, so the shared progress piece can take its
 * place in one spot.
 */
import { readZeropsMembership } from "@t3tools/client-runtime/zerops";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useMemo } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMs, useSecondsNowMs } from "~/zerops/useNowMs";
import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useCompactProjectFlows } from "~/zerops/projectFlows";
import { usePutLive, usePutLiveRun } from "~/zerops/putLive";
import {
  putLiveAddress,
  putLiveOffered,
  putLiveProgress,
  putLiveReleased,
  type PutLiveRun,
} from "~/zerops/putLive.logic";
import { useOpenReview } from "~/zerops/review";
import { useEnvironmentQuestionFacts } from "~/zerops/useAddEnvironment";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";

import { ComposerAsk } from "../chat/ComposerAsk";
import { Button } from "../ui/button";
import { FailureDetails } from "../ui/failure";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useProductionAddresses } from "./review/reviewReads";
import { MateFace } from "./primitives";
import { formatElapsed } from "../ui/progress.logic";
import { Spinner } from "../ui/spinner";

/**
 * The one wait row's step: the wait line's spinner and words, at the composer top's detail size so
 * the row keeps the strip's height — until the shared progress piece lands, here alone. Its clock
 * says how long the step has run, so a long wait reads as one; it ticks here alone, never the row.
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
  readonly face: { readonly tint: MateTintId; readonly shape?: MateShapeId | undefined };
  /** Production's address, once read. */
  readonly address: { readonly url: string; readonly host: string } | undefined;
  readonly nowMs: number;
  readonly copied: boolean;
  readonly onCopy: (url: string) => void;
  readonly onAgain: () => void;
  readonly onSeeCode: () => void;
  readonly onOpenProject: () => void;
  readonly onDismiss: () => void;
}

const FAILURE_ACTION = {
  again: "Try again",
  "see-code": "See the code",
  project: "Open the project",
} as const;

export function PutLiveRow(props: PutLiveRowProps) {
  const { run, face, address } = props;
  const progress = putLiveProgress(run);
  if (run.phase === "live") {
    return (
      <ComposerAsk
        actions={
          <>
            {address === undefined ? null : (
              <Button
                onClick={() => {
                  props.onCopy(address.url);
                }}
                size="sm"
                variant="link"
              >
                {props.copied ? "Copied" : "Copy link"}
              </Button>
            )}
            <DismissButton onDismiss={props.onDismiss} />
          </>
        }
        detail={putLiveReleased(run, props.nowMs)}
        face={<MateFace shape={face.shape} size={24} state="done" tint={face.tint} />}
        kind="live"
        label={progress.title}
        title={
          address === undefined ? (
            progress.title
          ) : (
            <a
              className="block truncate text-base text-foreground leading-4.5 underline-offset-4 hover:underline"
              href={address.url}
              rel="noreferrer"
              target="_blank"
            >
              {address.host}
            </a>
          )
        }
      />
    );
  }
  if (run.phase === "failed") {
    const action = run.failure?.action ?? "again";
    return (
      <ComposerAsk
        actions={
          <>
            {run.failure?.alsoProject === true ? (
              <Button onClick={props.onOpenProject} size="sm" variant="link">
                {FAILURE_ACTION.project}
              </Button>
            ) : null}
            <Button
              onClick={
                action === "again"
                  ? props.onAgain
                  : action === "see-code"
                    ? props.onSeeCode
                    : props.onOpenProject
              }
            >
              {FAILURE_ACTION[action]}
            </Button>
            <DismissButton onDismiss={props.onDismiss} />
          </>
        }
        detail={
          run.failure?.detail === undefined ? (
            progress.step
          ) : (
            <>
              {progress.step}
              <FailureDetails>{run.failure.detail}</FailureDetails>
            </>
          )
        }
        face={<MateFace shape={face.shape} size={24} state="needs" tint={face.tint} />}
        kind="live-failed"
        label={progress.title}
        title={progress.title}
      />
    );
  }
  return (
    <ComposerAsk
      detail={<PutLiveProgress since={progress.since} step={progress.step} />}
      face={<MateFace shape={face.shape} size={24} state="working" tint={face.tint} />}
      kind="live-progress"
      label={progress.title}
      title={progress.title}
    />
  );
}

function DismissButton({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Dismiss"
            className="composer-top-dismiss"
            onClick={onDismiss}
            type="button"
          >
            <XIcon aria-hidden="true" />
          </button>
        }
      />
      <TooltipPopup side="top">Hide</TooltipPopup>
    </Tooltip>
  );
}

/** The Mate's project (group) of a conversation, once the inventory places it. */
export function useConversationGroup(threadRef: ScopedThreadRef | null): string | undefined {
  const inventory = useZeropsInventory();
  const projectId = useMateOfEnvironment(threadRef?.environmentId)?.projectId;
  const project = inventory.projects.find((entry) => entry.id === projectId);
  return readZeropsMembership(project).groupId;
}

/** Whether *Put it live* is offered for a project now (`putLiveOffered`). */
export function usePutLiveOffered(groupId: string | undefined): boolean {
  const flows = useCompactProjectFlows(
    useMemo(() => (groupId === undefined ? [] : [groupId]), [groupId]),
  );
  const facts = useEnvironmentQuestionFacts(
    groupId ?? "",
    groupId === undefined ? undefined : flows.flows.get(groupId),
  );
  return groupId !== undefined && putLiveOffered(facts);
}

/** A project's run, as the conversation draws it: the row, or nothing while there is none. */
export function usePutLiveRow(
  groupId: string | undefined,
  face: PutLiveRowProps["face"],
): React.ReactNode {
  const run = usePutLiveRun(groupId);
  const step = usePutLive((state) => state.step);
  const forget = usePutLive((state) => state.forget);
  const openReview = useOpenReview();
  const navigate = useNavigate();
  const nowMs = useNowMs();
  const addresses = useProductionAddresses(run?.phase === "live" ? run.productionId : undefined);
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  if (run === undefined || groupId === undefined) return null;
  return (
    <PutLiveRow
      address={putLiveAddress(addresses)}
      copied={isCopied}
      face={face}
      nowMs={nowMs}
      onAgain={() => {
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
      onSeeCode={() => {
        if (run.change === undefined) return;
        openReview({
          kind: "change",
          groupId,
          repository: run.change.repository,
          number: run.change.number,
        });
      }}
      run={run}
    />
  );
}
