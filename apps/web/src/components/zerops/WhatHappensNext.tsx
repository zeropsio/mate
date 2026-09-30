/**
 * What happens after the press, as the New Mate and New project dialogs end (board D1, the
 * owner, 2026-09-30): one quiet block — its heading, the steps numbered with their times on the
 * right edge, and one line on whether the person can leave meanwhile (`whatHappensNext.logic.ts`).
 *
 * The block can hold the versions it may turn into in the one place, the shown one on top: a
 * project read as having nothing to deploy, while the dialog is open, changes its words and
 * moves nothing — the block keeps the room of its tallest version.
 */
import { useId } from "react";

import { cn } from "~/lib/utils";

import type { WhatHappensNext as Next } from "./whatHappensNext.logic";

export interface WhatHappensNextVersion {
  readonly key: string;
  readonly next: Next;
  readonly shown: boolean;
}

export function WhatHappensNext({
  versions,
}: {
  /** Every version it may show; exactly one shown. */
  readonly versions: ReadonlyArray<WhatHappensNextVersion>;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-1.5 rounded-xl bg-muted/60 px-3.5 pt-2.5 pb-3"
      data-zerops-surface="what-happens-next"
    >
      <h3 className="text-xs leading-4 font-medium text-muted-foreground" id={id}>
        What happens next
      </h3>
      <div className="grid">
        {versions.map(({ key, next, shown }) => (
          <div
            aria-hidden={shown ? undefined : true}
            className={cn(
              "col-start-1 row-start-1 flex flex-col gap-1.5 transition-[opacity,visibility] ease-out",
              // The one leaving is gone before the one arriving shows: never both at once.
              shown ? "delay-100 duration-200" : "invisible opacity-0 duration-100",
            )}
            data-zerops-next={shown ? "shown" : "held"}
            key={key}
          >
            <ol className="flex flex-col gap-1.5">
              {next.steps.map((step, index) => (
                <li
                  className="grid grid-cols-[1.125rem_minmax(0,1fr)_auto] items-start gap-x-2.5 text-line leading-5"
                  key={step.words}
                >
                  <span
                    aria-hidden
                    className="mt-px flex size-4.5 items-center justify-center rounded-full bg-background text-2xs leading-none font-medium tabular-nums ring-1 ring-border ring-inset"
                  >
                    {index + 1}
                  </span>
                  <span className="text-pretty">{step.words}</span>
                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {step.time ?? ""}
                  </span>
                </li>
              ))}
            </ol>
            <p className="ps-7 text-line leading-5 text-muted-foreground">{next.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
