import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useNowMs } from "~/zerops/useNowMs";
import { MateDot } from "./MateDot";

/**
 * The idle row's age; its presentation clock belongs to this label alone. A result not seen hangs
 * the unread dot before it, outside its box, so the dot coming and going moves nothing.
 */
export function SidebarMateAge({
  at,
  className,
  unseen = false,
}: {
  readonly at: string | undefined;
  readonly className?: string | undefined;
  readonly unseen?: boolean;
}) {
  const nowMs = useNowMs();
  const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  return when.length === 0 ? null : (
    <span className={className} data-zerops-surface="sidebar-mate-time">
      {unseen ? <MateDot place="before" surface="sidebar-mate-unread" tone="unread" /> : null}
      {when}
    </span>
  );
}
