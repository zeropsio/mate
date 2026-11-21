import { useAtomValue } from "@effect/atom-react";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";
import { menuRowsAtom, type MenuRows } from "./menuRows";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** The menu's rows for the organization in view (`menuRowsAtom`), and where HQ's word stands. */
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
