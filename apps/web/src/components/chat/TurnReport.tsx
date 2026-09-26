/**
 * What a settled turn did, as the report its panel settles into — made of
 * the same parts the person watched run: each thing leads with the disc its
 * status bar wore, now in the tone it ended in. Each service it left live
 * with its link, a failure it came back from, the changes that landed, the
 * files it changed, the checks with every take in its device's shape, what
 * it created and removed, and what it could not do — pills on one small tray
 * that hugs them, where the panel was, under the line and before the answer.
 */
import type { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleAlertIcon,
  FileDiffIcon,
  GitMergeIcon,
  MinusIcon,
  MonitorCheckIcon,
  MonitorXIcon,
  PlusIcon,
  RocketIcon,
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
import { checkPicture } from "./keptFrames";
import { Pill, StatusDisc, type DiscTone } from "./ConversationPills";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

const SERVICE_DISC: Record<OutcomeService["tone"], DiscTone> = {
  ok: "ok",
  failed: "failed",
  attention: "attention",
  busy: "busy",
};

const SERVICE_ICON: Record<OutcomeService["tone"], typeof CheckIcon> = {
  ok: CheckIcon,
  failed: XIcon,
  attention: CircleAlertIcon,
  busy: RocketIcon,
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
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-card ps-1 pe-2.5 text-xs";

function ServicePill({ service }: { readonly service: OutcomeService }) {
  const Icon = SERVICE_ICON[service.tone];
  const words = (
    <>
      <StatusDisc size="sm" tone={SERVICE_DISC[service.tone]}>
        <Icon aria-hidden="true" className="size-3" />
      </StatusDisc>
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
  const shots = takes.flatMap((take) => {
    const src = checkPicture(take);
    return src === undefined ? [] : [{ key: take.key, src, name: browserCheckCaption(take) }];
  });
  if (shots.length === 0) return null;
  return (
    <div
      className="flex min-w-0 items-end gap-2 overflow-x-auto px-1 pb-0.5 scrollbar-none"
      data-report-takes
    >
      {takes.map((take) => {
        const src = checkPicture(take);
        if (src === undefined) return null;
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
            <img alt="" className="block size-full object-cover object-top" src={src} />
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
  settling = false,
}: {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
  readonly onOpenImage: (preview: ExpandedImagePreview) => void;
  /** The person watched the turn run: the report arrives as its panel settles. */
  readonly settling?: boolean;
}) {
  const checks = outcome.checks;
  return (
    <section
      aria-label="What this turn did"
      // The stretch's card is the report's tray: its pills and takes sit on it.
      className={cn(
        "grid w-fit max-w-full gap-2 pb-1",
        settling && "origin-top-left animate-report-in motion-reduce:animate-none",
      )}
      data-turn-report
    >
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
                >
                  <StatusDisc size="sm" tone="attention">
                    <RotateCcwIcon aria-hidden="true" className="size-3" />
                  </StatusDisc>
                  <span className="min-w-0 truncate text-status-attention-text">
                    {service.recovered}
                  </span>
                </Pill>,
              ]
            : [],
        )}
        {outcome.landed.map((change) => (
          <Pill key={change.key} label={`${change.line} landed: ${change.title}`}>
            <StatusDisc size="sm" tone="ok">
              <GitMergeIcon aria-hidden="true" className="size-3" />
            </StatusDisc>
            <span className="shrink-0 font-medium text-foreground">{change.line}</span>
            <span className="min-w-0 max-w-80 truncate text-muted-foreground">{change.title}</span>
          </Pill>
        ))}
        {outcome.files !== null ? (
          <Pill
            label={`${outcome.files.count} files changed. Review the diff`}
            onClick={() => onOpenTurnDiff(outcome.files!.turnId)}
          >
            <StatusDisc size="sm" tone="idle">
              <FileDiffIcon aria-hidden="true" className="size-3" />
            </StatusDisc>
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
          >
            <StatusDisc size="sm" tone={checks.failures > 0 ? "failed" : "ok"}>
              {checks.failures > 0 ? (
                <MonitorXIcon aria-hidden="true" className="size-3" />
              ) : (
                <MonitorCheckIcon aria-hidden="true" className="size-3" />
              )}
            </StatusDisc>
            <span className="shrink-0 text-foreground">
              {checks.views === 1 ? "1 page" : `${checks.views} pages`}
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                checks.failures > 0 ? "text-status-failed-text" : "text-muted-foreground",
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
            <StatusDisc size="sm" tone="ok">
              <PlusIcon aria-hidden="true" className="size-3" />
            </StatusDisc>
            <span className="min-w-0 truncate text-foreground">{name}</span>
          </Pill>
        ))}
        {outcome.removed.map((name) => (
          <Pill key={`removed:${name}`} label={`Removed ${name}`}>
            <StatusDisc size="sm" tone="idle">
              <MinusIcon aria-hidden="true" className="size-3" />
            </StatusDisc>
            <span className="min-w-0 truncate text-muted-foreground">{name}</span>
          </Pill>
        ))}
        {outcome.notDone.map((line) => (
          <Pill key={`not-done:${line}`} label={`Not done: ${line}`}>
            <StatusDisc size="sm" tone="failed">
              <XIcon aria-hidden="true" className="size-3" />
            </StatusDisc>
            <span className="min-w-0 truncate text-status-failed-text">{line}</span>
          </Pill>
        ))}
      </div>
      {checks !== null ? <Takes onOpenImage={onOpenImage} takes={checks.takes} /> : null}
    </section>
  );
}
