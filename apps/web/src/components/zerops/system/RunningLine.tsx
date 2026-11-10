/**
 * One platform process as one line (`RunningLine`, `runningLines`): the service, what it is in a
 * person's words, where a build stands as three parts — the done ones ticked, the current one
 * marked — and how long it has run, ticking. One waiting says so, and behind what where that is
 * known. `RunningNow` is a place's lines as a group that takes no room while nothing runs.
 */
import type { RunningLine as Line } from "@t3tools/client-runtime/zerops/activity/runningNow";
import { formatRunClock } from "@t3tools/client-runtime/zerops";
import { CheckIcon } from "lucide-react";

import { useSecondsNowMs } from "~/zerops/useNowMs";
import { GrowsInPlace } from "./GrowsInPlace";
import { SectionLabel } from "./SectionLabel";

/**
 * How long a line has run, counted here from when the platform says it began. `short` where a
 * row has room for a word: whole minutes once it has run one (`2m`).
 */
export function RunningClock({
  since,
  short = false,
}: {
  readonly since: string;
  readonly short?: boolean;
}) {
  const now = useSecondsNowMs(true);
  const began = Date.parse(since);
  if (Number.isNaN(began)) return null;
  const clock = formatRunClock(now - began);
  return (
    <span className="shrink-0 tabular-nums" data-clock="">
      {short ? clock.replace(/^(\d+[mh]) .*$/u, "$1") : clock}
    </span>
  );
}

/** A build's three parts in a row: ticked, under way, or to come. */
export function RunningTrail({ trail }: { readonly trail: NonNullable<Line["trail"]> }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2.5"
      data-zerops-primitive="running-trail"
    >
      {trail.map((part) => (
        <span
          className="inline-flex min-w-0 items-center gap-1 data-[state=busy]:text-foreground"
          data-state={part.state}
          key={part.label}
        >
          {part.state === "done" ? (
            <CheckIcon
              aria-label="Done"
              className="size-3 shrink-0 text-status-ok-text"
              strokeWidth={2.5}
            />
          ) : part.state === "busy" ? (
            <span
              aria-label="Under way"
              className="size-1.5 shrink-0 rounded-full bg-primary"
              role="img"
            />
          ) : (
            <span
              aria-label="To come"
              className="size-1.5 shrink-0 rounded-full border border-muted-foreground/60"
              role="img"
            />
          )}
          <span className="truncate">{part.label}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Props: `line`; `within` — "step" where the surface around it already names the service, says
 * what it does and counts its time (a release's step): the line is then where the build stands
 * alone, or its words where it has no parts.
 */
export function RunningLine({
  line,
  within,
}: {
  readonly line: Line;
  readonly within?: "step" | undefined;
}) {
  const words =
    line.waiting && line.behind !== undefined ? `Waiting for ${line.behind}` : line.words;
  const trail = line.trail === undefined || line.waiting ? undefined : line.trail;
  if (within === "step")
    return (
      <span
        className="inline-flex min-w-0 items-center text-caption text-muted-foreground"
        data-waiting={line.waiting ? "" : undefined}
        data-zerops-primitive="running-line"
      >
        {trail === undefined ? <span>{words}</span> : <RunningTrail trail={trail} />}
      </span>
    );
  return (
    // One line where it has the room; in a narrow column the build's parts go under its words,
    // and its clock stays at the first line's end.
    <span className="@container block min-w-0" data-zerops-primitive="running-line">
      <span
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground @md:grid-cols-[auto_minmax(0,1fr)_auto]"
        data-waiting={line.waiting ? "" : undefined}
      >
        <span className="flex min-w-0 items-center gap-2">
          {line.service === undefined ? null : (
            <span className="shrink-0 font-mono text-foreground">{line.service}</span>
          )}
          <span className={line.waiting ? "truncate" : "truncate text-foreground"}>{words}</span>
        </span>
        {trail === undefined ? null : (
          <span className="col-span-2 row-start-2 flex min-w-0 @md:col-span-1 @md:col-start-2 @md:row-start-1">
            <RunningTrail trail={trail} />
          </span>
        )}
        <span className="col-start-2 row-start-1 justify-self-end text-muted-foreground @md:col-start-3">
          <RunningClock since={line.since} />
        </span>
      </span>
    </span>
  );
}

/**
 * A place's running and waiting work, under its label: nothing at all while nothing runs. It
 * arrives eased where it comes after the page drew (`GrowsInPlace`), never as a jump.
 */
export function RunningNow({ lines }: { readonly lines: ReadonlyArray<Line> }) {
  return (
    <GrowsInPlace>
      {lines.length === 0 ? null : (
        // As far from the group under it as the column's groups stand from each other.
        <section className="mb-8 min-w-0" data-zerops-surface="running-now">
          <SectionLabel>Running now</SectionLabel>
          <ul className="m-0 flex list-none flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5">
            {lines.map((line) => (
              <li className="min-w-0" key={line.id}>
                <RunningLine line={line} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </GrowsInPlace>
  );
}
