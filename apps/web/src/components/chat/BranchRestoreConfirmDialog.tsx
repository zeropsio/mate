import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

export function BranchRestoreConfirmDialog({
  open,
  onOpenChange,
  threadBranch,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadBranch: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Switch to <code className="font-medium">{threadBranch}</code>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            You have uncommitted changes. They'll carry over to the other branch, or block the
            switch if they conflict.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
          <Button variant="primary" onClick={onConfirm}>
            Switch branch
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
