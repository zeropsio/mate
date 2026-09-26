/**
 * What a settled turn did, as the report its working group settles into —
 * made of the same pills the person watched run: each service it left live
 * with its link, a failure it came back from, the changes that landed, the
 * files it changed, the checks with every take in its device's shape, what it
 * created and removed, and what it could not do. It sits where the working
 * group was, under the line, before the Mate's answer.
 */
import type { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  ArrowUpRightIcon,
  FileDiffIcon,
  GitMergeIcon,
  MinusIcon,
  MonitorCheckIcon,
  MonitorXIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { browserCheckDevice } from "./BrowserStrip";
import {
  browserCheckCaption,
  browserCheckFailed,
  type OutcomeModel,
  type OutcomeService,
} from "./conversation.logic";
import { Pill } from "./ConversationPills";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

const SERVICE_DOT: Record<OutcomeService["tone"], string> = {
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  attention: "bg-status-attention",
  busy: "bg-status-busy",
};

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
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 text-xs";

function ServicePill({ service }: { readonly service: OutcomeService }) {
  const words = (
    <>
      <span className={cn("size-1.5 shrink-0 rounded-full", SERVICE_DOT[service.tone])} />
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
        <span className="shrink-0 font-mono text-muted-foreground">{service.version}</span>
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

function Takes({
  takes,
  onOpenImage,
}: {
  readonly takes: ReadonlyArray<ZeropsOperation>;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const shots = takes.flatMap((take) =>
    take.screenshot
      ? [{ key: take.key, src: take.screenshot.src, name: browserCheckCaption(take) }]
      : [],
  );
  if (shots.length === 0) return null;
  return (
    <div
      className="flex min-w-0 items-end gap-2 overflow-x-auto pb-0.5 scrollbar-none"
      data-report-takes
    >
      {takes.map((take) => {
        if (!take.screenshot) return null;
        const failed = browserCheckFailed(take);
        const device = browserCheckDevice(take);
        const index = shots.findIndex((shot) => shot.key === take.key);
        return (
          <button
            key={take.key}
            aria-label={`${browserCheckCaption(take)}${take.deviceName ? ` on ${take.deviceName}` : ""}${failed ? ", failed" : ""}. Open the screenshot`}
            className={cn(
              "h-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-card shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
              TAKE_CLASS[device],
              failed ? "border-status-failed ring-1 ring-status-failed" : "border-border",
            )}
            data-report-take={device}
            onClick={() =>
              onOpenImage({ images: shots.map(({ src, name }) => ({ src, name })), index })
            }
            type="button"
          >
            <img
              alt=""
              className="block size-full object-cover object-top"
              src={take.screenshot.src}
            />
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
}: {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
}) {
  const checks = outcome.checks;
  return (
    <section aria-label="What this turn did" className="grid gap-2" data-turn-report>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {outcome.live.map((service) => (
          <ServicePill key={service.hostname} service={service} />
        ))}
        {outcome.live.flatMap((service) =>
          service.recovered
            ? [
                <Pill
                  key={`${service.hostname}:recovered`}
                  label={`${service.hostname}: ${service.recovered}`}
                  tone="attention"
                >
                  <RotateCcwIcon aria-hidden="true" className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{service.recovered}</span>
                </Pill>,
              ]
            : [],
        )}
        {outcome.landed.map((change) => (
          <Pill key={change.key} label={`${change.line} landed: ${change.title}`}>
            <GitMergeIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok" />
            <span className="shrink-0 font-medium text-foreground">{change.line}</span>
            <span className="min-w-0 max-w-80 truncate text-muted-foreground">{change.title}</span>
          </Pill>
        ))}
        {outcome.files !== null ? (
          <Pill
            label={`${outcome.files.count} files changed. Review the diff`}
            onClick={() => onOpenTurnDiff(outcome.files!.turnId)}
          >
            <FileDiffIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-foreground">
              {outcome.files.count === 1 ? "1 file" : `${outcome.files.count} files`}
            </span>
            <span className="shrink-0 text-diff-addition-foreground tabular-nums">
              +{compactCount(outcome.files.additions)}
            </span>
            <span className="shrink-0 text-diff-deletion-foreground tabular-nums">
              −{compactCount(outcome.files.deletions)}
            </span>
            <span className="shrink-0 text-info-foreground">Review</span>
          </Pill>
        ) : null}
        {checks !== null ? (
          <Pill
            label={`${checks.count} checks of ${checks.views} pages, ${checks.failures > 0 ? `${checks.failures} failed` : "all passed"}`}
            tone={checks.failures > 0 ? "failed" : "plain"}
          >
            {checks.failures > 0 ? (
              <MonitorXIcon aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <MonitorCheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok" />
            )}
            <span className={cn("shrink-0", checks.failures > 0 ? null : "text-foreground")}>
              {checks.views === 1 ? "1 page" : `${checks.views} pages`}
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                checks.failures > 0 ? null : "text-muted-foreground",
              )}
            >
              · {checks.count === 1 ? "1 check" : `${checks.count} checks`} ·{" "}
              {checks.failures > 0
                ? checks.failures === 1
                  ? "1 failed"
                  : `${checks.failures} failed`
                : "all passed"}
            </span>
          </Pill>
        ) : null}
        {outcome.created.map((name) => (
          <Pill key={`created:${name}`} label={`Created ${name}`}>
            <PlusIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok" />
            <span className="min-w-0 truncate text-foreground">{name}</span>
          </Pill>
        ))}
        {outcome.removed.map((name) => (
          <Pill key={`removed:${name}`} label={`Removed ${name}`}>
            <MinusIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-muted-foreground">{name}</span>
          </Pill>
        ))}
        {outcome.notDone.map((line) => (
          <Pill key={`not-done:${line}`} label={`Not done: ${line}`} tone="failed">
            <XIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{line}</span>
          </Pill>
        ))}
      </div>
      {checks !== null ? <Takes onOpenImage={onOpenImage} takes={checks.takes} /> : null}
    </section>
  );
}
