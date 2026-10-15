/**
 * The *Put it live* sheet (G7): what goes live — the change's title and a few plain lines, with
 * the way to its code — where it goes, stage left for later, and one button. It asks nothing it
 * already knows: production's name, its recipe and its first version are decided, and the release
 * follows production by itself (`putLive.logic.ts`).
 */
import { useRef } from "react";

import type { PutLiveSheetModel } from "~/zerops/putLive.logic";

import { Button } from "../ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** A quiet way out beside the words: blue words, their text on the words' edge. */
const TEXT_BUTTON =
  "menu-textbtn -ms-2 self-start outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
        <div className="flex flex-col gap-6">
          <section aria-label="What goes live" className="flex flex-col gap-1">
            <h3 className="text-muted-foreground text-xs">What goes live</h3>
            <p className="font-medium text-foreground text-sm">{model.what.title}</p>
            {model.what.lines.length === 0 ? null : (
              <ul className="flex flex-col gap-0.5 text-muted-foreground text-sm">
                {model.what.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {onSeeCode === undefined ? null : (
              <button className={TEXT_BUTTON} onClick={onSeeCode} type="button">
                See the code
              </button>
            )}
          </section>
          <section aria-label="Where" className="flex flex-col gap-1">
            <h3 className="text-muted-foreground text-xs">Where</h3>
            <p className="font-medium text-foreground text-sm">{model.where.name}</p>
            <p className="text-muted-foreground text-sm">{model.where.line}</p>
          </section>
          <p className="text-muted-foreground text-sm">{model.later}</p>
          {onSetUpYourself === undefined ? null : (
            <button className={TEXT_BUTTON} onClick={onSetUpYourself} type="button">
              Set up production yourself…
            </button>
          )}
        </div>
      </DialogPanel>
      <DialogFooter>
        {model.hold === undefined ? null : (
          <p className="me-auto self-center text-muted-foreground text-sm" role="status">
            {model.hold}
          </p>
        )}
        <Button disabled={model.hold !== undefined} onClick={onPutLive} ref={press}>
          {model.button}
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}
