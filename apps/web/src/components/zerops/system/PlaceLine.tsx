/**
 * A place — production or a stage — on one line, the one drawing of a place on every page and
 * panel (`placeLineView`): dot · name · a pill where not calm · version · since · address ↗.
 *
 * - `compact` (overview card, Mate panels): its name opens the place's page; since-when is left out.
 * - `row` (the project page): the whole line opens the place's page — it fills under the pointer
 *   as a list's row does — a chevron at its end.
 * - `header` (the place's own page, beside its title): no name; the state word said even when calm.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { formatElapsed } from "~/components/ui/progress.logic";
import { cn } from "~/lib/utils";
import { useSecondsNowMs } from "~/zerops/useNowMs";
import { SINCE_WORD, type PlaceLine as PlaceLineData } from "../projects/projectCard.logic";
import { placeLineView } from "./PlaceLine.logic";

export type PlaceLineDensity = "compact" | "row" | "header";

/**
 * Props: `line` (one of `placeLines(…)` / `useApplicationPlaces(groupId).places`); `groupId` (its
 * project: with it, and the line's `projectId`, its name opens `/group/$groupId/$projectId`);
 * `density` (default `compact`); `trailing` (`row` only: something at the line's end before its
 * chevron — e.g. *Add stage* on a missing stage, which then stands outside the line's press).
 */
export function PlaceLine({
  line,
  groupId,
  density = "compact",
  trailing,
}: {
  readonly line: PlaceLineData;
  readonly groupId?: string | undefined;
  readonly density?: PlaceLineDensity;
  readonly trailing?: ReactNode;
}) {
  const view = placeLineView(line);
  // A compact line (a card, a panel) leaves since-when out, so its address stays whole.
  const facts =
    density === "compact"
      ? view.facts.filter((fact) => !fact.startsWith(`${SINCE_WORD} `))
      : view.facts;
  // A compact line that is not calm gives its address's room to why: "Down · app and db failed"
  // reads whole, where the address would cut both. The place's page still carries it.
  const address = density === "compact" && view.pill !== undefined ? undefined : view.address;
  const projectId = line.projectId;
  const opens = groupId !== undefined && projectId !== undefined;
  const header = density === "header";
  const name = header ? null : opens ? (
    <Link
      className={cn(
        "shrink-0 font-medium text-foreground outline-none",
        density === "row"
          ? "after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-ring"
          : "rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring",
      )}
      data-zerops-place-name=""
      params={{ groupId, projectId }}
      preload="intent"
      to="/group/$groupId/$projectId"
    >
      {view.title}
    </Link>
  ) : (
    <span className="shrink-0 font-medium text-foreground" data-zerops-place-name="">
      {view.title}
    </span>
  );
  const words = (
    <>
      {view.pill === undefined ? null : (
        <Badge data-zerops-place-pill="" tone={view.pill.tone}>
          {view.pill.word}
        </Badge>
      )}
      {header && view.state !== undefined ? (
        <span className="shrink-0 text-foreground">{view.state}</span>
      ) : null}
      {view.version === undefined ? null : (
        <span className="shrink-0 font-mono text-caption text-muted-foreground tabular-nums">
          {view.version}
        </span>
      )}
      {facts.map((fact, index) => (
        <Fragment key={`${String(index)}:${fact}`}>
          {index === 0 && view.version === undefined ? null : <Sep />}
          <span className="min-w-0 shrink-2 truncate text-muted-foreground">{fact}</span>
        </Fragment>
      ))}
      {line.clock === undefined ? null : <PlaceClock since={line.clock.since} />}
      {address === undefined ? null : (
        <>
          <Sep />
          <a
            aria-label={`Open ${view.title} at ${address.host}`}
            className="relative z-10 inline-flex min-w-0 shrink items-center gap-0.5 rounded-sm text-muted-foreground outline-none underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            data-zerops-place-address=""
            href={address.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="truncate">{address.host}</span>
            <ArrowUpRightIcon aria-hidden="true" className="size-3 shrink-0" />
          </a>
        </>
      )}
    </>
  );
  const dot = (
    <Badge
      aria-label={view.pill?.word ?? view.state ?? facts[0] ?? view.title}
      dot
      tone={view.tone}
    />
  );
  if (density === "row")
    return (
      <div
        className={cn(
          "relative flex min-h-8 min-w-0 items-center gap-2 rounded-control text-body",
          // What opens answers the pointer as a list's row does; its address and its verbs are
          // their own presses and leave it still.
          opens &&
            "-mx-2 px-2 transition-colors duration-150 has-[[data-zerops-place-name]:hover]:bg-foreground/5 has-[[data-zerops-place-name]:focus-visible]:bg-foreground/5 motion-reduce:transition-none",
        )}
        data-zerops-place-line="row"
        data-zerops-place={line.kind}
      >
        {dot}
        {name}
        <span className="flex min-w-0 flex-1 items-center gap-x-2 whitespace-nowrap">{words}</span>
        {trailing === undefined || trailing === null ? null : (
          <span className="relative z-10 flex shrink-0 items-center">{trailing}</span>
        )}
        {opens ? (
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
    );
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-x-2 gap-y-0.5 text-body",
        // Beside a page's title the line may wrap; in a card's or a panel's column it stays one
        // line, its facts and address cut at the column's edge.
        header ? "flex-wrap" : "whitespace-nowrap",
      )}
      data-zerops-place-line={density}
      data-zerops-place={line.kind}
    >
      {dot}
      {name}
      {words}
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
      ·
    </span>
  );
}

/** How long a place's wait has run: it ticks here alone, never the page around it. */
function PlaceClock({ since }: { readonly since: number }) {
  const nowMs = useSecondsNowMs(true);
  return (
    <>
      <Sep />
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {formatElapsed(nowMs - since)}
      </span>
    </>
  );
}
