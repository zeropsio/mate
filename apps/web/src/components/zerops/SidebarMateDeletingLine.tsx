import { cn } from "~/lib/utils";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { mateDeletionWaitingText } from "./SidebarMateRow.logic";

/**
 * The row's last line while its Mate is on its way off Zerops, or after HQ's deletion of it failed
 * (`mateDeletionLine`): the fact where its words stood, muted, or in the fail colour for a failure.
 * `waitsOn`: someone else's stopped deletion, named by `MateDeletionWaitingWords`.
 */
export function MateDeletingLine({
  text,
  waitsOn,
  failed = false,
}: {
  readonly text: string;
  readonly waitsOn?: string | undefined;
  readonly failed?: boolean;
}) {
  return (
    <span
      className={cn(
        "truncate block text-body leading-5.5",
        failed ? "text-status-failed-text" : "text-muted-foreground",
      )}
      data-zerops-surface={failed ? "sidebar-mate-deletion-failed" : "sidebar-mate-deleting"}
    >
      {waitsOn === undefined ? text : <MateDeletionWaitingWords userId={waitsOn} />}
    </span>
  );
}

/**
 * Whom a stopped deletion waits for, by the member list's name of them
 * (`mateDeletionWaitingText`). Mounted only for such a deletion, so a row or card that shows none
 * reads no member list or navigation.
 */
export function MateDeletionWaitingWords({ userId }: { readonly userId: string }) {
  const personName = useHqPersonNames(useZeropsSessionOptional()?.activeOrganization?.id);
  return mateDeletionWaitingText(personName(userId));
}
