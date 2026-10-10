import { useAtomValue } from "@effect/atom-react";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { SidebarZeropsTree } from "../components/zerops/SidebarZeropsTree";
import { menuRowsAtom, type MenuRows } from "./menuRows";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const NO_ACTION = () => {};

/** The menu's rows for the organization in view (`menuRowsAtom`), and whether they are settled. */
export function useMenuRows<Row extends CandidateRow>(
  candidates: ReadonlyArray<Row>,
): MenuRows<Row> {
  const organizationId = useZeropsSession().activeOrganization?.id;
  const rows = useMemo(
    () => menuRowsAtom(organizationId, candidates),
    [organizationId, candidates],
  );
  return useAtomValue(rows);
}

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
    <div inert className="h-full overflow-y-auto px-4 pt-20">
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
