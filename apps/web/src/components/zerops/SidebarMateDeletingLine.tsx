import { cn } from "~/lib/utils";

/**
 * The row's last line while its Mate is on its way off Zerops, or after HQ's deletion of it failed
 * (`mateDeletionLine`): the fact where its words stood, muted, or in the fail colour for a failure.
 */
export function MateDeletingLine({
  text,
  failed = false,
}: {
  readonly text: string;
  readonly failed?: boolean;
}) {
  return (
    <span
      className={cn(
        "truncate menu-line2",
        failed ? "text-status-failed-text" : "text-muted-foreground",
      )}
      data-zerops-surface={failed ? "sidebar-mate-deletion-failed" : "sidebar-mate-deleting"}
    >
      {text}
    </span>
  );
}
