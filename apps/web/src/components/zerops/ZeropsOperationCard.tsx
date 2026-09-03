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

import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import type {
  ZeropsOperation,
  ZeropsOperationStep,
} from "@t3tools/client-runtime/zerops/operations";

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

/** " · 0:42" while running, " · 1m 12s" once settled — "" when neither timestamp resolves. */
function headerDurationSuffix(operation: ZeropsOperation, now: number): string {
  const startedAtMs = Date.parse(operation.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return "";
  }
  if (operation.phase === "running") {
    return ` · ${formatElapsedClock(Math.max(0, now - startedAtMs))}`;
  }
  if (operation.settledAt === undefined) {
    return "";
  }
  const settledAtMs = Date.parse(operation.settledAt);
  return Number.isFinite(settledAtMs)
    ? ` · ${formatStepDuration(Math.max(0, settledAtMs - startedAtMs))}`
    : "";
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

export function ZeropsOperationCard(props: {
  readonly operation: ZeropsOperation;
  readonly observed?: ObservedRegion;
  /** For tests; defaults to `Date.now()` via a 1 s tick while running. */
  readonly now?: number;
}): JSX.Element {
  const { observed, operation } = props;
  const tone = operationTone(operation);
  const isRunning = operation.phase === "running";
  useTick(props.now === undefined && isRunning);
  const now = props.now ?? Date.now();
  const durationSuffix = headerDurationSuffix(operation, now);

  const stepsForBody: ReadonlyArray<ProcessStep> = observed?.steps ?? operation.steps;
  const hasBody = stepsForBody.length > 0 || observed !== undefined;
  const hasFooter =
    operation.closing !== undefined || operation.links.length > 0 || operation.detail !== undefined;

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
          <span aria-label="Result status" className="shrink-0" role="status">
            <StatusDot
              label={`${operation.statusWord}${durationSuffix}`}
              pulse={tone === "busy"}
              tone={tone}
            />
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-medium text-foreground text-sm">
          <ZeropsMark className="size-3.5 shrink-0" />
          <span data-zerops-voice-source={operation.voiceSource}>{operation.voice}</span>
        </div>
      </header>

      {hasBody ? (
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
      ) : null}

      {hasFooter ? (
        <div className="space-y-2 border-[var(--zerops-flat-card-border)] border-t px-3 py-2.5 text-xs">
          {operation.closing !== undefined ? (
            <p className="font-medium text-foreground text-sm" data-zerops-card-outcome="true">
              {operation.closing}
            </p>
          ) : null}
          {operation.links.length > 0 ? (
            <div aria-label="URLs" className="flex flex-wrap gap-1.5">
              {operation.links.map((link) => (
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
