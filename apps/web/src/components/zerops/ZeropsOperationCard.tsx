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
 * word at the right; the clock closes the row. Under it, one
 * dense body per kind — a browser check's thumbnail beside its figures, a
 * deploy's pipeline as one segmented row, a verify's checks as one row of
 * chips — then one quiet row with the result, the version and the links.
 *
 * A card is born with its kind's final structure and only fills in: the
 * subject line is held by a placeholder until the input names the target; a
 * browser check reserves its frame; a deploy's five pipeline slots arrive
 * with the reducer. What a result adds late — why it failed, the version it
 * shipped — appends at the end, so nothing already drawn moves.
 *
 * See `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §5.
 */
import { useState, type JSX, type ReactNode } from "react";
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
  browserLiveCaption,
  operationTone,
  type ZeropsOperation,
  type ZeropsOperationKind,
  type ZeropsOperationStep,
} from "@t3tools/client-runtime/zerops/model";

import { useRightPanelStore } from "../../rightPanelStore";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { ZeropsMark } from "../ZeropsMark";
import { ExplanationBlock } from "./operation/ExplanationBlock";
import { CheckChips, PipelineSegments } from "./operation/OperationStepRow";
import { OperationSubjectLine } from "./operation/OperationSubjectLine";
import { operationSubject, type OperationSubject } from "./operation/subject";
import { versionLabel } from "./operation/version";
import {
  FlatCard,
  formatStepDuration,
  MicroLabel,
  ProcessSteps,
  StatusDot,
  type ProcessStep,
} from "./primitives";
import { cn } from "~/lib/utils";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { ZeropsReadResultBody } from "./ZeropsToolResultCards";

export interface ObservedRegion {
  /** Replaces `operation.steps` for the body while an observation is attached. */
  readonly steps: ReadonlyArray<ZeropsOperationStep & { readonly durationMs?: number }>;
  /** The observation's secondary processes (e.g. a subdomain toggle beside a deploy), one compact row each. */
  readonly chips?: ReadonlyArray<ZeropsOperationStep>;
  /** e.g. "live from Zerops · 2 s ago", frozen as "as last read from Zerops" once the card settles. */
  readonly provenance: string;
  /** The build log region, when the caller has one. */
  readonly log?: ReactNode;
}

/** The kinds whose steps are a pipeline: one segmented row, the slots reserved from birth. */
const PIPELINE_KINDS: ReadonlySet<ZeropsOperationKind> = new Set<ZeropsOperationKind>([
  "deploy",
  "import",
]);

/** The glyph that leads a card's header; a kind without its own leads with the mark. */
const KIND_GLYPH: Partial<Record<ZeropsOperationKind, LucideIcon>> = {
  browser: AppWindowIcon,
  deploy: RocketIcon,
  logs: ScrollTextIcon,
  verify: ShieldCheckIcon,
};

function KindGlyph({ kind }: { readonly kind: ZeropsOperationKind }) {
  const Icon = KIND_GLYPH[kind];
  return Icon === undefined ? (
    <ZeropsMark className="size-3.5 shrink-0" />
  ) : (
    <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  );
}

/** `m:ss` — the running clock, ticking once a second. */
function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** `0:42` while running, `1m 12s` once settled — undefined when neither timestamp resolves. */
function headerDurationText(operation: ZeropsOperation, now: number): string | undefined {
  const startedAtMs = Date.parse(operation.anchorAt);
  if (!Number.isFinite(startedAtMs)) {
    return undefined;
  }
  if (operation.phase === "running") {
    return formatElapsedClock(Math.max(0, now - startedAtMs));
  }
  if (operation.settledAt === undefined) {
    return undefined;
  }
  const settledAtMs = Date.parse(operation.settledAt);
  return Number.isFinite(settledAtMs)
    ? formatStepDuration(Math.max(0, settledAtMs - startedAtMs))
    : undefined;
}

/** The clock after the status word — led by a middle dot unless it opens the cluster. */
function HeaderMeta({
  durationText,
  led,
}: {
  readonly durationText: string | undefined;
  readonly led: boolean;
}) {
  return durationText !== undefined ? (
    <span className="tabular-nums" data-zerops-operation-duration>
      {led ? "· " : ""}
      {durationText}
    </span>
  ) : null;
}

/**
 * The one header row. A card that names its subject reads verb label +
 * subject, the status dot carrying the verb as its word; any other card
 * reads its voice line with the status word at the right.
 */
function CardHeader({
  durationText,
  operation,
  subject,
}: {
  readonly durationText: string | undefined;
  readonly operation: ZeropsOperation;
  readonly subject: OperationSubject | undefined;
}) {
  const tone = operationTone(operation);
  if (subject !== undefined) {
    return (
      <header className="flex items-start justify-between gap-3">
        <div
          aria-label="Result status"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
          role="status"
        >
          <KindGlyph kind={operation.kind} />
          <StatusDot
            className="shrink-0 text-muted-foreground"
            label={operation.statusWord}
            pulse={tone === "busy"}
            tone={tone}
          />
          <OperationSubjectLine running={operation.phase === "running"} subject={subject} />
        </div>
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-muted-foreground text-xs">
          <HeaderMeta durationText={durationText} led={false} />
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
        <HeaderMeta durationText={durationText} led />
      </span>
    </header>
  );
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

/** The quiet Details disclosure — the result's full text, collapsed. */
function DetailDisclosure({ detail }: { readonly detail: string }) {
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="w-fit cursor-pointer list-none select-none text-xs hover:text-foreground [&::-webkit-details-marker]:hidden">
        Details
      </summary>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 text-[11px]">
        {detail}
      </pre>
    </details>
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
            className="block w-full shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-muted p-0 max-h-60 @[22rem]:w-[168px] @[22rem]:max-h-32 @[36rem]:w-[200px] @[36rem]:max-h-40"
            data-zerops-browser-viewport
            onClick={image !== undefined ? onOpenImage : onOpenPanel}
            style={{ aspectRatio }}
            type="button"
          />
        }
      >
        {image !== undefined ? (
          <img
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
                ? "text-destructive-foreground"
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
        {operation.detail !== undefined ? <DetailDisclosure detail={operation.detail} /> : null}
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

function isRunningPhase(operation: ZeropsOperation): boolean {
  return operation.phase === "running";
}

/**
 * The kinds whose card is a header and a result: their one step repeats what
 * the status word and the result line already say, so it is drawn only when
 * it failed.
 */
const RESULT_LINE_KINDS: ReadonlySet<ZeropsOperationKind> = new Set<ZeropsOperationKind>([
  "delete",
  "devServer",
  "env",
  "manage",
  "scale",
]);

/** The steps a card draws: all of them, except a result-line kind with nothing failed. */
function drawnSteps(
  operation: ZeropsOperation,
  steps: ReadonlyArray<ProcessStep>,
): ReadonlyArray<ProcessStep> {
  return RESULT_LINE_KINDS.has(operation.kind) && !steps.some((step) => step.state === "failed")
    ? []
    : steps;
}

/** A passed verify's chips already say every check passed; its closing is said only on a failure. */
function drawnClosing(operation: ZeropsOperation): string | undefined {
  return operation.kind === "verify" && operation.phase === "done" ? undefined : operation.closing;
}

function StepsBody({
  observed,
  operation,
  steps,
}: {
  readonly observed: ObservedRegion | undefined;
  readonly operation: ZeropsOperation;
  readonly steps: ReadonlyArray<ProcessStep>;
}) {
  const failedChecks =
    operation.kind === "verify" ? steps.filter((step) => step.state === "failed") : [];
  return (
    <>
      {steps.length === 0 ? null : PIPELINE_KINDS.has(operation.kind) ? (
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
      {observed?.log ?? null}
      {observed !== undefined && observed.provenance.length > 0 ? (
        <p className="text-muted-foreground text-xs" data-zerops-operation-provenance>
          {observed.provenance}
        </p>
      ) : null}
      {operation.explanation !== undefined ? (
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
}): JSX.Element {
  const {
    browserScreenshot,
    devServerUrl,
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
  const durationText = headerDurationText(operation, now);
  const subject = operationSubject(operation, subjectHost);
  const header = <CardHeader durationText={durationText} operation={operation} subject={subject} />;

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
  const version = versionLabel(operation.version);
  const closing = drawnClosing(operation);
  const hasResultRow = closing !== undefined || version !== undefined || links.length > 0;

  return (
    <FlatCard
      className={cn(
        "@container flex flex-col gap-2 overflow-hidden px-3.5 py-3",
        tone === "failed" && "border-[var(--zerops-status-failed)]/35",
      )}
      data-zerops-card
      data-zerops-card-kind={operation.kind}
      data-zerops-card-tone={tone}
      data-zerops-operation-key={operation.key}
    >
      {operation.kind === "browser" ? (
        <BrowserCard
          browserScreenshot={browserScreenshot}
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
          {operation.detail !== undefined ? <DetailDisclosure detail={operation.detail} /> : null}
        </>
      )}
    </FlatCard>
  );
}
