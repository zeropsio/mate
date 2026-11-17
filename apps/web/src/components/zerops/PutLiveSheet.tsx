/**
 * The *Put it live* sheet (G7): one route on the release plan's card — what goes live, then where.
 * The change by its title and what it brings by name (the review reads it whole), with the way to
 * its code; production, what it gets, and the way to set it up yourself; stage left for later, and
 * one button. It asks nothing it already knows: production's name, its recipe and its first
 * version are decided, and the release follows production by itself (`putLive.logic.ts`). The
 * press approves the services it names: HQ refuses a release that creates services nobody saw.
 */
import { GitMergeIcon, GlobeIcon } from "lucide-react";
import { useRef } from "react";

import type { PutLiveService, PutLiveSheetModel } from "~/zerops/putLive.logic";

import { Button } from "../ui/button";
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
}: {
  readonly model: PutLiveSheetModel;
  readonly onPutLive: () => void;
  /** Opens the change's review, where its code is read. */
  readonly onSeeCode: (() => void) | undefined;
  /**
   * The project's own form for production, for what this sheet decides for the person: its name,
   * an agent in it, or a branch of their Git repository instead of a Zerops project.
   */
  readonly onSetUpYourself?: (() => void) | undefined;
}) {
  const press = useRef<HTMLButtonElement>(null);
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
