/**
 * The bodies of the read cards — `zerops_logs`, `zerops_events`,
 * `zerops_process`, `zerops_discover` — inside the one `ZeropsOperationCard`
 * shell. Presentational, props only: every word is `client-runtime`'s.
 *
 * Each body draws the same frame running and settled. While the call runs
 * the frame holds static placeholders (no motion — the header's dot already
 * says it is working), and the result fills the frame in place.
 */
import type { ZeropsOperationStep, ZeropsReadResult } from "@t3tools/client-runtime/zerops/model";

import { cn } from "~/lib/utils";
import { formatTimestamp } from "../../timestampFormat";
import { MicroLabel, ProcessSteps, StatusDot } from "./primitives";

type ReadResultOf<K extends ZeropsReadResult["kind"]> = Extract<ZeropsReadResult, { kind: K }>;

/** How many placeholder rows a running card draws — a short list, never the cap. */
const PLACEHOLDER_ROWS = 3;

function Placeholder({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block h-3 rounded-sm bg-muted", className)}
      data-zerops-read-placeholder
    />
  );
}

function placeholderKeys(count: number): ReadonlyArray<string> {
  return Array.from({ length: count }, (_, index) => `placeholder-${index}`);
}

const LOG_SEVERITY_CLASS: Record<ReadResultOf<"logs">["lines"][number]["severity"], string> = {
  error: "text-destructive-foreground",
  warning: "text-warning-foreground",
  info: "text-foreground",
};

function clockTime(at: string | undefined): string | undefined {
  if (at === undefined) {
    return undefined;
  }
  const formatted = formatTimestamp(at, "locale");
  return formatted.length > 0 ? formatted : undefined;
}

function LogsBody({ readResult }: { readonly readResult: ReadResultOf<"logs"> }) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <MicroLabel>Service</MicroLabel>
        <span className="font-medium text-foreground">{readResult.service}</span>
        {readResult.filter !== undefined ? (
          <>
            <MicroLabel className="ml-1.5">Filter</MicroLabel>
            <span className="min-w-0 text-muted-foreground">{readResult.filter}</span>
          </>
        ) : null}
      </div>
      <ol
        aria-label={`Log of ${readResult.service}`}
        className="max-h-56 space-y-0.5 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed"
        data-zerops-read-lines
      >
        {readResult.pending
          ? placeholderKeys(PLACEHOLDER_ROWS).map((key, index) => (
              <li key={key}>
                <Placeholder className={index === PLACEHOLDER_ROWS - 1 ? "w-1/2" : "w-5/6"} />
              </li>
            ))
          : readResult.lines.map((line) => {
              const time = clockTime(line.at);
              return (
                <li
                  className="whitespace-pre-wrap break-words"
                  data-zerops-log-severity={line.severity}
                  key={line.id}
                >
                  {time !== undefined ? (
                    <span className="mr-2 text-muted-foreground tabular-nums">{time}</span>
                  ) : null}
                  <span className={LOG_SEVERITY_CLASS[line.severity]}>{line.text}</span>
                </li>
              );
            })}
      </ol>
      {readResult.pending ? (
        <Placeholder className="w-1/3" />
      ) : readResult.counts !== undefined || readResult.note !== undefined ? (
        <p className="text-muted-foreground">
          {[readResult.counts, readResult.note].filter((part) => part !== undefined).join(" · ")}
        </p>
      ) : null}
    </>
  );
}

function EventsBody({ readResult }: { readonly readResult: ReadResultOf<"events"> }) {
  return (
    <>
      <ul aria-label="Recent events" className="space-y-1" data-zerops-read-rows>
        {readResult.pending
          ? placeholderKeys(PLACEHOLDER_ROWS).map((key) => (
              <li className="flex items-center gap-2" key={key}>
                <Placeholder className="w-3/4" />
              </li>
            ))
          : readResult.rows.map((row) => {
              const time = clockTime(row.at);
              return (
                <li className="flex min-w-0 items-center gap-1.5" key={row.id}>
                  {time !== undefined ? (
                    <span className="shrink-0 text-muted-foreground tabular-nums">{time}</span>
                  ) : null}
                  {row.service !== undefined ? (
                    <span className="shrink-0 font-medium text-foreground">{row.service}</span>
                  ) : null}
                  <span className="min-w-0 truncate text-muted-foreground">{row.action}</span>
                  <StatusDot
                    className="ml-auto shrink-0"
                    label={row.status.word}
                    tone={row.status.tone}
                  />
                </li>
              );
            })}
      </ul>
      {readResult.more !== undefined ? (
        <p className="text-muted-foreground">{readResult.more}</p>
      ) : null}
    </>
  );
}

function DiscoverBody({ readResult }: { readonly readResult: ReadResultOf<"discover"> }) {
  return (
    <ul
      aria-label="Services"
      className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
      data-zerops-read-grid
    >
      {readResult.pending
        ? placeholderKeys(2).map((key) => (
            <li
              className="space-y-1.5 rounded-md border border-[var(--zerops-flat-card-border)] px-2 py-1.5"
              key={key}
            >
              <Placeholder className="w-1/2" />
              <Placeholder className="w-1/3" />
            </li>
          ))
        : readResult.rows.map((row) => (
            <li
              className="min-w-0 space-y-0.5 rounded-md border border-[var(--zerops-flat-card-border)] px-2 py-1.5"
              data-zerops-read-cell
              key={row.hostname}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">{row.hostname}</span>
                <StatusDot className="shrink-0" label={row.status.word} tone={row.status.tone} />
              </div>
              {row.type !== undefined || row.note !== undefined ? (
                <p className="truncate text-muted-foreground">
                  {[row.type, row.note].filter((part) => part !== undefined).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
    </ul>
  );
}

function ProcessBody({
  readResult,
  steps,
}: {
  readonly readResult: ReadResultOf<"process">;
  readonly steps: ReadonlyArray<ZeropsOperationStep>;
}) {
  if (readResult.pending) {
    return <Placeholder className="w-2/3" />;
  }
  return steps.length > 0 ? (
    <ProcessSteps aria-label="Processes" density="compact" steps={steps} />
  ) : null;
}

export function ZeropsReadResultBody({
  readResult,
  steps,
}: {
  readonly readResult: ZeropsReadResult;
  /** `process` only: the operation's steps, one per process it read. */
  readonly steps: ReadonlyArray<ZeropsOperationStep>;
}) {
  return (
    <div
      className="space-y-2 px-3 pt-1 pb-2.5 text-xs leading-relaxed"
      data-zerops-read-body={readResult.kind}
    >
      {readResult.kind === "logs" ? (
        <LogsBody readResult={readResult} />
      ) : readResult.kind === "events" ? (
        <EventsBody readResult={readResult} />
      ) : readResult.kind === "discover" ? (
        <DiscoverBody readResult={readResult} />
      ) : (
        <ProcessBody readResult={readResult} steps={steps} />
      )}
    </div>
  );
}
