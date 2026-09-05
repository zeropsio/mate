/**
 * The Operations-layer card: one shell for every `ZeropsOperation` kind
 * (bootstrap · deploy · import · mount · verify · subdomain · delete · scale
 * · manage · env · error). Presentational, props only (R2) — the reducer
 * already produced every people-facing word this renders.
 *
 * See `../../../../../../zcp/plans/mate-chat-output-concept-2026-09-03.md` §5.
 */
import { useEffect, useReducer, type JSX, type ReactNode } from "react";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";

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
import {
  FlatCard,
  formatStepDuration,
  MicroLabel,
  ProcessSteps,
  StatusDot,
  type ProcessStep,
} from "./primitives";
import { cn } from "~/lib/utils";

export interface ObservedRegion {
  /** Replaces `operation.steps` for the body while an observation is attached. */
  readonly steps: ReadonlyArray<ZeropsOperationStep & { readonly durationMs?: number }>;
  /** e.g. "live from Zerops · 2 s ago". */
  readonly provenance: string;
  /** The build log region, when the caller has one. */
  readonly log?: ReactNode;
}

const HEADER_TONE_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "bg-[var(--zerops-status-ok-surface)]",
  busy: "bg-[var(--zerops-status-busy-surface)]",
  attention: "bg-[var(--zerops-status-attention-surface)]",
  failed: "bg-[var(--zerops-status-failed-surface)]",
  off: "bg-[var(--zerops-status-off-surface)]",
};

/** running -> busy, done -> ok, failed -> failed; a done operation with any failed step -> attention. */
function operationTone(operation: ZeropsOperation): ServiceStatusToneId {
  if (operation.phase === "running") {
    return "busy";
  }
  if (operation.phase === "failed") {
    return "failed";
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

/** Re-renders once a second while `active` — a text update, never an animation (R6). */
function useTick(active: boolean): void {
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(forceRender, 1_000);
    return () => clearInterval(id);
  }, [active]);
}

function UrlChip({ label, url }: { readonly label: string; readonly url: string }) {
  return (
    <a
      aria-label={`Open ${url}`}
      className="inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 font-medium text-info-foreground text-xs hover:underline"
      data-zerops-chip-kind="url"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <GlobeIcon aria-hidden="true" className="size-3 text-success-foreground" />
      <span>{label}</span>
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
    </a>
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

function BrowserViewport({
  image,
  live,
  onOpen,
  subject,
}: {
  readonly image: BrowserScreenshot | LiveBrowserFrame;
  readonly live: boolean;
  readonly onOpen: () => void;
  readonly subject: string;
}) {
  const aspectRatio =
    image.width !== undefined && image.height !== undefined
      ? `${image.width} / ${image.height}`
      : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="Open the Browser panel"
            className="block w-full cursor-pointer overflow-hidden rounded-md border border-[var(--zerops-flat-card-border)] bg-background/40 p-0"
            data-zerops-browser-viewport
            onClick={onOpen}
            style={{ maxHeight: 360, ...(aspectRatio !== undefined ? { aspectRatio } : {}) }}
            type="button"
          />
        }
      >
        <img
          alt={live ? `Live view of ${subject}` : "Screenshot"}
          className="block h-full max-h-[360px] w-full object-contain"
          data-zerops-browser-image
          src={image.src}
        />
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
    <div className="space-y-2 px-3 py-3 text-xs leading-relaxed" data-zerops-browser-body>
      {image !== undefined ? (
        <BrowserViewport
          image={image}
          live={live}
          onOpen={onOpenPanel}
          subject={operation.subject}
        />
      ) : null}
      {live ? (
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
        <ProcessSteps aria-label="Failed step" steps={[summary.failedStep]} />
      ) : null}
      {visibleSteps.length > 0 ? (
        <details data-zerops-browser-steps-expander>
          <summary className="cursor-pointer select-none text-[11px] text-muted-foreground uppercase tracking-wide">
            Show steps
          </summary>
          <div className="mt-2">
            <ProcessSteps aria-label={`${operation.kicker} steps`} steps={visibleSteps} />
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
  /** Opens the right-panel Browser surface — absent thread, absent click target. */
  readonly threadRef?: ScopedThreadRef | null;
  /** For tests; defaults to `Date.now()` via a 1 s tick while running. */
  readonly now?: number;
}): JSX.Element {
  const {
    browserScreenshot,
    devServerUrl,
    live = false,
    liveFrame,
    observed,
    operation,
    threadRef,
  } = props;
  const tone = operationTone(operation);
  const isRunning = operation.phase === "running";
  useTick(props.now === undefined && isRunning);
  const now = props.now ?? Date.now();
  const durationText = headerDurationText(operation, now);
  const isBrowser = operation.kind === "browser";

  const stepsForBody: ReadonlyArray<ProcessStep> = observed?.steps ?? operation.steps;
  const browserImage = isBrowser
    ? browserViewportImage(live, browserScreenshot, liveFrame)
    : undefined;
  const hasBody = isBrowser
    ? browserImage !== undefined || operation.browserSummary !== undefined || live
    : stepsForBody.length > 0 || observed !== undefined;

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
      className="overflow-hidden"
      data-zerops-card
      data-zerops-card-kind={operation.kind}
      data-zerops-card-tone={tone}
      data-zerops-operation-key={operation.key}
    >
      <header className={cn(HEADER_TONE_CLASS[tone], "px-3 py-2.5")}>
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>{operation.kicker}</MicroLabel>
          <span
            aria-label="Result status"
            className="flex shrink-0 items-center gap-1.5"
            role="status"
          >
            <StatusDot label={operation.statusWord} pulse={tone === "busy"} tone={tone} />
            {operation.attemptWord !== undefined ? (
              <span className="text-[11px] text-muted-foreground" data-zerops-operation-attempt>
                {operation.attemptWord}
              </span>
            ) : null}
            {durationText !== undefined ? (
              <span
                className="font-mono text-[11px] text-muted-foreground tabular-nums"
                data-zerops-operation-duration
              >
                · {durationText}
              </span>
            ) : null}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-medium text-foreground text-sm">
          <ZeropsMark className="size-3.5 shrink-0" />
          <span data-zerops-voice-source={operation.voiceSource}>{operation.voice}</span>
        </div>
      </header>

      {hasBody ? (
        isBrowser ? (
          <BrowserBody
            browserScreenshot={browserScreenshot}
            live={live}
            liveFrame={liveFrame}
            onOpenPanel={openBrowserPanel}
            operation={operation}
          />
        ) : (
          <div className="space-y-3 px-3 py-3 text-xs leading-relaxed">
            {stepsForBody.length > 0 ? (
              <ProcessSteps aria-label={`${operation.kicker} progress`} steps={stepsForBody} />
            ) : null}
            {observed?.log ?? null}
            {observed !== undefined ? (
              <p className="text-muted-foreground text-xs" data-zerops-operation-provenance>
                {observed.provenance}
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {hasFooter ? (
        <div className="space-y-2 border-[var(--zerops-flat-card-border)] border-t px-3 py-2.5 text-xs">
          {operation.closing !== undefined ? (
            <p className="font-medium text-foreground text-sm" data-zerops-card-outcome="true">
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
              <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wide">
                Details
              </summary>
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
