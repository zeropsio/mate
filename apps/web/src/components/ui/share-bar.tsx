import { formatPercent } from "@t3tools/shared/usageFormat";

import { ChartReadout, ChartReadoutRow, Legend, LegendItem } from "./chart";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

export interface ShareBarPart {
  readonly label: string;
  readonly value: number;
  /** The part's series colour, best a token: `var(--color-series-1)`. */
  readonly color: string;
}

/**
 * A whole split into its parts, as one bar: cost by type, a balance by where it came from, spend by
 * person. Each part is a pill as long as its share, 2 px apart, in its series colour; hovering one
 * says its name, amount and share. Empty parts are left out, and nothing renders without a total.
 *
 * - `label` names the whole for assistive technology, which hears every part's amount.
 * - `format` writes an amount: `formatUsd`, `formatTokens`.
 * - `legend` adds the key under the bar, a swatch, name and amount per part. Leave it off where the
 *   rows beside the bar already say each part (a list with its own swatches).
 */
function ShareBar({
  label,
  parts,
  format,
  legend = false,
}: {
  readonly label: string;
  readonly parts: readonly ShareBarPart[];
  readonly format: (value: number) => string;
  readonly legend?: boolean;
}) {
  const visible = parts.filter((part) => part.value > 0);
  const total = visible.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) return null;
  const bar = (
    <div
      aria-label={`${label}: ${visible.map((part) => `${part.label} ${format(part.value)}`).join(", ")}`}
      className="flex h-2 w-full min-w-0 gap-0.5"
      data-slot="share-bar"
      role="img"
    >
      {visible.map((part) => (
        <Tooltip key={part.label}>
          <TooltipTrigger
            delay={0}
            render={
              <div
                className="h-full min-w-1 rounded-mark"
                data-slot="share-bar-part"
                style={{ flex: `${String(part.value)} 1 0`, backgroundColor: part.color }}
              />
            }
          />
          <TooltipPopup variant="rich">
            <ChartReadout>
              <ChartReadoutRow
                color={part.color}
                label={part.label}
                value={
                  <>
                    {format(part.value)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatPercent(part.value / total)}
                    </span>
                  </>
                }
              />
            </ChartReadout>
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
  if (!legend) return bar;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {bar}
      <Legend>
        {visible.map((part) => (
          <LegendItem
            color={part.color}
            key={part.label}
            label={part.label}
            value={format(part.value)}
          />
        ))}
      </Legend>
    </div>
  );
}

export { ShareBar };
