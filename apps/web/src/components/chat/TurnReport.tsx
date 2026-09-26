/**
 * What a settled turn produced, as one card after its answer — each fact once,
 * in its own register: the services it left live with their links, the
 * changes that landed and the files it changed, the checks, what it created
 * and removed, and what it could not do. A failure it came back from stays as
 * history under the service it belongs to.
 */
import type { TurnId } from "@t3tools/contracts";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import type { OutcomeModel, OutcomeService } from "./conversation.logic";

const SERVICE_DOT: Record<OutcomeService["tone"], string> = {
  ok: "bg-status-ok",
  failed: "bg-status-failed",
  attention: "bg-status-attention",
  busy: "bg-status-busy",
};

function OutcomeRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2.5" data-outcome-row={label}>
      <span className="w-17.5 shrink-0 text-muted-foreground text-xs leading-5.5">{label}</span>
      <div className="grid min-w-0 flex-1 gap-1.5">{children}</div>
    </div>
  );
}

function compactCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

export function OutcomeCard({
  outcome,
  onOpenTurnDiff,
}: {
  readonly outcome: OutcomeModel;
  readonly onOpenTurnDiff: (turnId: TurnId) => void;
}) {
  return (
    <section
      aria-label="What this turn produced"
      className="grid gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3"
      data-outcome-card
    >
      {outcome.live.length > 0 ? (
        <OutcomeRow label="Live">
          {outcome.live.map((service) => (
            <div key={service.hostname} className="grid gap-1">
              <div className="flex min-h-5.5 min-w-0 flex-wrap items-center gap-2 text-line">
                <span className={cn("size-2 shrink-0 rounded-full", SERVICE_DOT[service.tone])} />
                <span className="rounded-md bg-accent px-1.5 text-foreground text-xs leading-5">
                  {service.hostname}
                </span>
                {service.version ? (
                  <span className="font-mono text-muted-foreground text-xs">{service.version}</span>
                ) : null}
                <span
                  className={cn(
                    service.tone === "failed" ? "text-status-failed-text" : "text-muted-foreground",
                  )}
                >
                  {service.word}
                </span>
                {service.url ? (
                  <ServiceBrowserLink
                    aria-label={`Open ${service.url}`}
                    className="ms-auto inline-flex items-center gap-1 text-info-foreground text-xs hover:underline"
                    href={service.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open
                    <ArrowUpRightIcon aria-hidden="true" className="size-3" />
                  </ServiceBrowserLink>
                ) : null}
              </div>
              {service.recovered ? (
                <p className="rounded-md bg-status-failed-surface px-2 py-1 text-status-failed-text text-xs">
                  {service.recovered}
                </p>
              ) : null}
            </div>
          ))}
        </OutcomeRow>
      ) : null}
      {outcome.landed.length > 0 || outcome.files !== null ? (
        <OutcomeRow label="Changes">
          {outcome.landed.map((change) => (
            <div key={change.key} className="flex min-h-5.5 min-w-0 items-center gap-2 text-line">
              <span className="size-2 shrink-0 rounded-full bg-status-ok" />
              <span className="shrink-0 font-medium text-foreground">{change.line}</span>
              <span className="text-muted-foreground">landed</span>
              <span className="min-w-0 truncate text-muted-foreground">· {change.title}</span>
            </div>
          ))}
          {outcome.files !== null ? (
            <div className="flex min-h-5.5 min-w-0 items-center gap-2 text-line">
              <span className="text-foreground">
                {outcome.files.count === 1 ? "1 file" : `${outcome.files.count} files`}
              </span>
              <span className="text-diff-addition-foreground tabular-nums">
                +{compactCount(outcome.files.additions)}
              </span>
              <span className="text-diff-deletion-foreground tabular-nums">
                −{compactCount(outcome.files.deletions)}
              </span>
              <button
                className="ms-auto cursor-pointer text-info-foreground text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                onClick={() => onOpenTurnDiff(outcome.files!.turnId)}
                type="button"
              >
                Review diff
              </button>
            </div>
          ) : null}
        </OutcomeRow>
      ) : null}
      {outcome.checks !== null ? (
        <OutcomeRow label="Checks">
          <p className="min-h-5.5 text-line text-muted-foreground">
            <span className="text-foreground">
              {outcome.checks.count === 1 ? "1 page check" : `${outcome.checks.count} page checks`}
            </span>
            {` · ${outcome.checks.views === 1 ? "1 view" : `${outcome.checks.views} views`} · `}
            {outcome.checks.failures > 0 ? (
              <span className="text-status-failed-text">
                {outcome.checks.failures === 1 ? "1 failed" : `${outcome.checks.failures} failed`}
              </span>
            ) : (
              "all passed"
            )}
          </p>
        </OutcomeRow>
      ) : null}
      {outcome.created.length > 0 ? (
        <OutcomeRow label="Created">
          <p className="min-h-5.5 text-line text-foreground">{outcome.created.join(", ")}</p>
        </OutcomeRow>
      ) : null}
      {outcome.removed.length > 0 ? (
        <OutcomeRow label="Removed">
          <p className="min-h-5.5 text-line text-muted-foreground">{outcome.removed.join(", ")}</p>
        </OutcomeRow>
      ) : null}
      {outcome.notDone.length > 0 ? (
        <OutcomeRow label="Not done">
          {outcome.notDone.map((line) => (
            <div key={line} className="flex min-h-5.5 min-w-0 items-center gap-2 text-line">
              <span className="size-2 shrink-0 rounded-full bg-status-failed" />
              <span className="min-w-0 text-status-failed-text">{line}</span>
            </div>
          ))}
        </OutcomeRow>
      ) : null}
    </section>
  );
}
