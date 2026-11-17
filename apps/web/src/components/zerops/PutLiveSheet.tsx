/**
 * The *Put it live* sheet (G7): one route on the release plan's card — what goes live, then where.
 * The change by its title and what it brings by name (the review reads it whole), with the way to
 * its code; production, what it gets, and the way to set it up yourself; stage left for later, and
 * one button. It asks nothing it already knows: production's name, its recipe and its first
 * version are decided, and the release follows production by itself (`putLive.logic.ts`). The
 * press approves the services it names: HQ refuses a release that creates services nobody saw.
 * What it cannot know it asks, once: who production is for — nothing picked for the person, the
 * button waiting for the answer.
 */
import type { ProductionShape } from "@t3tools/shared/hqRelease";
import { GitMergeIcon, GlobeIcon } from "lucide-react";
import { useId, useRef } from "react";

import type { PutLiveService, PutLiveSheetModel } from "~/zerops/putLive.logic";

import { Button } from "../ui/button";
import { Radio, RadioGroup } from "../ui/radio-group";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

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
        <ol className="put-live-route">
          <li aria-label="What goes live" className="put-live-stop">
            <span aria-hidden="true" className="put-live-mark">
              <GitMergeIcon />
            </span>
            <div className="put-live-stop-body">
              {what === undefined ? (
                // What is merged, still read: its title's room held, no words it takes back.
                <p aria-hidden="true" className="put-live-stop-t">
                  <span className="put-live-skel w-48" />
                </p>
              ) : (
                <>
                  <p className="put-live-stop-t line-clamp-2">{what.title}</p>
                  {what.lines.length === 0 ? null : (
                    <p className="put-live-stop-l line-clamp-2">{what.lines.join(" · ")}</p>
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
          <li aria-label="Where" className="put-live-stop">
            <span aria-hidden="true" className="put-live-mark">
              <GlobeIcon />
            </span>
            <div className="put-live-stop-body">
              <div className="flex items-start justify-between gap-3">
                <p className="put-live-stop-t">{where.name}</p>
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
              <p className="put-live-stop-l">{where.line}</p>
              {where.creates === undefined ? (
                // The setup files, still read: the line's room held.
                <p aria-hidden="true" className="put-live-stop-l">
                  <span className="put-live-skel w-56" />
                </p>
              ) : where.creates.length === 0 ? null : (
                <p className="put-live-stop-l">{createsLine(where.creates)}</p>
              )}
              {where.shapes === undefined ? (
                // Who it is for, still read: both answers' room held.
                <div aria-hidden="true" className="put-live-ask">
                  <p className="put-live-ask-t">Who is it for?</p>
                  <span className="put-live-shape-held" />
                  <span className="put-live-shape-held" data-long="" />
                </div>
              ) : where.shapes.length === 0 ? null : (
                <div className="put-live-ask">
                  <p className="put-live-ask-t" id={asked}>
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
                      <label
                        className="put-live-shape"
                        data-chosen={choice.shape === where.shape || undefined}
                        key={choice.shape}
                      >
                        <Radio className="mt-0.5" value={choice.shape} />
                        <span className="put-live-shape-body">
                          <span className="put-live-shape-t">{choice.title}</span>
                          <span className="put-live-stop-l">{choice.line}</span>
                          <span className="put-live-shape-m">{choice.meta}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              )}
            </div>
          </li>
        </ol>
        <p className="text-muted-foreground text-xs">{model.later}</p>
      </DialogPanel>
      <DialogFooter>
        {model.hold === undefined ? null : (
          <p className="me-auto self-center text-muted-foreground text-sm" role="status">
            {model.hold}
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
