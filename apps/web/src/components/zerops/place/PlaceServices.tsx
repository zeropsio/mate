/**
 * A place's services, one `ServiceRow` card each: its name and what it is, what it runs (its commit,
 * when it was deployed and with which version) or its ports, its ··· — where it is built from, its
 * source archive, *View deploy* — and its CPU, RAM and disk. A bucket or a shared disk has no
 * container to meter, so it says what it is and nothing more.
 *
 * Under the meters, only what is not calm: its newest job where that is not what runs, the version
 * HQ did not make it run, and its deploy, opened from *View deploy*. Where it answers is the place's
 * Addresses card's (`PlaceAddressCard`), and a service the recipe declares and Zerops lacks stands as
 * an empty slot (`PlaceMissingService`).
 */
import type { DeployAnswerJob } from "@t3tools/client-runtime/zerops/hq";
import {
  flowVerbLabel,
  isPlatformSubdomain,
  shortCommit,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import { NOT_PUBLIC_YET, type RunAgain } from "@t3tools/client-runtime/zerops/flow";
import { ArrowUpRightIcon, ExternalLinkIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { usePublicAccess } from "~/zerops/usePublicAccess";
import { Button } from "../../ui/button";
import { MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from "../../ui/menu";
import { MiddleTruncate } from "../../ui/middle-truncate";
import { StopPublicAccessStatus } from "../StopPublicAccess";
import { DeployLogDetails, useDeployLogUnavailable } from "../ZeropsDeployLog";
import { ServiceList, ServiceRow, serviceRunsLine } from "../system";
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
  deployAgain,
  children,
}: {
  readonly projectId: string;
  readonly rows: ReadonlyArray<PlaceServiceRow>;
  /** Whether the platform's use of the services has been read: until then meters hold their room. */
  readonly usageRead: boolean;
  /** HQ's answer to the last verb pressed here, by service. */
  readonly answered: ReadonlyMap<string | null, DeployAnswerJob>;
  /** What the verdict over the table already says: HQ's words for a failure, never said twice. */
  readonly said: string | undefined;
  readonly deployAgain: StopDeployAgain | undefined;
  /** After the cards, in the same list: the recipe's services Zerops lacks. */
  readonly children?: ReactNode;
}) {
  return (
    <div data-zerops-surface="place-services">
      <ServiceList label="Services">
        {rows.map((row) => (
          <PlaceServiceLine
            answer={answered.get(row.hostname)}
            deployAgain={deployAgain}
            key={row.hostname}
            projectId={projectId}
            row={row}
            said={said}
            usageRead={usageRead}
          />
        ))}
        {children}
      </ServiceList>
    </div>
  );
}

/**
 * A service the recipe declares and the project lacks, as an empty slot: what it is for and the one
 * verb that adds it — or, once asked, HQ's answer in its place.
 */
export function PlaceMissingService({
  hostname,
  answer,
  verb,
}: {
  readonly hostname: string;
  readonly answer: DeployAnswerJob | undefined;
  /** *Add <service>*, for whoever may run deploys here. */
  readonly verb: ReactNode;
}) {
  return (
    <li
      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-dashed border-border py-3 ps-4 pe-3"
      data-zerops-missing-service={hostname}
      data-zerops-surface="stop-not-in-zerops"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-foreground/85">{hostname}</span>
        {answer === undefined ? (
          <span className="truncate text-caption text-muted-foreground">
            In its setup files, not in Zerops yet
          </span>
        ) : (
          <span
            className="truncate text-caption text-muted-foreground"
            data-zerops-job-state={answer.state}
          >
            {answer.line}
          </span>
        )}
      </span>
      {verb}
    </li>
  );
}

/**
 * One service as the place's `ServiceRow`: what it runs on its quiet line, where it is built from,
 * its source archive and *View deploy* in its ···, and under its meters only what is not calm — its
 * newest job where that is not what runs, the version HQ did not make it run, and its deploy.
 */
function PlaceServiceLine({
  projectId,
  row,
  usageRead,
  deployAgain,
  answer,
  said,
}: {
  readonly projectId: string;
  readonly row: PlaceServiceRow;
  readonly usageRead: boolean;
  readonly answer: DeployAnswerJob | undefined;
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
  // HQ's answer to the last verb stands under the card in place of what its state said.
  const quiet =
    code !== undefined &&
    answer !== undefined &&
    (code.runs === undefined || code.job !== undefined);
  const archive = answer === undefined ? code?.sourceArchive : answer.sourceArchive;
  const runs = code === undefined ? undefined : serviceRunsLine(code);
  return (
    <ServiceRow
      facts={
        code === undefined ? undefined : runs === undefined ? (
          code.word
        ) : (
          <>
            <span className="font-mono tabular-nums">{runs.commit}</span>
            {runs.rest === undefined ? null : ` · ${runs.rest}`}
          </>
        )
      }
      menuItems={
        code === undefined && deployLog === undefined ? undefined : (
          <>
            {code === undefined ? null : (
              <>
                <MenuGroup>
                  <MenuGroupLabel>{`Built from ${code.repository}`}</MenuGroupLabel>
                  {archive === undefined ? null : <MenuGroupLabel>{archive}</MenuGroupLabel>}
                </MenuGroup>
                <MenuSeparator />
              </>
            )}
            {deployLog === undefined ? null : (
              <ViewDeploy
                onToggle={() => setDeployOpen(!deployOpen)}
                open={deployOpen}
                projectId={projectId}
                target={deployLog}
              />
            )}
          </>
        )
      }
      row={row}
      state={quiet ? null : undefined}
      usageRead={usageRead}
    >
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

/** *View deploy* in the card's ···; what it opens stands under the card's meters. */
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

/**
 * The place's addresses, its own domains first and the platform's subdomains after them, muted;
 * each with the service it reaches. Then the services that serve and answer to nobody, each with
 * *Open to the internet* where the person may; else, where nothing answers from outside, that.
 */
export function PlaceAddressCard({
  projectId,
  routes,
  offers,
  onEnableRoute,
  enablingServiceId,
}: {
  readonly projectId: string;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
}) {
  const publicAccess = usePublicAccess(projectId);
  // Nothing to offer where the caller cannot act on it — a row with a button that does nothing is
  // worse than no row.
  const shownOffers = onEnableRoute === undefined ? [] : offers;
  const ordered = [
    ...routes.filter((route) => !isPlatformSubdomain(route.host)),
    ...routes.filter((route) => isPlatformSubdomain(route.host)),
  ];
  const nothing =
    (!publicAccess.bound || publicAccess.state === "ready") &&
    ordered.length === 0 &&
    shownOffers.length === 0;
  return (
    <div
      className="flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-1.5"
      data-zerops-surface="place-addresses"
    >
      <div className="empty:hidden px-3 py-1">
        <StopPublicAccessStatus access={publicAccess} />
      </div>
      {nothing ? (
        <p className="px-3 py-2.5 text-body text-muted-foreground">
          {NOT_PUBLIC_YET} · nothing here answers from the internet.
        </p>
      ) : null}
      {ordered.map((route) => {
        const subdomain = isPlatformSubdomain(route.host);
        return (
          <a
            // Too narrow for both, what it reaches wraps under the address, which is cut last.
            className="group flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-3 py-2.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-place-address=""
            href={route.url}
            key={route.url}
            rel="noreferrer"
            target="_blank"
          >
            <span
              className={
                subdomain
                  ? "flex max-w-full min-w-0 items-center gap-1 text-body text-muted-foreground group-hover:text-foreground"
                  : "flex max-w-full min-w-0 items-center gap-1 text-sm text-foreground"
              }
            >
              <MiddleTruncate value={route.host} />
              <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
            </span>
            <span className="shrink-0 text-caption text-muted-foreground/80">
              {subdomain ? `${route.service} · Zerops subdomain` : route.service}
            </span>
          </a>
        );
      })}
      {shownOffers.map((offer) => {
        const opening = enablingServiceId === offer.serviceId;
        return (
          <div
            className="flex min-w-0 flex-col items-start gap-2 px-3 py-2.5"
            data-zerops-surface="stop-route-offer"
            key={offer.serviceId}
          >
            <span className="text-body text-muted-foreground">
              {`${offer.service} answers on ${String(offer.port)}, not from outside.`}
            </span>
            <StopPublicAccessStatus access={publicAccess} serviceId={offer.serviceId} />
            <Button
              disabled={opening || enablingServiceId !== null}
              onClick={() => onEnableRoute?.(offer.serviceId)}
              size="sm"
              variant="secondary"
            >
              {opening ? "Opening…" : "Open to the internet"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
