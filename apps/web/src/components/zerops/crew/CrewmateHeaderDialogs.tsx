/**
 * The crewmate header's confirmations for the two menu items that take
 * something away — *Remove from crew* and *Forget memory* — each saying
 * exactly what goes before it goes (PRD §5.6).
 */
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
