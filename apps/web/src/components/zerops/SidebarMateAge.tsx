import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useNowMs } from "~/zerops/useNowMs";

/** The idle row's age; its presentation clock belongs to this label alone. */
export function SidebarMateAge({
  at,
  className,
}: {
  readonly at: string | undefined;
  readonly className?: string | undefined;
}) {
  const nowMs = useNowMs();
  const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  return when.length === 0 ? null : (
    <span className={className} data-zerops-surface="sidebar-mate-time">
      {when}
    </span>
  );
}
