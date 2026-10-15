/**
 * The *Put it live* sheet (G7): what goes live — the change's title and a few plain lines, with
 * the way to its code — where it goes, stage left for later, and one button. It asks nothing it
 * already knows: production's name, its recipe and its first version are decided, and the release
 * follows production by itself (`putLive.logic.ts`).
 */
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

export function PutLiveSheet({
  model,
  onPutLive,
  onSeeCode,
}: {
  readonly model: PutLiveSheetModel;
  readonly onPutLive: () => void;
  /** Opens the change's review, where its code is read. */
  readonly onSeeCode: (() => void) | undefined;
}) {
  return (
    <DialogPopup className="max-w-md" data-zerops-surface="put-live-sheet">
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
              <div>
                <Button onClick={onSeeCode} size="sm" variant="link">
                  See the code
                </Button>
              </div>
            )}
          </section>
          <section aria-label="Where" className="flex flex-col gap-1">
            <h3 className="text-muted-foreground text-xs">Where</h3>
            <p className="font-medium text-foreground text-sm">{model.where.name}</p>
            <p className="text-muted-foreground text-sm">{model.where.line}</p>
          </section>
          <p className="text-muted-foreground text-sm">{model.later}</p>
        </div>
      </DialogPanel>
      <DialogFooter>
        {model.hold === undefined ? null : (
          <p className="me-auto self-center text-muted-foreground text-sm" role="status">
            {model.hold}
          </p>
        )}
        <Button disabled={model.hold !== undefined} onClick={onPutLive}>
          {model.button}
        </Button>
      </DialogFooter>
    </DialogPopup>
  );
}
