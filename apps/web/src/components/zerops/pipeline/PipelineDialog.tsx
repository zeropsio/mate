/**
 * A pipeline's dialog, over whatever page is open. Its head says what ran, how it ended and how
 * long it took, where the version came from and who started it. Below, two columns read together:
 * the steps in the platform's own words with why the failed one failed (`PipelineTimeline`), and
 * what the pipeline put out — its logs and the zerops.yaml it ran (`PipelineViewer`), opened on
 * the one that tells most. Opened by `?pipeline=<appVersionId>` (`zerops/pipelineSearch.ts`):
 * from a deploy in Mate, or from Zerops' build e-mail. A pipeline of another of the person's
 * organizations switches to it first; one the account cannot open says so.
 */
import { useLocation } from "@tanstack/react-router";
import type { PipelineValue } from "@t3tools/client-runtime/data";
import {
  formatDuration,
  type PipelineTone,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import { zeropsGuiBase } from "@t3tools/client-runtime/zerops/gui";
import { useEffect, useState, type JSX } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { usePipeline, type PipelineView } from "~/zerops/activity/usePipeline";
import { useCancelBuild } from "~/zerops/useCancelBuild";
import { useProjectRoleOffers } from "~/zerops/usePlatformCapabilities";
import { pipelineOfSearch, useClosePipeline } from "~/zerops/pipelineSearch";
import { useAccountDataOptional } from "~/zerops/accountData";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Badge, type BadgeTone } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { PipelineTimeline } from "./PipelineTimeline";
import { PipelineViewer, type PipelineOutput } from "./PipelineViewer";

/** The host every page shares: the address says which pipeline is open. */
export function PipelineDialogHost(): JSX.Element {
  const versionId = useLocation({ select: (location) => pipelineOfSearch(location.search) });
  const close = useClosePipeline();
  // The pipeline stays drawn while the dialog animates out.
  const [shown, setShown] = useState(versionId);
  if (versionId !== null && versionId !== shown) setShown(versionId);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onOpenChangeComplete={(open) => {
        if (!open && versionId === null) setShown(null);
      }}
      open={versionId !== null}
    >
      {shown === null ? null : <PipelineDialog key={shown} versionId={shown} />}
    </Dialog>
  );
}

function PipelineDialog({ versionId }: { readonly versionId: string }): JSX.Element {
  const { organizations, selectOrganization } = useZeropsSession();
  // The organization the account's data observes: right after a switch the session names the new
  // one a render before the data does, and the record is judged against what the reads ask.
  const orgId = useAccountDataOptional()?.orgId ?? null;
  const view = usePipeline(versionId, orgId);
  const read = view.read;
  const elsewhere =
    read.kind === "known" && read.value.organizationId !== orgId
      ? (organizations.find((organization) => organization.id === read.value.organizationId) ??
        null)
      : undefined;
  // A link to a pipeline of another of the person's organizations: following it is asking for it.
  const switchTo = elsewhere?.membershipId;
  useEffect(() => {
    if (switchTo !== undefined) void selectOrganization(switchTo);
  }, [selectOrganization, switchTo]);

  return (
    <DialogPopup className="max-w-6xl" data-zerops-pipeline={versionId}>
      {view.pipeline === null ? (
        <PipelineWait
          elsewhere={elsewhere}
          onChoose={(membershipId) => void selectOrganization(membershipId)}
          organizations={orgId === null ? organizations : []}
          view={view}
        />
      ) : (
        <PipelineBody pipeline={view.pipeline} view={view} />
      )}
    </DialogPopup>
  );
}

/** Until the pipeline is drawn: reading, switching organization, or why it cannot be. */
function PipelineWait({
  view,
  elsewhere,
  organizations,
  onChoose,
}: {
  readonly view: PipelineView;
  readonly elsewhere: { readonly name: string } | null | undefined;
  /** No organization is chosen yet, and these are the person's: the reads wait on one. */
  readonly organizations: ReadonlyArray<{ readonly name: string; readonly membershipId: string }>;
  readonly onChoose: (membershipId: string) => void;
}): JSX.Element {
  const read = view.read;
  const unchosen = organizations.length > 0;
  const words = unchosen
    ? "Choose the organization to open it in. If it belongs to another of yours, Mate switches there."
    : elsewhere === null
      ? "This pipeline belongs to an organization this account isn't a member of."
      : elsewhere !== undefined
        ? `Opening ${elsewhere.name}…`
        : read.kind === "missing"
          ? "There's no such pipeline this account can open. Old pipelines are kept only for a while."
          : read.kind === "unreadable"
            ? "This pipeline came back in a form Mate can't read."
            : read.kind === "trouble"
              ? read.trouble === "retrying"
                ? "Can't read it yet. Trying again…"
                : "Couldn't read this pipeline."
              : "Reading the pipeline…";
  return (
    <>
      <DialogHeader>
        <DialogTitle>Pipeline</DialogTitle>
        <DialogDescription>{words}</DialogDescription>
      </DialogHeader>
      {unchosen ? (
        <DialogFooter variant="bare">
          {organizations.map((organization) => (
            <Button
              key={organization.membershipId}
              onClick={() => onChoose(organization.membershipId)}
              variant="secondary"
            >
              {organization.name}
            </Button>
          ))}
        </DialogFooter>
      ) : read.kind === "trouble" && read.trouble === "stopped" ? (
        <DialogFooter variant="bare">
          <Button onClick={view.again} variant="secondary">
            Try again
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}

const TONE: Readonly<Record<PipelineTone, BadgeTone>> = {
  waiting: "neutral",
  running: "info",
  finished: "success",
  failed: "danger",
  cancelled: "neutral",
};

function PipelineBody({
  pipeline,
  view,
}: {
  readonly pipeline: PipelineValue;
  readonly view: PipelineView;
}): JSX.Element {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const readout = view.readout;
  const service = view.serviceName ?? "Service";
  const title = view.name === null ? service : `${service} · ${view.name}`;
  const overall = readout?.overall;
  const took = overall === undefined ? undefined : formatDuration(overall.durationMs);
  const facts = [
    sourceWords(pipeline),
    pipeline.startedBy === null
      ? null
      : pipeline.startedBy.token
        ? `by the key ${pipeline.startedBy.name}`
        : `by ${pipeline.startedBy.name}`,
    pipeline.created === null
      ? null
      : `started ${formatDayAwareTimestamp(pipeline.created, timestampFormat)}`,
  ].filter((fact): fact is string => fact !== null && fact !== "");
  // The output opens on what tells most when the dialog first knows it, and then stays where the
  // person puts it: a step ending never moves it.
  const [opened, setOpened] = useState<PipelineOutput | null>(view.telling);
  if (opened === null && view.telling !== null) setOpened(view.telling);
  const [chosen, setChosen] = useState<PipelineOutput | null>(null);
  const shown = chosen ?? opened ?? (view.config === null ? null : "config");
  const hasOutput = shown !== null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription render={<div />}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {readout === undefined ? null : (
              <Badge tone={TONE[readout.status.tone]}>{readout.status.word}</Badge>
            )}
            {overall === undefined || took === undefined ? null : (
              <span>
                {overall.label} {took}
              </span>
            )}
            {view.projectName === null ? null : <span>in {view.projectName}</span>}
          </span>
          {facts.length === 0 ? null : (
            <span className="mt-1 block">{capitalize(facts.join(" · "))}</span>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className={hasOutput ? "grid gap-6 md:grid-cols-3" : "flex flex-col gap-6"}>
          <div className="min-w-0">
            {readout === undefined ? (
              <p className="text-muted-foreground text-sm">Reading its steps…</p>
            ) : (
              <PipelineTimeline
                live={view.live}
                onServiceLog={
                  view.logs.service === undefined ? undefined : () => setChosen("service")
                }
                process={view.process}
                readout={readout}
                service={service}
              />
            )}
          </div>
          {hasOutput ? (
            <div className="min-w-0 md:col-span-2">
              <PipelineViewer
                config={view.config}
                logs={view.logs}
                onShow={setChosen}
                projectId={pipeline.projectId}
                setup={view.setup}
                shown={shown}
              />
            </div>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter>
        <CancelBuildControl pipeline={pipeline} process={view.process} />
        <Button
          render={
            <a
              href={`${zeropsGuiBase()}/service-stack/${pipeline.serviceId}/deploy/${pipeline.id}`}
              rel="noreferrer"
              target="_blank"
            />
          }
          variant="ghost"
        >
          Open in Platform
        </Button>
      </DialogFooter>
    </>
  );
}

/** Statuses a build can still be cancelled in: the GUI offers Cancel build in these alone. */
const CANCELABLE: ReadonlySet<string> = new Set(["UPLOADING", "WAITING_TO_BUILD", "BUILDING"]);

/**
 * Cancel build, while the build has not ended and the viewer's role operates the project. It says
 * it is cancelling from the press until the build's process says canceled, and why Zerops refused.
 */
function CancelBuildControl({
  pipeline,
  process,
}: {
  readonly pipeline: PipelineValue;
  readonly process: ActivityProcess | undefined;
}): JSX.Element | null {
  const offers = useProjectRoleOffers(pipeline.projectId);
  const { cancel, cancelling, trouble } = useCancelBuild({
    projectId: pipeline.projectId,
    appVersionId: pipeline.id,
    processId: process?.id ?? null,
  });
  const status = process?.appVersion?.status ?? pipeline.status;
  const canceling = cancelling || process?.status === "CANCELING";
  if (!offers.cancelBuild || (!CANCELABLE.has(status) && !canceling)) return null;
  return (
    <div className="mr-auto flex min-w-0 items-center gap-3">
      <Button disabled={canceling} onClick={() => void cancel()} variant="destructive-ghost">
        {canceling ? "Cancelling…" : "Cancel build"}
      </Button>
      {trouble === null ? null : (
        <p className="min-w-0 text-destructive-foreground text-sm" role="alert">
          {trouble}
        </p>
      )}
    </div>
  );
}

const capitalize = (words: string): string =>
  words.length === 0 ? words : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** Where the version came from, in one phrase. */
function sourceWords(pipeline: PipelineValue): string | null {
  const git = pipeline.git;
  const repository = git?.repository ?? null;
  const from = repository === null ? "" : ` in ${repository}`;
  if (git?.tag != null) return `From tag ${git.tag}${from}`;
  if (git?.commit != null) return `From commit ${git.commit.slice(0, 8)}${from}`;
  if (git?.branch != null) return `From branch ${git.branch}${from}`;
  switch (pipeline.source) {
    case "CLI":
      return "Pushed with zcli";
    case "GUI":
      return "Started in Platform";
    default:
      return null;
  }
}
