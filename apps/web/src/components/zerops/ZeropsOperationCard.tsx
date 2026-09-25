import { ServiceBrowserLink } from "../ServiceBrowserLink";
/**
 * The Operations-layer card: one shell for every `ZeropsOperation` kind
 * (bootstrap · deploy · import · mount · verify · subdomain · delete · scale
 * · manage · env · devServer · browser · logs · events · process · discover
 * · error). Presentational, props only (R2) — the reducer
 * already produced every people-facing word this renders.
 *
 * A card is born with its kind's final structure and only fills in: a card
 * that names one service or page (`operationSubject`) heads with the status
 * word as its verb and the subject line under it, held by a placeholder
 * until the input names the target; a browser check reserves its frame; a
 * deploy's five pipeline slots arrive with the observed region.
 *
 * See `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §5.
 */
import type { JSX, ReactNode } from "react";
import { GlobeIcon } from "lucide-react";

import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import {
  browserLiveCaption,
  type ZeropsOperation,
  type ZeropsOperationStep,
} from "@t3tools/client-runtime/zerops/model";

import { useRightPanelStore } from "../../rightPanelStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { ZeropsMark } from "../ZeropsMark";
import { OperationSubjectLine } from "./operation/OperationSubjectLine";
import { operationSubject } from "./operation/subject";
import {
  FlatCard,
  formatStepDuration,
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
  /** e.g. "live from Zerops · 2 s ago"; empty before the first read and on a settled card. */
  readonly provenance: string;
  /** The build log region, when the caller has one. */
  readonly log?: ReactNode;
}

/** running -> busy, done -> ok, failed -> failed; uncertain, or a done operation with any failed step -> attention. */
function operationTone(operation: ZeropsOperation): ServiceStatusToneId {
  if (operation.phase === "running") {
    return "busy";
  }
  if (operation.phase === "failed") {
    return "failed";
  }
  if (operation.phase === "uncertain") {
    return "attention";
  }
  return operation.steps.some((step) => step.state === "failed") ? "attention" : "ok";
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

/** The attempt count and the clock after the status word — each led by a middle dot unless it opens the cluster. */
function HeaderMeta({
  attemptWord,
  durationText,
  led,
}: {
  readonly attemptWord: string | undefined;
  readonly durationText: string | undefined;
  readonly led: boolean;
}) {
  const durationLed = led || attemptWord !== undefined;
  return (
    <>
      {attemptWord !== undefined ? (
        <span data-zerops-operation-attempt>
          {led ? "· " : ""}
          {attemptWord}
        </span>
      ) : null}
      {durationText !== undefined ? (
        <span className="tabular-nums" data-zerops-operation-duration>
          {durationLed ? "· " : ""}
          {durationText}
        </span>
      ) : null}
    </>
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
 * set when the result names one, else agent-browser's default 16:9. Never the
 * image's own size — a frame or a full-page screenshot fits inside it
 * instead of reshaping the card.
 */
function browserFrameAspectRatio(operation: ZeropsOperation): string {
  const viewport = operation.browserSummary?.viewport;
  return viewport === undefined ? "16 / 9" : `${viewport.width} / ${viewport.height}`;
}

function BrowserViewport({
  aspectRatio,
  image,
  live,
  onOpen,
  subject,
}: {
  readonly aspectRatio: string;
  readonly image: BrowserScreenshot | LiveBrowserFrame | undefined;
  readonly live: boolean;
  readonly onOpen: () => void;
  readonly subject: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Open the Browser panel"
            className="block w-full cursor-pointer overflow-hidden rounded-md border border-[var(--zerops-flat-card-border)] bg-muted p-0"
            data-zerops-browser-viewport
            onClick={onOpen}
            style={{ maxHeight: 360, aspectRatio }}
            type="button"
          />
        }
      >
        {image !== undefined ? (
          <img
            alt={live ? `Live view of ${subject}` : "Screenshot"}
            className="block h-full max-h-[360px] w-full bg-background/40 object-contain"
            data-zerops-browser-image
            src={image.src}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">Open the Browser panel</TooltipPopup>
    </Tooltip>
  );
}

function BrowserBody({
  live,
  liveFrame,
  browserScreenshot,
  onOpenPanel,
  operation,
}: {
  readonly live: boolean;
  readonly liveFrame: LiveBrowserFrame | undefined;
  readonly browserScreenshot: BrowserScreenshot | undefined;
  readonly onOpenPanel: () => void;
  readonly operation: ZeropsOperation;
}) {
  const image = browserViewportImage(live, browserScreenshot, liveFrame);
  const summary = operation.browserSummary;
  const visibleSteps = visibleBrowserSteps(operation);

  return (
    <div className="space-y-2 px-3 pt-1 pb-2.5 text-xs leading-relaxed" data-zerops-browser-body>
      <BrowserViewport
        aspectRatio={browserFrameAspectRatio(operation)}
        image={image}
        live={live}
        onOpen={onOpenPanel}
        subject={operation.subject}
      />
      {operation.phase === "running" ? (
        <p className="text-muted-foreground text-xs" data-zerops-browser-live-caption>
          {browserLiveCaption(operation.subject)}
        </p>
      ) : null}
      {summary !== undefined ? (
        <p className="text-muted-foreground text-xs" data-zerops-browser-summary>
          {summary.line}
        </p>
      ) : null}
      {summary?.failedStep !== undefined ? (
        <ProcessSteps aria-label="Failed step" density="compact" steps={[summary.failedStep]} />
      ) : null}
      {visibleSteps.length > 0 ? (
        <details data-zerops-browser-steps-expander>
          <summary className="cursor-pointer select-none text-muted-foreground text-xs">
            Show steps
          </summary>
          <div className="mt-2">
            <ProcessSteps
              aria-label={`${operation.kicker} steps`}
              density="compact"
              steps={visibleSteps}
            />
          </div>
        </details>
      ) : null}
    </div>
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
  /** Opens the right-panel Browser surface — absent thread, absent click target. */
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
  const isRunning = operation.phase === "running";
  const tickNow = useSecondsNowMs(props.now === undefined && isRunning);
  const now = props.now ?? tickNow;
  const durationText = headerDurationText(operation, now);
  const isBrowser = operation.kind === "browser";
  const subject = operationSubject(operation, subjectHost);

  const stepsForBody: ReadonlyArray<ProcessStep> = observed?.steps ?? operation.steps;
  const hasBody =
    isBrowser ||
    operation.readResult !== undefined ||
    stepsForBody.length > 0 ||
    observed !== undefined;

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
  const hasFooter =
    operation.closing !== undefined || links.length > 0 || operation.detail !== undefined;

  return (
    <FlatCard
      className={cn(
        "overflow-hidden",
        tone === "failed" && "border-[var(--zerops-status-failed)]/35",
      )}
      data-zerops-card
      data-zerops-card-kind={operation.kind}
      data-zerops-card-tone={tone}
      data-zerops-operation-key={operation.key}
    >
      {subject !== undefined ? (
        <header className="px-3 pt-2.5 pb-1.5">
          <div
            aria-label="Result status"
            className="flex items-center justify-between gap-3"
            role="status"
          >
            <div className="flex min-w-0 items-center gap-1.5 text-foreground">
              <ZeropsMark className="size-3.5 shrink-0" />
              <StatusDot label={operation.statusWord} pulse={tone === "busy"} tone={tone} />
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
              <HeaderMeta
                attemptWord={operation.attemptWord}
                durationText={durationText}
                led={false}
              />
            </span>
          </div>
          <OperationSubjectLine running={isRunning} subject={subject} />
        </header>
      ) : (
        <header className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-1.5">
          <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground text-sm">
            <ZeropsMark className="size-3.5 shrink-0" />
            <span data-zerops-voice-source={operation.voiceSource}>{operation.voice}</span>
          </div>
          <span
            aria-label="Result status"
            className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs"
            role="status"
          >
            <StatusDot label={operation.statusWord} pulse={tone === "busy"} sentence tone={tone} />
            <HeaderMeta attemptWord={operation.attemptWord} durationText={durationText} led />
          </span>
        </header>
      )}

      {hasBody ? (
        isBrowser ? (
          <BrowserBody
            browserScreenshot={browserScreenshot}
            live={live}
            liveFrame={liveFrame}
            onOpenPanel={openBrowserPanel}
            operation={operation}
          />
        ) : operation.readResult !== undefined ? (
          <ZeropsReadResultBody readResult={operation.readResult} steps={operation.steps} />
        ) : (
          <div className="space-y-2 px-3 pt-1 pb-2.5 text-xs leading-relaxed">
            {stepsForBody.length > 0 ? (
              <ProcessSteps
                aria-label={`${operation.kicker} progress`}
                density="compact"
                steps={stepsForBody}
              />
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
          </div>
        )
      ) : null}

      {hasFooter ? (
        <div className="space-y-2 px-3 pt-0.5 pb-2.5 text-xs">
          {operation.closing !== undefined ? (
            <p className="text-[13px] text-muted-foreground" data-zerops-card-outcome="true">
              {operation.closing}
            </p>
          ) : null}
          {links.length > 0 ? (
            <div aria-label="URLs" className="flex flex-wrap gap-1.5">
              {links.map((link) => (
                <UrlChip key={link.url} label={link.label} url={link.url} />
              ))}
            </div>
          ) : null}
          {operation.detail !== undefined ? (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer select-none text-xs">Details</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-[11px]">
                {operation.detail}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </FlatCard>
  );
}
