import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { FlatCard, StatusDot } from "../zerops/primitives";
import type { MessagesTimelineRow, TurnTallyFact, TurnTallyItem } from "./MessagesTimeline.logic";

export type TurnHeaderRow = Extract<MessagesTimelineRow, { kind: "turn-header" }>;

export interface TurnVerdict {
  readonly tone: ServiceStatusToneId;
  readonly word: string;
}

const TONE_WEIGHT: Readonly<Record<ServiceStatusToneId, number>> = {
  off: 0,
  ok: 1,
  busy: 2,
  attention: 3,
  failed: 4,
};

function worstTone(facts: ReadonlyArray<TurnTallyFact>): ServiceStatusToneId | null {
  let worst: ServiceStatusToneId | null = null;
  for (const fact of facts) {
    if (fact.tone !== null && (worst === null || TONE_WEIGHT[fact.tone] > TONE_WEIGHT[worst])) {
      worst = fact.tone;
    }
  }
  return worst;
}

/**
 * The turn's verdict, read from its settled facts only: live → "Working";
 * stopped → "Stopped"; any failed or uncertain fact → "Needs attention";
 * a deploy with every outcome ok → its own words ("Deployed · Healthy");
 * a landing → "Landed"; else "Done".
 */
export function deriveTurnVerdict(input: {
  readonly state: TurnHeaderRow["state"];
  readonly interrupted: boolean;
  readonly tally: ReadonlyArray<TurnTallyItem>;
}): TurnVerdict {
  if (input.state === "live") return { tone: "busy", word: "Working" };
  if (input.interrupted) return { tone: "off", word: "Stopped" };
  const worst = worstTone(input.tally.flatMap((item) => item.facts));
  if (worst === "failed" || worst === "attention") {
    return { tone: worst, word: "Needs attention" };
  }
  const deploy = input.tally.find((item) => item.kind === "deploy");
  if (deploy) {
    return { tone: "ok", word: deploy.facts.map((fact) => fact.word).join(" · ") };
  }
  if (input.tally.some((item) => item.kind === "landed")) return { tone: "ok", word: "Landed" };
  return { tone: "off", word: "Done" };
}

/**
 * What a turn did, written as it settles: one chip per service, import,
 * browser checks, landing and the person's asks — a service's deploy and
 * verify merged into one chip under its worst tone. Chips only append, so an
 * earlier chip never moves. Presentational — every word comes from the row.
 */
export function TurnTally({ items }: { readonly items: ReadonlyArray<TurnTallyItem> }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul aria-label="What this turn did" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const words = [item.subject, ...item.facts.map((fact) => fact.word)]
          .filter((word): word is string => word !== null)
          .join(" · ");
        const tone = worstTone(item.facts);
        return (
          <li
            key={item.key}
            className="inline-flex min-w-0 max-w-full items-center rounded-md bg-muted px-2 py-0.5 text-foreground text-xs"
          >
            {tone ? (
              <StatusDot label={words} pulse={false} sentence tone={tone} />
            ) : (
              <span className="min-w-0 truncate">{words}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The turn's receipt, the strongest element of a turn: one card from the
 * send until forever. Row 1 carries the verdict with its dot, how long the
 * turn worked and when it ended, and the fold control (settled) or what runs
 * now (live); row 2 the facts. Live and settled are the same element, so
 * nothing jumps when a turn settles. The live dot is still (R6).
 */
export function TurnHeaderCard({
  row,
  clock,
  activityLabel,
  timestamp,
  onToggleFold,
}: {
  readonly row: TurnHeaderRow;
  /** Live: the ticking clock (or what stands in for it, such as compaction). */
  readonly clock: ReactNode;
  /** Live: what is happening now. */
  readonly activityLabel: string | null;
  /** Settled: when the turn ended. */
  readonly timestamp: ReactNode;
  /** Settled turns that fold work away; null where nothing folds. */
  readonly onToggleFold: (() => void) | null;
}) {
  const verdict = deriveTurnVerdict(row);
  const live = row.state === "live";
  const expanded = row.fold?.expanded ?? false;
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <FlatCard className="flex w-full min-w-0 flex-col gap-1.5 px-3.5 py-2.5">
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <StatusDot
          className="shrink-0 font-semibold text-foreground text-sm"
          label={verdict.word}
          pulse={false}
          sentence
          tone={verdict.tone}
        />
        {live ? (
          clock ? (
            <span className="shrink-0 text-muted-foreground text-sm tabular-nums">{clock}</span>
          ) : null
        ) : row.duration ? (
          <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
            {row.duration}
          </span>
        ) : null}
        {!live && timestamp ? (
          <span className="shrink-0 text-muted-foreground/70 text-xs tabular-nums">
            {timestamp}
          </span>
        ) : null}
        <span className="ms-auto flex min-w-0 items-center gap-1">
          {live && activityLabel ? (
            <span className="min-w-0 truncate text-muted-foreground text-xs">{activityLabel}</span>
          ) : null}
          {!live && onToggleFold ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide this turn's work" : "Show this turn's work"}
              data-scroll-anchor-ignore
              onClick={onToggleFold}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <Chevron aria-hidden className="size-4" />
            </button>
          ) : null}
        </span>
      </div>
      <TurnTally items={row.tally} />
    </FlatCard>
  );
}
