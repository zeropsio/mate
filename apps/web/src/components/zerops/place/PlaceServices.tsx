/**
 * A place's services, one `ServiceRow` each: its name with its repository or ports under it, what
 * it is, its state, its CPU, RAM and disk against what it holds, where it answers and its ···. A
 * bucket or a shared disk has no container to meter, so it says what it is and nothing more.
 *
 * Under the row, what the row has no width for: what it runs, its newest job where that is not
 * what runs, the version HQ did not make it run, and its deploy, opened from *View deploy*.
 */
import type { DeployAnswerJob } from "@t3tools/client-runtime/zerops/hq";
import { flowVerbLabel, shortCommit } from "@t3tools/client-runtime/zerops";
import { NOT_PUBLIC_YET, type RunAgain } from "@t3tools/client-runtime/zerops/flow";
import { ArrowUpRightIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { usePublicAccess } from "~/zerops/usePublicAccess";
import { Button } from "../../ui/button";
import { MenuItem } from "../../ui/menu";
import { MiddleTruncate } from "../../ui/middle-truncate";
import { StopPublicAccessStatus } from "../StopPublicAccess";
import { DeployLogDetails, useDeployLogUnavailable } from "../ZeropsDeployLog";
import { ServiceList, ServiceRow } from "../system";
import type { PlaceServiceRow } from "./place.logic";

/**
 * *Deploy … again* on a service that runs a version HQ did not make for it (`StopServiceDrift`):
 * HQ's live commit there, asked again by whoever may *Run again* (the deploy-jobs design).
 */
export interface StopDeployAgain {
  /** Whether it is under way for the service. */
  readonly running: (service: string) => boolean;
  readonly onDeployAgain: (redeploy: RunAgain) => void;
}

export function PlaceServiceTable({
  projectId,
  rows,
  usageRead,
  answered,
  said,
  onEnableRoute,
  enablingServiceId,
  deployAgain,
}: {
  readonly projectId: string;
  readonly rows: ReadonlyArray<PlaceServiceRow>;
  /** Whether the platform's use of the services has been read: until then meters hold their room. */
  readonly usageRead: boolean;
  /** HQ's answer to the last verb pressed here, by service. */
  readonly answered: ReadonlyMap<string | null, DeployAnswerJob>;
  /** What the verdict over the table already says: HQ's words for a failure, never said twice. */
  readonly said: string | undefined;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
  readonly deployAgain: StopDeployAgain | undefined;
}) {
  return (
    <div data-zerops-surface="place-services">
      <ServiceList label="Services">
        {rows.map((row) => (
          <PlaceServiceLine
            answer={answered.get(row.hostname)}
            deployAgain={deployAgain}
            enablingServiceId={enablingServiceId}
            key={row.hostname}
            onEnableRoute={onEnableRoute}
            projectId={projectId}
            row={row}
            said={said}
            usageRead={usageRead}
          />
        ))}
      </ServiceList>
    </div>
  );
}

/**
 * One service as the place's `ServiceRow`: its addresses at the row's end, *View deploy* in its
 * ···, and under it what the row has no width for — what it runs, its newest job where that is not
 * what runs, the version HQ did not make it run, and its deploy.
 */
function PlaceServiceLine({
  projectId,
  row,
  usageRead,
  onEnableRoute,
  enablingServiceId,
  deployAgain,
  answer,
  said,
}: {
  readonly projectId: string;
  readonly row: PlaceServiceRow;
  readonly usageRead: boolean;
  readonly answer: DeployAnswerJob | undefined;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
  readonly deployAgain: StopDeployAgain | undefined;
  readonly said: string | undefined;
}) {
  const [deployOpen, setDeployOpen] = useState(false);
  const code = row.code;
  const deployLog =
    code === undefined
      ? undefined
      : answer === undefined
        ? code.deployLog
        : answer.jobId === code.deployLog?.jobId
          ? code.deployLog
          : answer.deployLog;
  const again = code?.drift?.redeploy;
  // HQ's answer to the last verb stands under the row in place of what its state said.
  const quiet =
    code !== undefined &&
    answer !== undefined &&
    (code.runs === undefined || code.job !== undefined);
  return (
    <ServiceRow
      menuItems={
        deployLog === undefined ? undefined : (
          <ViewDeploy
            onToggle={() => setDeployOpen(!deployOpen)}
            open={deployOpen}
            projectId={projectId}
            target={deployLog}
          />
        )
      }
      row={row}
      state={quiet ? <span /> : undefined}
      usageRead={usageRead}
    >
      {/* What it runs and where it answers, under the row: in the row they would push its
          columns out of line with the rows around it. */}
      {code === undefined ? null : (
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <PlaceRuns row={code} />
          <PlaceAddresses
            enablingServiceId={enablingServiceId}
            onEnableRoute={onEnableRoute}
            projectId={projectId}
            row={code}
          />
        </span>
      )}
      {code === undefined ? null : answer !== undefined ? (
        <span className="text-caption text-muted-foreground" data-zerops-job-state={answer.state}>
          {answer.line}
        </span>
      ) : code.job === undefined ? null : (
        <span
          className="flex min-w-0 flex-col items-start gap-1 text-caption text-muted-foreground"
          data-zerops-surface="stop-service-job"
          data-zerops-job-state={code.job.state}
        >
          <span className="truncate">{code.job.line}</span>
          {code.job.redeploy === undefined || deployAgain === undefined ? null : (
            <Button
              disabled={deployAgain.running(code.job.redeploy.service)}
              onClick={() =>
                code.job?.redeploy !== undefined && deployAgain.onDeployAgain(code.job.redeploy)
              }
              size="sm"
              variant="secondary"
            >
              {flowVerbLabel("redeploy", deployAgain.running(code.job.redeploy.service))}
            </Button>
          )}
          {code.job.reason === undefined || code.job.reason === said ? null : (
            <span>{code.job.reason}</span>
          )}
        </span>
      )}
      {(answer === undefined ? code?.sourceArchive : answer.sourceArchive) === undefined ? null : (
        <span className="text-caption text-muted-foreground">
          {answer === undefined ? code?.sourceArchive : answer.sourceArchive}
        </span>
      )}
      {/* What it runs, where HQ did not make it run that: never overwritten, said here. */}
      {code?.drift === undefined ? null : (
        <span
          className="flex min-w-0 flex-wrap items-center gap-2 text-caption"
          data-zerops-surface="stop-service-drift"
        >
          <span className="text-status-attention-text">{code.drift.line}</span>
          {deployAgain === undefined || again === undefined ? null : (
            <Button
              disabled={deployAgain.running(again.service)}
              onClick={() => deployAgain.onDeployAgain(again)}
              size="sm"
              variant="secondary"
            >
              {deployAgain.running(again.service)
                ? flowVerbLabel("redeploy", true)
                : `Deploy ${shortCommit(again.sha)} again`}
            </Button>
          )}
          {code.drift.zerops === undefined ? null : (
            <a
              className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline"
              href={code.drift.zerops}
              rel="noreferrer"
              target="_blank"
            >
              Open in Zerops
              <ExternalLinkIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </a>
          )}
        </span>
      )}
      {deployLog === undefined || !deployOpen ? null : (
        <DeployLogDetails
          key={deployLog.jobId}
          projectId={projectId}
          service={row.hostname}
          target={deployLog}
        />
      )}
    </ServiceRow>
  );
}

/** What a code service runs, under its row: its commit and how it got there; nothing claimed without one. */
function PlaceRuns({ row }: { readonly row: NonNullable<PlaceServiceRow["code"]> }) {
  if (row.commit === undefined) return null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-caption text-muted-foreground">
      <span className="font-mono text-foreground tabular-nums">{row.commit}</span>
      {row.line === undefined ? null : <span className="truncate">{row.line}</span>}
    </span>
  );
}

/**
 * Where a code service answers: its addresses, wrapped and each cut to the cell; else, where it
 * serves HTTP and answers to nobody, the sentence that says so and the way to open it.
 */
function PlaceAddresses({
  projectId,
  row,
  onEnableRoute,
  enablingServiceId,
}: {
  readonly projectId: string;
  readonly row: NonNullable<PlaceServiceRow["code"]>;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
}) {
  const publicAccess = usePublicAccess(projectId);
  // Nothing to offer where the caller cannot act on it — a row with a button
  // that does nothing is worse than no row.
  const offers = onEnableRoute === undefined ? [] : row.offers;
  return (
    <>
      {(!publicAccess.bound || publicAccess.state === "ready") &&
      row.routes.length === 0 &&
      offers.length === 0 ? (
        <span className="truncate text-caption text-muted-foreground">{NOT_PUBLIC_YET}</span>
      ) : null}
      <StopPublicAccessStatus access={publicAccess} serviceId={row.serviceId ?? null} />
      {row.routes.map((route) => (
        <a
          className="flex max-w-72 min-w-0 items-center gap-0.5 text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          data-zerops-place-address=""
          href={route.url}
          key={route.host}
          rel="noreferrer"
          target="_blank"
        >
          <MiddleTruncate value={route.host} />
          <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
        </a>
      ))}
      {offers.map((offer) => {
        const opening = enablingServiceId === offer.serviceId;
        return (
          <span
            className="flex min-w-0 items-center gap-x-2"
            data-zerops-surface="stop-route-offer"
            key={offer.serviceId}
          >
            <span className="text-caption text-muted-foreground">
              Answers on {offer.port}, not from outside.
            </span>
            <Button
              disabled={opening || enablingServiceId !== null}
              onClick={() => onEnableRoute?.(offer.serviceId)}
              size="sm"
              variant="secondary"
            >
              {opening ? "Opening…" : "Open to the internet"}
            </Button>
          </span>
        );
      })}
    </>
  );
}

/** *View deploy* in the row's ···; what it opens stands under the row. */
function ViewDeploy({
  projectId,
  target,
  open,
  onToggle,
}: {
  readonly projectId: string;
  readonly target: NonNullable<NonNullable<PlaceServiceRow["code"]>["deployLog"]>;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const unavailable = useDeployLogUnavailable(projectId, target);
  return (
    <MenuItem data-zerops-deploy-job={target.jobId} onClick={onToggle}>
      {open ? "Hide deploy" : unavailable ? "Check deploy history" : "View deploy"}
    </MenuItem>
  );
}
