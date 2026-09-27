/**
 * What a settled run did, as its result — made of the same parts the person
 * watched run: each service it left live with its link, a failure it came
 * back from, the changes that landed, the files it changed, the checks, what
 * it created and removed, what it could not do, and what its calls came to
 * ("Edited 7 files", "Ran 5 commands", "Started 11 helpers" — the owner,
 * 2026-09-27: "why isn't [that line] in the 'result' style?"). Pills at the
 * bottom of the run's card, under its chat and before the answer.
 *
 * A pill leads with a dot only where it has a state to say — deployed,
 * failed, all passed; a count needs none. One with more behind it opens it:
 * the diff, the app, or — in place, under the pills — the calls it counts as
 * the chat's own bubbles, and the pictures the checks took.
 */
import type { TurnId } from "@t3tools/contracts";
import { ArrowUpRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { BrowserTakes } from "./BrowserStrip";
import type { OutcomeActivity, OutcomeModel, OutcomeService } from "./conversation.logic";
import { Pill } from "./ConversationPills";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import { HelpersBubble, StepBubble } from "./RunChat";
import { stepOf } from "./workSteps.logic";

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

/** What an activity pill counts, opened under the pills: each call as the chat's bubble. */
function ActivityCalls({ activity }: { readonly activity: OutcomeActivity }) {
  return (
    <ul className="grid min-w-0 gap-1">
      {activity.entries.map((entry) => (
        <li key={entry.id} className="flex min-w-0">
          {activity.kind === "helpers" ? (
            <HelpersBubble entry={entry} />
          ) : (
            <StepBubble step={stepOf(entry, undefined, false)} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function TurnReport({
  outcome,
  onOpenTurnDiff,
  onOpenImage,
  settling = false,
}: {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** The person watched the turn run: the result arrives as what ran alongside settles. */
  readonly settling?: boolean;
}) {
  const checks = outcome.checks;
  // One pill open at a time: what it holds stands under the pills.
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));
  const openActivity = outcome.activity.find((activity) => `activity:${activity.words}` === open);
  const hasTakes = checks !== null && checks.takes.some((take) => take.screenshot);
  return (
    <section
      aria-label="What this run did"
      className={cn(
        "grid max-w-full gap-2 pt-1 pb-1",
        open === null ? "w-fit" : "w-full",
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
            expanded={hasTakes ? open === "checks" : undefined}
            label={`${checks.count} checks of ${checks.views} pages, ${checks.failures > 0 ? `${checks.failures} failed` : "all passed"}${hasTakes ? ". Show the pictures" : ""}`}
            onClick={hasTakes ? () => toggle("checks") : null}
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
        {outcome.activity.map((activity) => {
          const key = `activity:${activity.words}`;
          return (
            <Pill
              key={key}
              expanded={open === key}
              label={`${activity.words}. ${open === key ? "Hide" : "Show"} them`}
              onClick={() => toggle(key)}
            >
              <span className="ms-1.5 min-w-0 truncate text-foreground">{activity.words}</span>
            </Pill>
          );
        })}
      </div>
      {open === "checks" && checks !== null ? (
        <div className="min-w-0" data-report-detail>
          <BrowserTakes onOpenImage={onOpenImage} takes={checks.takes} />
        </div>
      ) : null}
      {openActivity !== undefined ? (
        <div className="max-h-110 min-w-0 overflow-y-auto overscroll-contain" data-report-detail>
          <ActivityCalls activity={openActivity} />
        </div>
      ) : null}
    </section>
  );
}
