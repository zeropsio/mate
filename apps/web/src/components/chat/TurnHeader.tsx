import { StatusDot } from "../zerops/primitives";
import type { TurnTallyItem } from "./MessagesTimeline.logic";

/**
 * What a turn did, written as it settles: one item per service, import,
 * browser checks, landing and the person's asks, each fact a `StatusDot`
 * with its own word. Presentational — every word comes from the row.
 */
export function TurnTally({ items }: { readonly items: ReadonlyArray<TurnTallyItem> }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="What this turn did"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-1 pt-1 text-muted-foreground text-xs"
    >
      {items.map((item) => (
        <li key={item.key} className="inline-flex min-w-0 items-center gap-1.5">
          {item.subject ? (
            <span className="min-w-0 truncate text-foreground/80">{item.subject}</span>
          ) : null}
          {item.facts.map((fact, index) => {
            // Facts are positional within an item (a deploy, then its verify).
            const key = `${item.key}:${String(index)}`;
            return fact.tone ? (
              <StatusDot key={key} label={fact.word} pulse={false} sentence tone={fact.tone} />
            ) : (
              <span key={key}>{fact.word}</span>
            );
          })}
        </li>
      ))}
    </ul>
  );
}
