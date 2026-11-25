/**
 * What happens after the press, as the New Mate dialog and an account's first run end (board D1, the
 * owner, 2026-09-30): one quiet block — its heading, the steps numbered with their times on the
 * right edge, and one line on whether the person can leave meanwhile (`whatHappensNext.logic.ts`).
 *
 * The block can hold the versions it may turn into in the one place, the shown one on top: a
 * project read as having nothing to deploy, while the dialog is open, changes its words and
 * moves nothing — the block keeps the room of its tallest version.
 */
import { useId } from "react";

import { cn } from "~/lib/utils";

import { SignInPhrase } from "./ZeropsArrivalSteps";
import type { WhatHappensNext as Next } from "./whatHappensNext.logic";
import { Card } from "~/components/ui/card";
import { StepNumber } from "~/components/ui/step-number";

interface WhatHappensNextVersion {
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
    <Card
      aria-labelledby={id}
      data-zerops-surface="what-happens-next"
      render={<section />}
      variant="inset"
    >
      <div className="flex flex-col gap-1 px-3.5 py-2.5">
        <h3 className="text-caption leading-4 font-medium text-muted-foreground" id={id}>
          What happens next
        </h3>
        <div className="grid">
          {versions.map(({ key, next, shown }) => (
            <div
              aria-hidden={shown ? undefined : true}
              className={cn(
                "col-start-1 row-start-1 flex flex-col gap-1 transition-[opacity,visibility] ease-out-strong",
                // The one leaving is gone before the one arriving shows: never both at once.
                shown ? "delay-100 duration-200" : "invisible opacity-0 duration-150",
              )}
              data-zerops-next={shown ? "shown" : "held"}
              key={key}
            >
              <ol className="flex flex-col gap-1">
                {next.steps.map((step, index) => (
                  <li
                    className="grid grid-cols-[1.125rem_minmax(0,1fr)_auto] items-start gap-x-2.5 text-line leading-5"
                    key={step.words}
                  >
                    <StepNumber className="mt-px" n={index + 1} size="sm" />
                    <span className="text-pretty">
                      {step.phrase === undefined ? (
                        step.words
                      ) : (
                        <SignInPhrase parts={step.phrase} />
                      )}
                    </span>
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
      </div>
    </Card>
  );
}
