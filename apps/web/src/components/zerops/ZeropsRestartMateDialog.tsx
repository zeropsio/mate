import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function ZeropsRestartMateDialog({
  name,
  body,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  readonly body: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{`Restart ${name}`}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {error === null ? null : (
          <DialogPanel>
            <p role="alert">{error}</p>
          </DialogPanel>
        )}
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending ? "Restarting…" : "Restart"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
