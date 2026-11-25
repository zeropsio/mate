/**
 * A *Put it live* on its project's production — the overview card's Production and the project
 * page's: while HQ runs it, one line whose step's words replace each other in place, with its
 * clock; stopped, the cause and the one action that carries it on. It is drawn from the
 * application's `put_live` operation as HQ's navigation shows it (`usePutLiveStanding`), the same
 * on every device; once it ended done, production's own line says the release it runs.
 *
 * The run belongs to the project: it is drawn wherever its production is, never in a Mate's
 * conversation.
 */
import { operationFailureDetails } from "@t3tools/client-runtime/data";

import { useSecondsNowMs } from "~/zerops/useNowMs";
import { useAccountOperationsOptional } from "~/zerops/accountOperations";
import { useOpenPutLive, usePutLiveStanding } from "~/zerops/putLive";
import { putLiveProgress, type PutLiveStanding } from "~/zerops/putLive.logic";
import { useOpenReview } from "~/zerops/review";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Badge } from "../ui/badge";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { FailureDetails } from "../ui/failure";
import { useGroupName } from "./review/reviewReads";
import { formatElapsed } from "../ui/progress.logic";
import { Spinner } from "../ui/spinner";
import { endOperationIntent } from "./ZeropsOperationEnd.logic";
import { ZeropsOperationEnd } from "./ZeropsOperationEnd";

/**
 * The run's step: a spinner and its words. Its clock says how long the step has run, so a long
 * wait reads as one; it ticks here alone, never the line.
 */
function PutLiveProgress({
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
  readonly project: string;
  readonly standing: Exclude<PutLiveStanding, { readonly kind: "none" }>;
  /** Put it live again, after it failed. */
  readonly onAgain: () => void;
  /** The release's review, where production's release waits for the person. */
  readonly onReview: () => void;
  /** Its maker's Continue on their fresh sign-in; absent for anyone else. */
  readonly onContinue: (() => void) | undefined;
  /** Ends the waiting run, where HQ offers this reader its End. */
  readonly onEnd?: (() => void) | undefined;
}

/** A run's line: what it does, and at its end what it has to say. */
const RUN_LINE =
  "flex min-h-7 min-w-0 items-center gap-2 [&>:last-child:not(:first-child)]:ms-auto";

/** The run on production: under way, or stopped with its one action. */
export function PutLiveRow(props: PutLiveRowProps) {
  const { standing } = props;
  const progress = putLiveProgress(props.project, standing);
  if (standing.kind === "going")
    return (
      // A Put it live run on production: its line, then its cause and its one action.
      <div
        aria-label={progress.title}
        className="grid min-w-0 gap-1 text-line leading-5"
        data-zerops-production-run="progress"
      >
        <p className={cn(RUN_LINE, "text-status-busy-text")}>
          <PutLiveProgress since={standing.since} step={progress.step} />
        </p>
      </div>
    );
  const details = standing.kind === "failed" ? operationFailureDetails(standing.failure) : null;
  const action =
    standing.kind === "review"
      ? { label: "Review release", onPress: props.onReview }
      : standing.kind === "failed"
        ? { label: "Put it live again", onPress: props.onAgain }
        : props.onContinue === undefined
          ? undefined
          : {
              label: standing.kind === "waiting" ? standing.press : "Continue",
              onPress: props.onContinue,
            };
  return (
    <div
      className="grid min-w-0 gap-1 text-line leading-5"
      data-zerops-production-run="failed"
      role="status"
    >
      <p className={cn(RUN_LINE, "text-status-failed-text")}>
        <Badge aria-label="Failed" dot tone="warning" />
        <span className="truncate">{progress.title}</span>
      </p>
      <div className="text-caption leading-5 text-muted-foreground">
        {progress.step}
        {details === null ? null : <FailureDetails>{details}</FailureDetails>}
      </div>
      {action === undefined && props.onEnd === undefined ? null : (
        <p className="flex flex-wrap items-center gap-2.5">
          {action === undefined ? null : (
            <Button onClick={action.onPress} size="sm">
              {action.label}
            </Button>
          )}
          {props.onEnd === undefined ? null : (
            <ZeropsOperationEnd kind="put_live" name={props.project} onEnd={props.onEnd} />
          )}
        </p>
      )}
    </div>
  );
}

/** A project's *Put it live* on its production, while HQ shows one on the application. */
export function ProductionRun({ groupId }: { readonly groupId: string }) {
  const standing = usePutLiveStanding(groupId);
  return standing.kind === "none" ? null : (
    <ProductionRunRead groupId={groupId} standing={standing} />
  );
}

function ProductionRunRead({
  groupId,
  standing,
}: {
  readonly groupId: string;
  readonly standing: Exclude<PutLiveStanding, { readonly kind: "none" }>;
}) {
  const project = useGroupName(groupId) ?? "The project";
  const openPutLive = useOpenPutLive();
  const openReview = useOpenReview();
  const operations = useAccountOperationsOptional();
  const orgId = useZeropsSession().activeOrganization?.id;
  const end = endOperationIntent(standing, orgId, groupId);
  return (
    <PutLiveRow
      onAgain={() => {
        openPutLive(groupId);
      }}
      onContinue={
        standing.kind === "waiting" && standing.yours && operations !== null && orgId !== undefined
          ? () => {
              void operations.submit({
                kind: "continue-operation",
                orgId,
                id: standing.id,
                appId: groupId,
              });
            }
          : undefined
      }
      onEnd={
        end === undefined || operations === null
          ? undefined
          : () => {
              void operations.submit(end);
            }
      }
      onReview={() => {
        openReview({ kind: "release", groupId });
      }}
      project={project}
      standing={standing}
    />
  );
}
