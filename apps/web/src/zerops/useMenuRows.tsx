import { useAtomValue } from "@effect/atom-react";
import { STREAM_POLICY } from "@t3tools/client-runtime/data";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SidebarZeropsTree } from "../components/zerops/SidebarZeropsTree";
import { menuRowsAtom, type MenuRows } from "./menuRows";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const NO_ACTION = () => {};

/**
 * How long the menu holds its loading rows for a source whose first read failed before its rows
 * stand without it: a stream's own reconnect grace, past which the data layer too calls it down. A
 * first failure is retried within a second, so HQ's or Zerops's next answer lands well inside it.
 */
export const MENU_SOURCES_PATIENCE_MS = STREAM_POLICY.reconnectGraceMs;

/**
 * The menu's rows for the organization in view (`menuRowsAtom`), and whether they are settled:
 * its sources get `MENU_SOURCES_PATIENCE_MS` for their first answers, and rows once drawn stand.
 */
export function useMenuRows<Row extends CandidateRow>(
  candidates: ReadonlyArray<Row>,
): MenuRows<Row> {
  const organizationId = useZeropsSession().activeOrganization?.id;
  const [waitedFor, setWaitedFor] = useState<string | undefined>(undefined);
  const [drawnFor, setDrawnFor] = useState<string | undefined>(undefined);
  const waitedOut = organizationId !== undefined && waitedFor === organizationId;
  const drawn = organizationId !== undefined && drawnFor === organizationId;
  const rows = useMemo(
    () => menuRowsAtom(organizationId, candidates, { waitedOut, drawn }),
    [organizationId, candidates, waitedOut, drawn],
  );
  const menu = useAtomValue(rows);
  // Drawn once, for this organization: kept from this render on, before anything paints.
  if (menu.settled && organizationId !== undefined && drawnFor !== organizationId)
    setDrawnFor(organizationId);
  useEffect(() => {
    if (organizationId === undefined || drawn || waitedOut) return;
    const timer = window.setTimeout(() => {
      setWaitedFor(organizationId);
    }, MENU_SOURCES_PATIENCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [drawn, organizationId, waitedOut]);
  return menu;
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
