/**
 * Deleting a project that holds nothing: one question that says what goes and what stays, one
 * button that does it. While HQ answers it says *Deleting…* and another delete cannot be submitted; Cancel dismisses it; the
 * two words hold one room, so the button keeps its width. A refusal stays under the question, on
 * a line that is always there.
 */
import { cn } from "~/lib/utils";
import type { HqAppContents } from "@t3tools/client-runtime/zerops/hq";
import { emptyMateLine } from "./projects/emptyApps.logic";
import { Button } from "../ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "../ui/dialog";

export function ZeropsDeleteProjectForm({
  name,
  pending,
  contents,
  error,
  onCancel,
  onConfirm,
}: {
  /** The project's name, as HQ holds it. */
  readonly name: string;
  /** HQ is answering the press. */
  readonly pending: boolean;
  readonly contents: HqAppContents | undefined;
  /** HQ's reason for refusing the last press; `null` where it did not. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="delete-project-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && contents?.empty === true) onConfirm();
      }}
    >
      <DialogHeader>
        <DialogTitle>{`Delete ${name}?`}</DialogTitle>
        <DialogDescription>
          {contents?.empty === true
            ? error === null
              ? "It holds no Mate and no change. Its name becomes free for another project."
              : "The deletion was not confirmed. Review the result below before trying again."
            : emptyMateLine(contents)}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <p className="min-h-4 text-xs text-status-failed-text" role="alert">
          {error}
        </p>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          aria-busy={pending || undefined}
          data-zerops-surface="delete-project-confirm"
          disabled={pending || contents?.empty !== true}
          type="submit"
          variant="destructive"
        >
          <span className="grid">
            <span className={cn("col-start-1 row-start-1", pending && "invisible")}>Delete</span>
            <span className={cn("col-start-1 row-start-1", !pending && "invisible")}>
              Deleting…
            </span>
          </span>
        </Button>
      </DialogFooter>
    </form>
  );
}
