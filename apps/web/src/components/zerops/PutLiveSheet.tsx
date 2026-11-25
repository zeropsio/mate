/**
 * The *Put it live* sheet (G7): one route on the release plan's card — what goes live, then where.
 * The change by its title and what it brings by name (the review reads it whole), with the way to
 * its code; production, what it gets, and the way to set it up yourself; stage left for later, and
 * one button. It asks nothing it already knows: production's name, its recipe and its first
 * version are decided, and HQ releases to production once it made it (`putLive.logic.ts`). The
 * press approves the services it names: HQ stops at the release's review for anything else.
 * What it cannot know it asks, once: who production is for — nothing picked for the person, the
 * button waiting for the answer.
 */
import type { ProductionShape } from "@t3tools/shared/hqRelease";
import { GitMergeIcon, GlobeIcon } from "lucide-react";
import { useId, useRef } from "react";

import type { PutLiveService, PutLiveSheetModel } from "~/zerops/putLive.logic";

import { Button } from "../ui/button";
import { RadioCard, RadioGroup } from "../ui/radio-group";
import { Skeleton } from "../ui/skeleton";
import { StepNumber } from "../ui/step-number";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/**
 * The route: what goes live, then where, on the release plan's card and marks; its rows wrap, a
 * change's title being the person's words. From one stop's mark a line runs to the next one's.
 */
const STOP =
  "relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3.5 px-4 py-3.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-4 not-first:before:left-13.5 not-first:before:h-px not-first:before:bg-border not-last:after:absolute not-last:after:top-10.25 not-last:after:-bottom-1.75 not-last:after:left-6.75 not-last:after:w-0.5 not-last:after:rounded-full not-last:after:bg-foreground/12";
const STOP_TITLE = "text-body font-medium text-foreground text-pretty";
const STOP_LINE = "text-body leading-4.5 text-muted-foreground text-pretty";
/** Who production is for, asked in its stop: its question over the kit's RadioCards. */
const ASK = "mt-2.5 grid gap-2.5";
const ASK_TITLE = "text-body font-medium leading-4.5 text-foreground";

const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/** "Bun 1.4, PostgreSQL 18 and Object storage · billed by Zerops". */
const createsLine = (services: ReadonlyArray<PutLiveService>) =>
  `${LIST.format(services.map((service) => service.kind))} · billed by Zerops`;

export function PutLiveSheet({
  model,
  onPutLive,
  onSeeCode,
  onSetUpYourself,
  onShape,
}: {
  readonly model: PutLiveSheetModel;
  readonly onPutLive: () => void;
  /** The person's answer to who production is for. */
  readonly onShape: (shape: ProductionShape) => void;
  /** Opens the change's review, where its code is read. */
  readonly onSeeCode: (() => void) | undefined;
  /**
   * The project's own form for production, for what this sheet decides for the person: its name,
   * an agent in it, or a branch of their Git repository instead of a Zerops project.
   */
  readonly onSetUpYourself?: (() => void) | undefined;
}) {
  const press = useRef<HTMLButtonElement>(null);
  const asked = useId();
  const { what, where } = model;
  return (
    <DialogPopup
      className="max-w-md"
      data-zerops-surface="put-live-sheet"
      // Its one button, never the quiet ways out beside the words.
      initialFocus={press}
    >
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
        <DialogDescription className="sr-only">
          What goes live, and where it goes.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <ol className="grid rounded-card border border-border bg-foreground/2 py-0.5">
          <li aria-label="What goes live" className={STOP}>
            <StepNumber className="-mt-px" icon={<GitMergeIcon />} n={1} />
            <div className="flex min-w-0 flex-col gap-0.5">
              {what === undefined ? (
                // What is merged, still read: its title's room held, no words it takes back.
                <p aria-hidden="true" className={STOP_TITLE}>
                  <Skeleton className="my-0.75 h-3 w-48" shape="pill" />
                </p>
              ) : (
                <>
                  <p className={`${STOP_TITLE} line-clamp-2`}>{what.title}</p>
                  {what.lines.length === 0 ? null : (
                    <p className={`${STOP_LINE} line-clamp-2`}>{what.lines.join(" · ")}</p>
                  )}
                </>
              )}
              {onSeeCode === undefined ? null : (
                <Button className="-ms-2 self-start" onClick={onSeeCode} size="xs" variant="link">
                  See the code
                </Button>
              )}
            </div>
          </li>
          <li aria-label="Where" className={STOP}>
            <StepNumber className="-mt-px" icon={<GlobeIcon />} n={2} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-start justify-between gap-3">
                <p className={STOP_TITLE}>{where.name}</p>
                {onSetUpYourself === undefined ? null : (
                  <Button
                    aria-label="Set up production yourself…"
                    className="-me-2 shrink-0"
                    onClick={onSetUpYourself}
                    size="xs"
                    variant="link"
                  >
                    Set up yourself…
                  </Button>
                )}
              </div>
              <p className={STOP_LINE}>{where.line}</p>
              {where.creates === undefined ? (
                // The setup files, still read: the line's room held.
                <p aria-hidden="true" className={STOP_LINE}>
                  <Skeleton className="my-0.75 h-3 w-56" shape="pill" />
                </p>
              ) : where.creates.length === 0 ? null : (
                <p className={STOP_LINE}>{createsLine(where.creates)}</p>
              )}
              {where.shapes === undefined ? (
                // Who it is for, still read: both answers' room held.
                <div aria-hidden="true" className={ASK}>
                  <p className={ASK_TITLE}>Who is it for?</p>
                  <Skeleton className="h-23.5" shape="card" />
                  <Skeleton className="mt-0.5 h-32.5" shape="card" />
                </div>
              ) : where.shapes.length === 0 ? null : (
                <div className={ASK}>
                  <p className={ASK_TITLE} id={asked}>
                    Who is it for?
                  </p>
                  <RadioGroup
                    aria-labelledby={asked}
                    disabled={model.busy === true}
                    onValueChange={(value) => {
                      const chosen = where.shapes?.find((choice) => choice.shape === value);
                      if (chosen !== undefined) onShape(chosen.shape);
                    }}
                    value={where.shape ?? null}
                  >
                    {where.shapes.map((choice) => (
                      <RadioCard key={choice.shape} title={choice.title} value={choice.shape}>
                        <span>{choice.line}</span>
                        <span className="mt-0.5 tabular-nums">{choice.meta}</span>
                      </RadioCard>
                    ))}
                  </RadioGroup>
                </div>
              )}
            </div>
          </li>
        </ol>
        {model.later === undefined ? null : (
          <p className="text-muted-foreground text-caption">{model.later}</p>
        )}
      </DialogPanel>
      <DialogFooter>
        {model.hold === undefined && model.refused === undefined ? null : (
          <p className="me-auto self-center text-muted-foreground text-body" role="status">
            {model.hold ?? model.refused}
          </p>
        )}
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          aria-busy={what === undefined || model.busy === true || undefined}
          disabled={model.hold !== undefined || what === undefined || model.busy === true}
          onClick={onPutLive}
          ref={press}
        >
          {model.button}
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}
