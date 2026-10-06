import { useAtomValue } from "@effect/atom-react";
import { listedProjectAtom, projectGoneAtom } from "@t3tools/client-runtime/data";
import { placedMenuRows, placedNames } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/unstable/reactivity";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { SidebarZeropsTree } from "../components/zerops/SidebarZeropsTree";
import { hqNavigationAtom, hqPlacementsAtom } from "../state/zerops";
import { menuRows } from "./zeropsMenu.logic";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const NO_ACTION = () => {};

/**
 * The menu's rows: those HQ places, from the account's store (`hqNavigation`), and the
 * organization's projects only Zerops lists so far, ungrouped (`menuRows`) — a project HQ places
 * later moves into its application then. Each project is the store's; inventory and admission
 * enrich rows, never enumerate them.
 */
export function useMenuRows<Row extends CandidateRow>(
  candidates: ReadonlyArray<Row>,
): ReadonlyArray<Row | CandidateRow> {
  const { activeOrganization } = useZeropsSession();
  const navigation = useAtomValue(hqNavigationAtom);
  const placements = useAtomValue(hqPlacementsAtom);
  const organizationId = activeOrganization?.id;
  const structure = navigation.orgId === organizationId ? navigation.structure : null;
  const rows = useMemo(
    () =>
      Atom.make((get) => {
        if (organizationId === undefined) return NO_ROWS;
        const gone = new Set(
          candidates.flatMap(({ project }) =>
            get(projectGoneAtom(project.id)) ? [project.id] : [],
          ),
        );
        if (structure === null || placements === null)
          return menuRows({ placed: NO_ROWS, candidates, gone });
        const projects = [...placements.keys()].flatMap((id) => {
          if (get(projectGoneAtom(id))) gone.add(id);
          const project = get(listedProjectAtom(id));
          return project === null ? [] : [project];
        });
        const placed = placedMenuRows({
          organizationId,
          placements,
          names: placedNames(structure),
          projects,
          candidates,
          gone,
        });
        return menuRows({ placed, candidates, gone });
      }),
    [organizationId, structure, placements, candidates],
  );
  return useAtomValue(rows);
}

/**
 * The admitted product takes over this same HQ row list; the pre-admission menu has no verbs, and
 * says nothing of how current its rows are: the menu it hands over to says that in its header.
 */
export function ZeropsMenuPreview() {
  const rows = useMenuRows(NO_ROWS);
  const slot = typeof document === "undefined" ? null : document.getElementById("boot-shell-menu");
  if (slot === null) return null;
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
