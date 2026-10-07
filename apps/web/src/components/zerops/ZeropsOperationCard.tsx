import { mateImageSource } from "@t3tools/client-runtime/data/mateImage";
/**
 * The Operations-layer card: one shell for every `ZeropsOperation` kind
 * (bootstrap · deploy · import · mount · verify · subdomain · delete · scale
 * · manage · env · devServer · browser · logs · events · process · discover
 * · error). Presentational, props only (R2) — the reducer
 * already produced every people-facing word this renders.
 *
 * Every card heads with one compact row: a kind glyph, then either the
 * status word as the verb label beside the subject (a card that names one
 * service or page, `operationSubject`) or the voice line with the status
 * word at the right; the clock closes the row. A deploy's header says its
 * own word in sentence case — "Deploying", "Deployed", "Failed" — the
 * service, and how long, the pipeline's own time once it read one. Under
 * it, one dense body per kind — a browser check's thumbnail beside its
 * figures, a deploy's pipeline as one row per step in the Zerops GUI's
 * words, an import's as one segmented row, a verify's checks as one row of
 * chips — then one quiet row with the result, the version and the links.
 *
 * Under the line that already names it — its status bar in the Mate at
 * work, its step in an opened log — a card is its body alone (`headless`):
 * the header would say that line a second time.
 *
 * A card is born with its kind's final structure and only fills in: the
 * subject line is held by a placeholder until the input names the target; a
 * browser check reserves its frame; a deploy says it is calculating its
 * steps until the platform has read them from zerops.yml. What a result adds
 * late — why it failed, the version it shipped — appends at the end, so
 * nothing already drawn moves.
 *
 * See `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §5.
 */
import { AssetImage } from "~/assets/AssetImage";
import { useState, type ComponentProps, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AppWindowIcon,
  GlobeIcon,
  RocketIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";

import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  type PipelineReadout,
  type PipelineStepId,
  type PipelineTone,
  formatDuration,
  pipelineStepSentence,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import {
  browserLiveCaption,
  operationTone,
  type ZeropsOperation,
  type ZeropsOperationKind,
  type ZeropsOperationStep,
} from "@t3tools/client-runtime/zerops/model";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import { useRightPanelStore } from "../../rightPanelStore";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { ZeropsMark } from "../ZeropsMark";
import { drawnSteps } from "./operation/drawnSteps";
import { ExplanationBlock } from "./operation/ExplanationBlock";
import { CheckChips, PipelineSegments } from "./operation/OperationStepRow";
import {
  PipelineCalculating,
  PipelineStepList,
  type PipelineStepRow,
} from "./operation/PipelineStepList";
import { OperationSubjectLine } from "./operation/OperationSubjectLine";
import { operationSubject, type OperationSubject } from "./operation/subject";
import { versionLabel } from "./operation/version";
import { FlatCard, MicroLabel, ProcessSteps, StatusDot, type ProcessStep } from "./primitives";
import { cn } from "~/lib/utils";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { ZeropsReadResultBody } from "./ZeropsToolResultCards";

export interface ObservedRegion {
  /** Replaces `operation.steps` for the body while an observation is attached; a deploy's is empty. */
  readonly steps: ReadonlyArray<ZeropsOperationStep & { readonly durationMs?: number }>;
  /** `deploy` only: its pipeline as the Zerops GUI reads it — the body's steps and the header's words. */
  readonly pipeline?: PipelineReadout;
  /** The observation's secondary processes (e.g. a subdomain toggle beside a deploy), one compact row each. */
  readonly chips?: ReadonlyArray<ZeropsOperationStep>;
  /** Empty while the feed observes; "Zerops isn't answering · last update 2m ago" once it is not. */
  readonly provenance: string;
  /** The build log region, when the caller has one. */
  readonly log?: ReactNode;
}

/** The kinds whose steps are one segmented row, the slots reserved from birth: an import, a batch deploy. */
const PIPELINE_KINDS: ReadonlySet<ZeropsOperationKind> = new Set<ZeropsOperationKind>([
  "deploy",
  "import",
]);

/** The glyph that leads a card's header; a kind without its own leads with the mark. */
const KIND_GLYPH: Partial<Record<ZeropsOperationKind, LucideIcon>> = {
  browser: AppWindowIcon,
  deploy: RocketIcon,
  standup: RocketIcon,
  logs: ScrollTextIcon,
  verify: ShieldCheckIcon,
};

export function KindGlyph({ kind }: { readonly kind: ZeropsOperationKind }) {
  const Icon = KIND_GLYPH[kind];
  return Icon === undefined ? (
    <ZeropsMark className="size-3.5 shrink-0" />
  ) : (
    <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  );
}

/**
 * The conversation's one duration ("42s", "1m 12s"), to now while it runs and
 * to its result once settled — undefined when neither timestamp resolves.
 * `formatDuration` writes the chat's `formatWorkDuration` format — a
 * render-only root may not reach the chat's module graph, which holds the
 * platform client (R2) — and, like it, never says less than a second.
 */
function headerDurationText(operation: ZeropsOperation, now: number): string | undefined {
  const startedAtMs = Date.parse(operation.anchorAt);
  const endedAtMs =
    operation.phase === "running"
      ? now
      : operation.settledAt === undefined
        ? Number.NaN
        : Date.parse(operation.settledAt);
  return Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
    ? formatDuration(Math.max(1_000, endedAtMs - startedAtMs))
    : undefined;
}

/**
 * The clock after the status word — led by a middle dot unless it opens the
 * cluster. It holds the room of its widest reading, "9m 59s", so a clock
 * that grows never pushes the header onto a second line: at the row's end
 * always, where the room is out of sight; after a status word only while it
 * runs, so a settled word still meets the card's edge.
 */
function HeaderMeta({
  durationText,
  led,
  running,
}: {
  readonly durationText: string | undefined;
  readonly led: boolean;
  readonly running: boolean;
}) {
  const room = led ? (running ? "min-w-12" : null) : "min-w-11 text-end";
  return durationText !== undefined ? (
    <span className={cn("tabular-nums", room)} data-zerops-operation-duration>
      {led ? "· " : ""}
      {durationText}
    </span>
  ) : null;
}

/** The header's status word when it is not the operation's own: a deploy's, in sentence case. */
interface HeaderStatus {
  readonly word: string;
  readonly tone: ServiceStatusToneId;
}

/**
 * The one header row. A card that names its subject reads verb label +
 * subject, the status dot carrying the verb as its word; any other card
 * reads its voice line with the status word at the right. A `status` given
 * for it is written in sentence case instead of the label.
 */
function CardHeader({
  durationText,
  operation,
  status,
  subject,
}: {
  readonly durationText: string | undefined;
  readonly operation: ZeropsOperation;
  readonly status: HeaderStatus | undefined;
  readonly subject: OperationSubject | undefined;
}) {
  const tone = operationTone(operation);
  const running = operation.phase === "running";
  if (subject !== undefined) {
    const dotTone = status?.tone ?? tone;
    return (
      <header className="flex items-start justify-between gap-3">
        <div
          aria-label="Result status"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
          role="status"
        >
          <KindGlyph kind={operation.kind} />
          <StatusDot
            className={cn("shrink-0 text-muted-foreground", status !== undefined && "text-xs")}
            label={status?.word ?? operation.statusWord}
            pulse={dotTone === "busy"}
            sentence={status !== undefined}
            tone={dotTone}
          />
          <OperationSubjectLine running={running} subject={subject} />
        </div>
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-muted-foreground text-xs">
          <HeaderMeta durationText={durationText} led={false} running={running} />
        </span>
      </header>
    );
  }
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 font-medium text-foreground text-sm">
        <KindGlyph kind={operation.kind} />
        <span className="min-w-0" data-zerops-voice-source={operation.voiceSource}>
          {operation.voice}
        </span>
      </div>
      <span
        aria-label="Result status"
        className="flex shrink-0 items-center gap-1.5 pt-0.5 text-muted-foreground text-xs"
        role="status"
      >
        <StatusDot label={operation.statusWord} pulse={tone === "busy"} sentence tone={tone} />
        <HeaderMeta durationText={durationText} led running={running} />
      </span>
    </header>
  );
}

/**
 * A deploy card reads its pipeline; a batch deploy keeps one segment per
 * target, and a git push — its one step the push — has no build to read.
 */
export function readsPipeline(operation: ZeropsOperation): boolean {
  const pushOnly =
    operation.strategy === "git-push" &&
    operation.steps.length === 1 &&
    operation.steps[0]?.id === "push";
  return operation.kind === "deploy" && operation.batch !== true && !pushOnly;
}

const PIPELINE_DOT_TONE: Readonly<Record<PipelineTone, ServiceStatusToneId>> = {
  waiting: "off",
  running: "busy",
  finished: "ok",
  failed: "failed",
  cancelled: "off",
};

/** The operation's own time in the card's one format: to now while it runs, else to its result. */
function operationDurationText(operation: ZeropsOperation, now: number): string | undefined {
  const startedAtMs = Date.parse(operation.anchorAt);
  const endedAtMs =
    operation.phase === "running"
      ? now
      : operation.settledAt === undefined
        ? Number.NaN
        : Date.parse(operation.settledAt);
  return formatDuration(endedAtMs - startedAtMs);
}

/**
 * A deploy's header: its own word — "Deploying", "Deployed", "Failed", never
 * the pipeline's "Running" beside a "Running for" — and how long: the
 * pipeline's own time while it runs and once it ended, else the operation's.
 * One word, one time (the owner, 2026-09-27, of "● Running · Running for
 * 12s": "font sizes, indicators etc. are pretty poorly done").
 */
function deployHeader(
  operation: ZeropsOperation,
  pipeline: PipelineReadout | undefined,
  now: number,
): { readonly status: HeaderStatus; readonly durationText: string | undefined } {
  const pipelineSpeaks =
    pipeline !== undefined &&
    (operation.phase === "running" ||
      (pipeline.status.tone !== "waiting" && pipeline.status.tone !== "running"));
  const overall = pipelineSpeaks ? pipeline.overall : undefined;
  return {
    status: {
      word: operation.statusWord,
      tone:
        pipelineSpeaks && operation.phase === "running"
          ? PIPELINE_DOT_TONE[pipeline.status.tone]
          : operationTone(operation),
    },
    durationText:
      overall === undefined
        ? operationDurationText(operation, now)
        : formatDuration(overall.durationMs),
  };
}

const PIPELINE_STEP_IDS: ReadonlySet<string> = new Set<PipelineStepId>([
  "INIT_BUILD_CONTAINER",
  "RUN_BUILD_COMMANDS",
  "INIT_PREPARE_CONTAINER",
  "RUN_PREPARE_COMMANDS",
  "DEPLOY",
]);

const isPipelineStepId = (id: string): id is PipelineStepId => PIPELINE_STEP_IDS.has(id);

/**
 * A settled deploy the card never observed (a reload, a second tab): the one
 * step its result names as failed, in the GUI's words — never the steps it
 * cannot know it had.
 */
function reportedFailedStep(operation: ZeropsOperation): PipelineStepRow | undefined {
  const failed = operation.steps.filter((step) => step.state === "failed");
  const only = failed[0];
  if (failed.length !== 1 || only === undefined || !isPipelineStepId(only.id)) {
    return undefined;
  }
  return {
    id: only.id,
    state: "failed",
    sentence: pipelineStepSentence(only.id, "failed", {
      versionName: operation.version?.name,
      serviceName: operation.target?.hostname,
      serviceType: undefined,
    }),
  };
}

/**
 * Why a deploy failed, said once, under the step that broke: zcp's one
 * sentence, whole — its log is a press away on the build's line (the owner,
 * 2026-10-05: "no … long texts").
 */
function FailedBecause({ reason }: { readonly reason: string }) {
  return (
    <span
      className="block break-words text-foreground text-line leading-5"
      data-zerops-operation-failed-because
    >
      {reason}
    </span>
  );
}

/** A deploy's body: its pipeline's steps, "calculating" before they are known. */
function DeployPipeline({
  operation,
  pipeline,
  log,
  saysWhy,
}: {
  readonly operation: ZeropsOperation;
  readonly pipeline: PipelineReadout | undefined;
  /** The way to the build's log, at the end of the step that runs the build (the owner, 2026-09-26: "it should be under the actual step"). */
  readonly log: ReactNode;
  /** Under its line in the chat, it says why once, under the step that broke. */
  readonly saysWhy: boolean;
}) {
  const label = `${operation.kicker} steps`;
  // Why it did not go through, failed or unconfirmed: said once.
  const unsettled = operation.phase !== "running" && operation.phase !== "done";
  const reason = saysWhy && unsettled ? operation.explanation?.reason : undefined;
  const because = (steps: ReadonlyArray<PipelineStepRow>) => {
    const broke = steps.find((step) => step.state === "failed");
    return reason === undefined || broke === undefined
      ? undefined
      : { [broke.id]: <FailedBecause reason={reason} /> };
  };
  if (pipeline !== undefined && !pipeline.calculating && pipeline.steps.length > 0) {
    const under = because(pipeline.steps);
    return (
      <>
        <PipelineStepList
          after={log === null || log === undefined ? undefined : { RUN_BUILD_COMMANDS: log }}
          aria-label={label}
          beneath={under}
          steps={pipeline.steps}
        />
        {/* It failed with no step that broke (a timeout): why, under the steps. */}
        {under === undefined && reason !== undefined ? <FailedBecause reason={reason} /> : null}
      </>
    );
  }
  if (operation.phase === "running") {
    return <PipelineCalculating aria-label={label} />;
  }
  const failed = reportedFailedStep(operation);
  if (failed === undefined) {
    return reason === undefined ? null : <FailedBecause reason={reason} />;
  }
  return <PipelineStepList aria-label={label} beneath={because([failed])} steps={[failed]} />;
}

function UrlChip({ label, url }: { readonly label: string; readonly url: string }) {
  return (
    <ServiceBrowserLink
      aria-label={`Open ${url}`}
      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 font-medium text-info-foreground text-xs hover:underline"
      data-zerops-chip-kind="url"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <GlobeIcon aria-hidden="true" className="size-3 text-success-foreground" />
      <span>{label}</span>
    </ServiceBrowserLink>
  );
}

export interface BrowserScreenshot {
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
}

/** `browser` only: one live frame off the S8b feed — `useOperationCard.ts`'s `liveFrame`. */
export interface LiveBrowserFrame {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** The image the viewport shows: the live frame while running, else the screenshot, else the last live frame — never both, never a layout shift between them. */
function browserViewportImage(
  live: boolean,
  browserScreenshot: BrowserScreenshot | undefined,
  liveFrame: LiveBrowserFrame | undefined,
): BrowserScreenshot | LiveBrowserFrame | undefined {
  return live ? liveFrame : (browserScreenshot ?? liveFrame);
}

/** The non-tail steps — what a person reads as "what the agent did", the plumbing tail excluded. */
function visibleBrowserSteps(operation: ZeropsOperation): ReadonlyArray<ZeropsOperationStep> {
  return operation.steps.filter((step) => step.kind !== "tail");
}

/**
 * The frame's shape, fixed before any pixel arrives: the viewport the agent
 * set in the call's own commands, else agent-browser's default 16:9. Never
 * the image's own size — a frame or a full-page screenshot fills it from the
 * top instead of reshaping the card.
 */
function browserFrameAspectRatio(operation: ZeropsOperation): string {
  const viewport = operation.viewport;
  return viewport === undefined ? "16 / 9" : `${viewport.width} / ${viewport.height}`;
}

/**
 * The thumbnail: a static tint while empty (R6: nothing animates), the live
 * frame while running, the screenshot once settled. With an image, a click
 * (or Enter/Space — it is a button) opens it large; empty, it opens the
 * Browser panel, where the page is being driven.
 */
function BrowserThumbnail({
  aspectRatio,
  image,
  live,
  onOpenImage,
  onOpenPanel,
  subject,
}: {
  readonly aspectRatio: string;
  readonly image: BrowserScreenshot | LiveBrowserFrame | undefined;
  readonly live: boolean;
  readonly onOpenImage: () => void;
  readonly onOpenPanel: () => void;
  readonly subject: string;
}) {
  const label = image !== undefined ? "Open the screenshot" : "Open the Browser panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className="block w-full shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-foreground/5 p-0 max-h-60 @[22rem]:w-[168px] @[22rem]:max-h-32 @[36rem]:w-[200px] @[36rem]:max-h-40"
            data-zerops-browser-viewport
            onClick={image !== undefined ? onOpenImage : onOpenPanel}
            style={{ aspectRatio }}
            type="button"
          />
        }
      >
        {image !== undefined ? (
          <AssetImage
            loading="lazy"
            decoding="async"
            alt={live ? `Live view of ${subject}` : "Screenshot"}
            className="block size-full object-cover object-top"
            data-zerops-browser-image
            src={image.src}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function BrowserCard({
  browserScreenshot,
  header,
  live,
  liveFrame,
  onOpenPanel,
  operation,
}: {
  readonly browserScreenshot: BrowserScreenshot | undefined;
  readonly header: ReactNode;
  readonly live: boolean;
  readonly liveFrame: LiveBrowserFrame | undefined;
  readonly onOpenPanel: () => void;
  readonly operation: ZeropsOperation;
}) {
  const [expanded, setExpanded] = useState(false);
  const image = browserViewportImage(live, browserScreenshot, liveFrame);
  const summary = operation.browserSummary;
  const visibleSteps = visibleBrowserSteps(operation);

  return (
    <div
      className="flex flex-col gap-3 @[22rem]:flex-row @[22rem]:items-start"
      data-zerops-browser-layout
    >
      <BrowserThumbnail
        aspectRatio={browserFrameAspectRatio(operation)}
        image={image}
        live={live}
        onOpenImage={() => setExpanded(true)}
        onOpenPanel={onOpenPanel}
        subject={operation.subject}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs" data-zerops-browser-body>
        {header}
        {operation.phase === "running" ? (
          <p className="text-muted-foreground" data-zerops-browser-live-caption>
            {browserLiveCaption(operation.subject)}
          </p>
        ) : summary !== undefined ? (
          <p
            className={cn(
              "tabular-nums",
              summary.errorCount + summary.failedRequestCount > 0
                ? "text-status-failed-text"
                : "text-muted-foreground",
            )}
            data-zerops-browser-metrics
          >
            {summary.line}
          </p>
        ) : null}
        {summary === undefined && !isRunningPhase(operation) && operation.closing !== undefined ? (
          <p className="text-[13px] text-muted-foreground" data-zerops-card-outcome="true">
            {operation.closing}
          </p>
        ) : null}
        {summary?.failedStep !== undefined ? (
          <ProcessSteps aria-label="Failed step" density="compact" steps={[summary.failedStep]} />
        ) : null}
        {visibleSteps.length > 0 ? (
          <details data-zerops-browser-steps-expander>
            <summary className="w-fit cursor-pointer list-none select-none text-info-foreground text-xs hover:underline [&::-webkit-details-marker]:hidden">
              Show steps
            </summary>
            <div className="mt-1.5">
              <ProcessSteps
                aria-label={`${operation.kicker} steps`}
                density="compact"
                steps={visibleSteps}
              />
            </div>
          </details>
        ) : null}
        {operation.explanation !== undefined ? (
          <ExplanationBlock explanation={operation.explanation} />
        ) : null}
      </div>
      {expanded && image !== undefined
        ? createPortal(
            <ExpandedImageDialog
              onClose={() => setExpanded(false)}
              preview={{ images: [{ src: image.src, name: operation.subject }], index: 0 }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function pipelineListed(pipeline: PipelineReadout | undefined): boolean {
  return pipeline !== undefined && !pipeline.calculating && pipeline.steps.length > 0;
}

function isRunningPhase(operation: ZeropsOperation): boolean {
  return operation.phase === "running";
}

/** A passed verify's chips already say every check passed; its closing is said only on a failure. */
function drawnClosing(operation: ZeropsOperation): string | undefined {
  return operation.kind === "verify" && operation.phase === "done" ? undefined : operation.closing;
}

function StepsBody({
  headless,
  observed,
  operation,
  steps,
}: {
  /** Under its line in the chat: a deploy says why under the step that broke. */
  readonly headless: boolean;
  readonly observed: ObservedRegion | undefined;
  readonly operation: ZeropsOperation;
  readonly steps: ReadonlyArray<ProcessStep>;
}) {
  const saysWhyOnStep = headless && readsPipeline(operation);
  const failedChecks =
    operation.kind === "verify" ? steps.filter((step) => step.state === "failed") : [];
  return (
    <>
      {readsPipeline(operation) ? (
        <DeployPipeline
          log={observed?.log}
          operation={operation}
          pipeline={observed?.pipeline}
          saysWhy={saysWhyOnStep}
        />
      ) : steps.length === 0 ? null : PIPELINE_KINDS.has(operation.kind) ? (
        <PipelineSegments aria-label={`${operation.kicker} progress`} steps={steps} />
      ) : operation.kind === "verify" ? (
        <CheckChips aria-label={`${operation.kicker} progress`} steps={steps} />
      ) : (
        <ProcessSteps aria-label={`${operation.kicker} progress`} density="compact" steps={steps} />
      )}
      {failedChecks.length > 0 ? (
        <ProcessSteps aria-label="Failed checks" density="compact" steps={failedChecks} />
      ) : null}
      {observed?.chips !== undefined && observed.chips.length > 0 ? (
        <ProcessSteps aria-label="Other activity" density="compact" steps={observed.chips} />
      ) : null}
      {/* A pipeline draws its log under its build step; without one, here. */}
      {readsPipeline(operation) && pipelineListed(observed?.pipeline)
        ? null
        : (observed?.log ?? null)}
      {observed !== undefined && observed.provenance.length > 0 ? (
        <p className="text-muted-foreground text-xs" data-zerops-operation-provenance>
          {observed.provenance}
        </p>
      ) : null}
      {/* A deploy says why under the step that broke; any other card here. */}
      {operation.explanation !== undefined && !saysWhyOnStep ? (
        <ExplanationBlock explanation={operation.explanation} />
      ) : null}
    </>
  );
}

export function ZeropsOperationCard(props: {
  readonly operation: ZeropsOperation;
  readonly observed?: ObservedRegion;
  /**
   * `devServer` only: the subdomain URL resolved by the timeline's own
   * topology view (client-topology-view — server feed, not the tool result).
   * Never sourced from `operation.links`, which stays empty for this kind:
   * see `reduce.ts`'s `buildDevServerOperation` doc note.
   */
  readonly devServerUrl?: string;
  /**
   * `browser` only: the screenshot the caller resolved from the provider's
   * own tool-result image content, when the SPI event carries one
   * (`browserScreenshotFor`, `useOperationCard.ts`, S8b) — a provider that
   * drops the image content block (unmeasured per provider as of S8b)
   * falls back to the last live frame instead.
   */
  readonly browserScreenshot?: BrowserScreenshot;
  /** `browser` only: the latest frame off the S8b feed, kept across the running→done transition. */
  readonly liveFrame?: LiveBrowserFrame;
  /** `browser` only: the call is in progress right now — gates whether the viewport shows `liveFrame` or the screenshot. */
  readonly live?: boolean;
  /**
   * `browser` only: the service hostname whose route answers the page's host,
   * resolved by the adapter from the topology view (`browserSubjectHostFor`) —
   * absent, the chip names the URL's own host.
   */
  readonly subjectHost?: string;
  /** Opens the right-panel Browser surface from an empty browser frame — absent thread, absent click target. */
  readonly threadRef?: ScopedThreadRef | null;
  /** For tests; defaults to a clock that moves once a second while running — a text update, never an animation (R6). */
  readonly now?: number;
  /** Under the line that names it — its status bar, its log step: the body alone. */
  readonly headless?: boolean;
}): JSX.Element {
  const {
    browserScreenshot,
    devServerUrl,
    headless = false,
    live = false,
    liveFrame,
    observed,
    operation,
    subjectHost,
    threadRef,
  } = props;
  const tone = operationTone(operation);
  const isRunning = isRunningPhase(operation);
  const tickNow = useSecondsNowMs(props.now === undefined && isRunning);
  const now = props.now ?? tickNow;
  const deploy = readsPipeline(operation)
    ? deployHeader(operation, observed?.pipeline, now)
    : undefined;
  const durationText =
    deploy === undefined ? headerDurationText(operation, now) : deploy.durationText;
  const subject = operationSubject(operation, subjectHost);
  const header = headless ? null : (
    <CardHeader
      durationText={durationText}
      operation={operation}
      status={deploy?.status}
      subject={subject}
    />
  );

  const openBrowserPanel = () => {
    if (threadRef !== undefined && threadRef !== null) {
      useRightPanelStore.getState().open(threadRef, "browser");
    }
  };

  const openLink =
    operation.kind === "devServer" && devServerUrl !== undefined
      ? { label: "Open", url: devServerUrl }
      : undefined;
  const links = openLink !== undefined ? [openLink, ...operation.links] : operation.links;
  // A deploy under its line says what it did in its steps: its version's
  // hash is nothing the person reads (the owner, 2026-10-05: no ids, no hashes).
  const version =
    headless && readsPipeline(operation) ? undefined : versionLabel(operation.version);
  // Under its line (headless), the line says how it went: the closing would
  // say it again, and a bare "Failed." carries nothing — why stays, in its
  // explanation.
  const closing = headless ? undefined : drawnClosing(operation);
  const hasResultRow = closing !== undefined || version !== undefined || links.length > 0;

  const Frame = headless ? HeadlessFrame : FlatCard;
  return (
    <Frame
      className={cn(
        "@container flex flex-col gap-2 overflow-hidden",
        !headless && "px-3.5 py-3",
        !headless && tone === "failed" && "border-[var(--zerops-status-failed)]/35",
      )}
      data-zerops-card
      data-zerops-card-kind={operation.kind}
      data-zerops-card-tone={tone}
      data-zerops-operation-key={operation.key}
    >
      {operation.kind === "browser" ? (
        <BrowserCard
          browserScreenshot={
            browserScreenshot?.src.startsWith("mate-asset:") && threadRef
              ? {
                  ...browserScreenshot,
                  src: mateImageSource({
                    environmentId: threadRef.environmentId,
                    resource: {
                      _tag: "media-file",
                      threadId: threadRef.threadId,
                      path: browserScreenshot.src,
                    },
                  }),
                }
              : browserScreenshot
          }
          header={header}
          live={live}
          liveFrame={liveFrame}
          onOpenPanel={openBrowserPanel}
          operation={operation}
        />
      ) : (
        <>
          {header}
          {operation.readResult !== undefined ? (
            <ZeropsReadResultBody readResult={operation.readResult} steps={operation.steps} />
          ) : (
            <StepsBody
              headless={headless}
              observed={observed}
              operation={operation}
              steps={drawnSteps(operation, observed?.steps ?? operation.steps)}
            />
          )}
          {hasResultRow ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
              data-zerops-result-row
            >
              {closing !== undefined ? (
                <p
                  className="min-w-0 text-[13px] text-muted-foreground"
                  data-zerops-card-outcome="true"
                >
                  {closing}
                </p>
              ) : null}
              {version !== undefined ? (
                <span
                  className="flex items-baseline gap-1.5 text-muted-foreground text-xs"
                  data-zerops-operation-version
                >
                  <MicroLabel>Version</MicroLabel>
                  <span className="font-mono">{version}</span>
                </span>
              ) : null}
              {links.length > 0 ? (
                <div aria-label="URLs" className="flex flex-wrap gap-1.5">
                  {links.map((link) => (
                    <UrlChip key={link.url} label={link.label} url={link.url} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Frame>
  );
}

/** A headless card's frame: no surface of its own, the line above it is its head. */
function HeadlessFrame({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={className} data-zerops-card-headless {...props}>
      {children}
    </div>
  );
}
