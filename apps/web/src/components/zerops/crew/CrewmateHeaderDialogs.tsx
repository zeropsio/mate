/**
 * The crewmate header's dialogs: *New task* for this crewmate, and the two
 * menu items that take something away — *Remove from crew* and *Forget
 * memory* — each saying exactly what goes before it goes (PRD §5.6).
 */
import { useId, useState } from "react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";

export interface CrewNewTask {
  readonly title: string;
  readonly brief: string;
  readonly doneWhen: string;
}

/**
 * A task queued for one crewmate (PRD §6.2): it starts when the crewmate's
 * current task lands, or at once when it has none.
 */
export function CrewmateNewTaskDialog({
  handle,
  open,
  sending,
  error,
  onOpenChange,
  onCreate,
}: {
  readonly handle: string;
  readonly open: boolean;
  readonly sending: boolean;
  /** The last refusal's sentence. */
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (task: CrewNewTask) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [doneWhen, setDoneWhen] = useState("");
  const ready = title.trim().length > 0 && !sending;
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          setTitle("");
          setBrief("");
          setDoneWhen("");
        }
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogPopup className="max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            onCreate({ title: title.trim(), brief: brief.trim(), doneWhen: doneWhen.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>New task for @{handle}</DialogTitle>
            <DialogDescription>
              It starts when @{handle} finishes the task it is on, or now if it has none.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-title`}>Title</Label>
                <Input
                  id={`${id}-title`}
                  onChange={(event) => setTitle(event.target.value)}
                  value={title}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-brief`}>Brief</Label>
                <Textarea
                  id={`${id}-brief`}
                  onChange={(event) => setBrief(event.target.value)}
                  value={brief}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-done-when`}>Done when</Label>
                <Textarea
                  id={`${id}-done-when`}
                  onChange={(event) => setDoneWhen(event.target.value)}
                  value={doneWhen}
                />
              </div>
              {error === null ? null : (
                <p className="text-sm text-destructive-foreground">{error}</p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose
              render={
                <Button size="sm" variant="ghost">
                  Cancel
                </Button>
              }
            />
            <Button disabled={!ready} size="sm" type="submit">
              {sending ? "Adding…" : "Add task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** A confirmation that names what a press takes away; the confirm button names the press. */
export function CrewmateConfirmDialog({
  open,
  title,
  description,
  confirm,
  sending,
  error,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
  readonly sending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error === null ? null : (
          <DialogPanel>
            <p className="text-sm text-destructive-foreground">{error}</p>
          </DialogPanel>
        )}
        <DialogFooter>
          <DialogClose
            render={
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            }
          />
          <Button disabled={sending} onClick={onConfirm} size="sm" variant="destructive">
            {confirm}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
