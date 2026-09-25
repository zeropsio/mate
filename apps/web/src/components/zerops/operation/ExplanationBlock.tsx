/**
 * Why a card failed or timed out: the reducer's one-sentence reason, then
 * the last six lines of the failing phase's log in mono, its error lines
 * toned, any earlier lines of the reducer's capped tail behind a disclosure.
 * The reason and the last lines are always open — they are why the card is
 * red. Presentational, props only (R2).
 */
import type { JSX } from "react";

import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import { cn } from "~/lib/utils";
import { isErrorLogLine } from "./explanation";

type Explanation = NonNullable<ZeropsOperation["explanation"]>;

/** Each line keyed by its text and which repeat of that text it is — log lines do repeat. */
function keyedLines(lines: ReadonlyArray<string>): ReadonlyArray<{ key: string; line: string }> {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const repeat = seen.get(line) ?? 0;
    seen.set(line, repeat + 1);
    return { key: `${repeat}:${line}`, line };
  });
}

/** The tail lines a card shows open; earlier ones wait behind a disclosure. */
const VISIBLE_TAIL_LINES = 6;

function LogLines({ lines }: { readonly lines: ReadonlyArray<{ key: string; line: string }> }) {
  return (
    <ol className="space-y-0.5 overflow-x-auto rounded-md bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed">
      {lines.map(({ key, line }) => {
        const error = isErrorLogLine(line);
        return (
          <li
            className={cn(
              "whitespace-pre-wrap break-words",
              error ? "text-destructive-foreground" : "text-muted-foreground",
            )}
            data-zerops-explanation-line={error ? "error" : "plain"}
            key={key}
          >
            {line}
          </li>
        );
      })}
    </ol>
  );
}

export function ExplanationBlock({
  explanation,
}: {
  readonly explanation: Explanation;
}): JSX.Element {
  const lines = keyedLines(explanation.logTail ?? []);
  const earlier = lines.slice(0, Math.max(0, lines.length - VISIBLE_TAIL_LINES));
  const visible = lines.slice(earlier.length);
  return (
    <div className="space-y-1.5" data-zerops-operation-explanation>
      <p className="text-[13px] text-foreground">{explanation.reason}</p>
      {earlier.length > 0 ? (
        <details className="text-muted-foreground text-xs">
          <summary className="w-fit cursor-pointer list-none select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            Earlier lines
          </summary>
          <div className="mt-1">
            <LogLines lines={earlier} />
          </div>
        </details>
      ) : null}
      {visible.length > 0 ? <LogLines lines={visible} /> : null}
    </div>
  );
}
