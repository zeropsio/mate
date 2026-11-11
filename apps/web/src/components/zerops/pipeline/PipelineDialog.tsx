/**
 * A pipeline's dialog, over whatever page is open: what started it, how far it got and how long
 * each step took, why it failed in the platform's words, its build log — live while it runs —
 * and the zerops.yaml it ran. Opened by `?pipeline=<appVersionId>` (`zerops/pipelineSearch.ts`):
 * from a deploy in Mate, or from Zerops' build e-mail. A pipeline of another of the person's
 * organizations switches to it first; one the account cannot open says so.
 */
import { useLocation } from "@tanstack/react-router";
import type { PipelineValue } from "@t3tools/client-runtime/data";
import {
  processFailureWords,
  type ActivityProcess,
} from "@t3tools/client-runtime/zerops/activity/dto";
import {
  formatDuration,
  type PipelineReadout,
  type PipelineTone,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import { zeropsGuiBase } from "@t3tools/client-runtime/zerops/gui";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { usePipeline, type PipelineView } from "~/zerops/activity/usePipeline";
import { pipelineOfSearch, useClosePipeline } from "~/zerops/pipelineSearch";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import { Badge, type BadgeTone } from "../../ui/badge";
import { Button, InlineButton } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { BuildLogLines, emptyLogWords } from "../ZeropsBuildLog";
import { PipelineCalculating, PipelineStepList } from "../operation/PipelineStepList";

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
  const { activeOrganization, organizations, selectOrganization } = useZeropsSession();
  const orgId = activeOrganization?.id ?? null;
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
    <DialogPopup className="max-w-3xl" data-zerops-pipeline={versionId}>
      {view.pipeline === null ? (
        <PipelineWait elsewhere={elsewhere} view={view} />
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
}: {
  readonly view: PipelineView;
  readonly elsewhere: { readonly name: string } | null | undefined;
}): JSX.Element {
  const read = view.read;
  const words =
    elsewhere === null
      ? "This pipeline belongs to an organization this account isn't a member of."
      : elsewhere !== undefined
        ? `Opening ${elsewhere.name}…`
        : read.kind === "missing"
          ? "Zerops has no such pipeline this account can open. Zerops keeps old ones only for a while."
          : read.kind === "unreadable"
            ? "Zerops answered with a pipeline Mate can't read."
            : read.kind === "trouble"
              ? read.trouble === "retrying"
                ? "Can't reach Zerops yet. Trying again…"
                : "Couldn't read this pipeline from Zerops."
              : "Reading the pipeline from Zerops…";
  return (
    <>
      <DialogHeader>
        <DialogTitle>Pipeline</DialogTitle>
        <DialogDescription>{words}</DialogDescription>
      </DialogHeader>
      {read.kind === "trouble" && read.trouble === "stopped" ? (
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
  const title = pipeline.name === null ? service : `${service} · ${pipeline.name}`;
  const overall = readout?.overall;
  const took = overall === undefined ? undefined : formatDuration(overall.durationMs);
  const facts = [
    sourceWords(pipeline),
    pipeline.startedBy === null
      ? null
      : pipeline.startedBy.token
        ? `by the key ${pipeline.startedBy.name}`
        : `by ${pipeline.startedBy.name}`,
    pipeline.created === null ? null : formatDayAwareTimestamp(pipeline.created, timestampFormat),
  ].filter((fact): fact is string => fact !== null && fact !== "");
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
          {facts.length === 0 ? null : <span className="mt-1 block">{facts.join(" · ")}</span>}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-5">
          <PipelineFailure process={view.process} readout={readout} />
          <PipelineSteps readout={readout} live={view.live} service={service} />
          {view.hasBuildLog ? (
            <section aria-label="Build log" className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">Build log</h3>
              {view.buildLog.lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {emptyLogWords(view.buildLog.status)}
                </p>
              ) : (
                <BuildLogLines lines={view.buildLog.lines} live={view.buildLog.status === "live"} />
              )}
            </section>
          ) : null}
          {pipeline.config === null ? null : (
            <PipelineConfig config={pipeline.config} setup={pipeline.setup} />
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
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
          Open in Zerops
        </Button>
      </DialogFooter>
    </>
  );
}

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
      return "Started in Zerops";
    default:
      return null;
  }
}

/** Why it failed, in the platform's words, above the steps: the first thing a failed run asks. */
function PipelineFailure({
  process,
  readout,
}: {
  readonly process: ActivityProcess | undefined;
  readonly readout: PipelineReadout | undefined;
}): JSX.Element | null {
  if (readout?.status.tone !== "failed") return null;
  const failedStep = readout.steps.find((step) => step.state === "failed");
  const command = process?.error?.command;
  const exit = process?.error?.exit;
  const words = process === undefined ? undefined : processFailureWords(process);
  return (
    <Alert variant="error">
      <AlertTitle>
        {failedStep === undefined ? "The pipeline failed" : `${failedStep.label} failed`}
      </AlertTitle>
      <AlertDescription>
        {command === undefined ? null : (
          <p>
            <code className="font-mono">{command}</code>
            {exit === undefined ? " failed." : ` ended with ${exit}.`}
          </p>
        )}
        {words === undefined ? null : <p>{words}</p>}
        {command === undefined && words === undefined ? (
          <p>{failedStep?.sentence ?? "Zerops didn't say why."}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function PipelineSteps({
  readout,
  live,
  service,
}: {
  readonly readout: PipelineReadout | undefined;
  readonly live: boolean;
  readonly service: string;
}): JSX.Element | null {
  if (readout === undefined) return null;
  const label = `${service} pipeline steps`;
  if (readout.calculating || readout.steps.length === 0) {
    return live ? (
      <PipelineCalculating aria-label={label} />
    ) : (
      <p className="text-muted-foreground text-sm">Zerops keeps no steps for this pipeline.</p>
    );
  }
  return <PipelineStepList aria-label={label} steps={readout.steps} />;
}

/** How long a copied zerops.yaml says so. */
const COPIED_MS = 1_200;

function PipelineConfig({
  config,
  setup,
}: {
  readonly config: string;
  readonly setup: string | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <section aria-label="zerops.yaml" className="flex flex-col gap-2">
      <p className="text-sm">
        <InlineButton aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide the zerops.yaml it ran" : "Show the zerops.yaml it ran"}
        </InlineButton>
        {setup === null ? null : <span className="text-muted-foreground"> · setup {setup}</span>}
      </p>
      {open ? (
        <div className="relative">
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/60 px-3 py-2 font-mono text-xs leading-5">
            {config}
          </pre>
          <span className="absolute top-1 right-1">
            <Button
              aria-label={copied ? "Copied zerops.yaml" : "Copy zerops.yaml"}
              onClick={() => {
                void writeTextToClipboard(config, "zerops.yaml").then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
              size="icon-sm"
              variant="ghost"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
