/**
 * What a settled run did, as its result — made of the same parts the person
 * watched run: each service it left live with its link, a failure it came
 * back from, the changes that landed, the files it changed, the checks with
 * every take in its device's shape, what it created and removed, what it
 * could not do, and what its calls came to ("Edited 7 files", "Ran 5
 * commands", "Started 11 helpers" — the owner, 2026-09-27: "why isn't
 * [that line] in the 'result' style?"). Pills on the run's card, under its
 * record and before the answer.
 *
 * A pill leads with a dot only where it has a state to say — deployed,
 * failed, all passed; a count needs none. Each one with more behind it opens
 * it: the diff, the app, a modal listing what it counts.
 */
import type { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { ArrowUpRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { browserCheckDevice, TAKE_ASPECT } from "./BrowserStrip";
import {
  browserCheckCaption,
  browserTakeState,
  type OutcomeActivity,
  type OutcomeModel,
  type OutcomeService,
} from "./conversation.logic";
import { Pill } from "./ConversationPills";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { useTakeThumbnail } from "./takeThumbnail";

type DotTone = "ok" | "failed" | "attention" | "busy" | "idle";

const DOT_TONE: Record<DotTone, string> = {
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  attention: "bg-status-attention",
  busy: "bg-status-busy",
  idle: "bg-muted-foreground/40",
};

/** A pill's state, where it has one: a dot in its tone, the pill's first thing. */
function Dot({ tone }: { readonly tone: DotTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn("ms-1.5 size-1.5 shrink-0 rounded-full", DOT_TONE[tone])}
    />
  );
}

/** A take in the report, in the shape of the device it was taken on. */
const TAKE_CLASS = {
  desktop: "w-32",
  tablet: "w-15",
  phone: "w-9",
} as const;

function compactCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

const SERVICE_PILL_CLASS =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-card pe-2.5 text-line";

const SERVICE_DOT: Record<OutcomeService["tone"], DotTone> = {
  ok: "ok",
  failed: "failed",
  attention: "attention",
  busy: "busy",
};

function ServicePill({ service }: { readonly service: OutcomeService }) {
  const words = (
    <>
      <Dot tone={SERVICE_DOT[service.tone]} />
      <span className="shrink-0 font-medium text-foreground">{service.hostname}</span>
      <span
        className={cn(
          "min-w-0 truncate",
          service.tone === "failed" ? "text-status-failed-text" : "text-muted-foreground",
        )}
      >
        {service.word}
      </span>
      {service.version ? (
        <span className="shrink-0 font-mono text-muted-foreground text-xs">{service.version}</span>
      ) : null}
    </>
  );
  if (!service.url) {
    return (
      <span className={SERVICE_PILL_CLASS} data-pill="plain">
        {words}
      </span>
    );
  }
  return (
    <ServiceBrowserLink
      aria-label={`${service.hostname} ${service.word}. Open ${service.url}`}
      className={cn(
        SERVICE_PILL_CLASS,
        "cursor-pointer transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      )}
      href={service.url}
      rel="noreferrer"
      showIndicator={false}
      target="_blank"
    >
      {words}
      <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
    </ServiceBrowserLink>
  );
}

/** A take's picture, its content cropped in when the page is mostly empty. */
function TakeThumbnail({ src, aspect }: { readonly src: string; readonly aspect: number }) {
  const thumbnail = useTakeThumbnail(src, aspect);
  return <img alt="" className="block size-full object-cover object-top" src={thumbnail} />;
}

function Takes({
  takes,
  onOpenImage,
}: {
  readonly takes: ReadonlyArray<ZeropsOperation>;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  // A structure check has no picture: the report's pill counts it.
  const shots = takes.flatMap((take) =>
    take.screenshot
      ? [{ key: take.key, src: take.screenshot.src, name: browserCheckCaption(take) }]
      : [],
  );
  if (shots.length === 0) return null;
  return (
    // The first take on the text edge: the room its scroller keeps for a
    // take's ring and the focus ring hangs outside it.
    <div
      className="-m-1 flex min-w-0 items-end gap-2 overflow-x-auto p-1 scrollbar-none"
      data-report-takes
    >
      {takes.map((take) => {
        const src = take.screenshot?.src;
        if (src === undefined) return null;
        const state = browserTakeState(take, takes);
        const device = browserCheckDevice(take);
        const index = shots.findIndex((shot) => shot.key === take.key);
        return (
          <button
            key={take.key}
            aria-label={`${browserCheckCaption(take)}${take.deviceName ? ` on ${take.deviceName}` : ""}${state === "failed" ? ", failed" : state === "retried" ? ", retried" : ""}. Open the screenshot`}
            className={cn(
              "h-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              TAKE_CLASS[device],
              state === "failed"
                ? "border-status-failed ring-1 ring-status-failed"
                : state === "retried"
                  ? "border-status-attention"
                  : "border-border",
            )}
            data-report-take={device}
            onClick={() =>
              onOpenImage({ images: shots.map(({ src, name }) => ({ src, name })), index })
            }
            type="button"
          >
            <TakeThumbnail aspect={TAKE_ASPECT[device]} src={src} />
          </button>
        );
      })}
    </div>
  );
}

export function TurnReport({
  outcome,
  onOpenTurnDiff,
  onOpenImage,
  onOpenActivity,
  settling = false,
}: {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** Opens what an activity pill counts. */
  readonly onOpenActivity: (activity: OutcomeActivity) => void;
  /** The person watched the turn run: the result arrives as what ran alongside settles. */
  readonly settling?: boolean;
}) {
  const checks = outcome.checks;
  return (
    <section
      aria-label="What this run did"
      className={cn(
        "grid w-fit max-w-full gap-2 pt-1 pb-1",
        settling && "origin-top-left animate-report-in motion-reduce:animate-none",
      )}
      data-turn-report
    >
      <div className="flex min-w-0 flex-wrap gap-1.5" data-report-pills>
        {outcome.live.map((service) => (
          <ServicePill key={service.hostname} service={service} />
        ))}
        {outcome.live.flatMap((service) =>
          service.recovered
            ? [
                <Pill
                  key={`${service.hostname}:recovered`}
                  label={`${service.hostname}: ${service.recovered}`}
                >
                  <Dot tone="attention" />
                  <span className="min-w-0 truncate text-status-attention-text">
                    {service.recovered}
                  </span>
                </Pill>,
              ]
            : [],
        )}
        {outcome.landed.map((change) => (
          <Pill key={change.key} label={`${change.line} landed: ${change.title}`}>
            <Dot tone="ok" />
            <span className="shrink-0 font-medium text-foreground">{change.line}</span>
            <span className="min-w-0 max-w-80 truncate text-muted-foreground">{change.title}</span>
          </Pill>
        ))}
        {outcome.files !== null ? (
          <Pill
            label={`${outcome.files.count} files changed. Review the diff`}
            onClick={() => onOpenTurnDiff(outcome.files!.turnId)}
          >
            <span className="ms-1.5 shrink-0 text-foreground">
              {outcome.files.count === 1 ? "1 file" : `${outcome.files.count} files`}
            </span>
            <span className="shrink-0 text-diff-addition-foreground tabular-nums">
              +{compactCount(outcome.files.additions)}
            </span>
            <span className="shrink-0 text-diff-deletion-foreground tabular-nums">
              −{compactCount(outcome.files.deletions)}
            </span>
            {/* A text action in the conversation's link ink, as its markdown links are. */}
            <span className="shrink-0 text-info-foreground">Review</span>
          </Pill>
        ) : null}
        {checks !== null ? (
          <Pill
            label={`${checks.count} checks of ${checks.views} pages, ${checks.failures > 0 ? `${checks.failures} failed` : "all passed"}`}
          >
            <Dot tone={checks.failures > 0 ? "failed" : "ok"} />
            <span className="shrink-0 text-foreground">
              {checks.views === 1 ? "1 page" : `${checks.views} pages`}
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                checks.failures > 0 ? "text-status-failed-text" : "text-muted-foreground",
              )}
            >
              {checks.failures > 0
                ? checks.failures === 1
                  ? "1 check failed"
                  : `${checks.failures} checks failed`
                : checks.count === 1
                  ? "checked"
                  : `${checks.count} checks passed`}
            </span>
          </Pill>
        ) : null}
        {outcome.created.map((name) => (
          <Pill key={`created:${name}`} label={`Created ${name}`}>
            <Dot tone="ok" />
            <span className="text-muted-foreground">Created</span>
            <span className="min-w-0 truncate text-foreground">{name}</span>
          </Pill>
        ))}
        {outcome.removed.map((name) => (
          <Pill key={`removed:${name}`} label={`Removed ${name}`}>
            <Dot tone="idle" />
            <span className="text-muted-foreground">Removed</span>
            <span className="min-w-0 truncate text-foreground">{name}</span>
          </Pill>
        ))}
        {outcome.notDone.map((line) => (
          <Pill key={`not-done:${line}`} label={`Not done: ${line}`}>
            <Dot tone="failed" />
            <span className="min-w-0 truncate text-status-failed-text">{line}</span>
          </Pill>
        ))}
        {outcome.activity.map((activity) => (
          <Pill
            key={`activity:${activity.words}`}
            label={`${activity.words}. Show them`}
            onClick={() => onOpenActivity(activity)}
          >
            <span className="ms-1.5 min-w-0 truncate text-foreground">{activity.words}</span>
          </Pill>
        ))}
      </div>
      {checks !== null ? <Takes onOpenImage={onOpenImage} takes={checks.takes} /> : null}
    </section>
  );
}
