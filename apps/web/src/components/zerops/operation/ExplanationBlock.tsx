/**
 * Why a card failed or timed out: the reducer's one-sentence reason, then
 * the capped log tail of the failing phase in mono, its error lines toned.
 * Always open — it is the reason the card is red, and the tail is already
 * capped by the reducer. Presentational, props only (R2).
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

export function ExplanationBlock({
  explanation,
}: {
  readonly explanation: Explanation;
}): JSX.Element {
  const logTail = explanation.logTail ?? [];
  return (
    <div className="space-y-1.5" data-zerops-operation-explanation>
      <p className="text-[13px] text-foreground">{explanation.reason}</p>
      {logTail.length > 0 ? (
        <ol className="max-h-56 space-y-0.5 overflow-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
          {keyedLines(logTail).map(({ key, line }) => {
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
      ) : null}
    </div>
  );
}
