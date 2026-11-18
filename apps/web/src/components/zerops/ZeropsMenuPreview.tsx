import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { createPortal } from "react-dom";
import { useMenuRows } from "~/zerops/useMenuRows";
import { SidebarZeropsTree } from "./SidebarZeropsTree";

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const NO_ACTION = () => {};

/**
 * The admitted product takes over this same HQ row list; the pre-admission menu has no verbs, and
 * says nothing of how current its rows are: the menu it hands over to says that in its header.
 */
export function ZeropsMenuPreview() {
  const { rows, settled } = useMenuRows(NO_ROWS);
  const slot = typeof document === "undefined" ? null : document.getElementById("boot-shell-menu");
  // Until the rows are settled the frame's own loading rows stand (index.html).
  if (slot === null || !settled) return null;
  return createPortal(
    <div inert className="h-full overflow-y-auto">
      <SidebarZeropsTree
        candidates={rows}
        complete={false}
        onSelect={NO_ACTION}
        onBrowseProjects={NO_ACTION}
      />
    </div>,
    slot,
  );
}
