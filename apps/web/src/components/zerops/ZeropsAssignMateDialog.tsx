/**
 * Handing a Mate to a person (guide 0.8, D11).
 *
 * A Mate belongs to whoever created it — the platform makes its creator the
 * project's `OWNER` — so a Mate made *for* a colleague, a leaver's, or one
 * being reassigned needs somebody to say whose it is now. That somebody is an
 * org owner or admin, and what they write is a per-project role override.
 *
 * One list, one verb. The list is the org's members; picking one raises them
 * to `OWNER` here, which is what makes the Mate open for them and theirs to
 * rename. Nothing else on the project moves.
 */
import { useId, useState } from "react";

import { mateMemberName } from "@t3tools/client-runtime/zerops/mateAccess";
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
import { Label } from "../ui/label";

export interface AssignableMember {
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly id: string;
  readonly user?:
    | {
        readonly fullName?: string | undefined;
        readonly firstName?: string | undefined;
        readonly lastName?: string | undefined;
        readonly email?: string | undefined;
      }
    | undefined;
}

/** What to call a member in the list. Never a blank row, never a guess. */
export function assignableMemberLabel(member: AssignableMember): string {
  return mateMemberName(member) ?? member.id;
}

export function ZeropsAssignMateForm({
  projectName,
  members,
  currentOwnerId,
  onCancel,
  onSubmit,
}: {
  readonly projectName: string;
  readonly members: ReadonlyArray<AssignableMember>;
  /** Whoever the project already names as its owner, pre-selected. */
  readonly currentOwnerId?: string | undefined;
  readonly onCancel: () => void;
  readonly onSubmit: (clientUserId: string) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState(currentOwnerId ?? members[0]?.id ?? "");

  return (
    <form
      className="flex min-h-0 flex-col"
      data-zerops-surface="assign-mate"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected.length === 0) return;
        onSubmit(selected);
      }}
    >
      <DialogHeader>
        <DialogTitle>Hand {projectName} over</DialogTitle>
        <DialogDescription>
          Whoever you pick owns this Mate: they open it, rename it and move it. Everyone else in the
          organization keeps seeing it in the list.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-member`}>Owner</Label>
          <select
            autoFocus
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            id={`${id}-member`}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
            value={selected}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {assignableMemberLabel(member)}
              </option>
            ))}
          </select>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={selected.length === 0} type="submit">
          Hand it over
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ZeropsAssignMateDialog({
  onOpenChange,
  ...form
}: Parameters<typeof ZeropsAssignMateForm>[0] & {
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup>
        <ZeropsAssignMateForm {...form} />
      </DialogPopup>
    </Dialog>
  );
}
