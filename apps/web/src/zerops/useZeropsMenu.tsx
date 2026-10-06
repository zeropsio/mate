import { useAtomValue } from "@effect/atom-react";
import { listedProjectAtom, projectGoneAtom } from "@t3tools/client-runtime/data";
import { menuRowsFromHq } from "@t3tools/client-runtime/zerops/hq";
import { Atom } from "effect/unstable/reactivity";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { SidebarZeropsTree } from "../components/zerops/SidebarZeropsTree";
import { hqLoginsAtom, hqReadyAgentsAtom, hqStructureAtom } from "../state/zerops";
import { menuRows } from "./zeropsMenu.logic";
import { useZeropsSession } from "./ZeropsSessionProvider";

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const NO_ACTION = () => {};

/**
 * The menu's rows: HQ's, where it places them, and the organization's projects only Zerops lists
 * so far, ungrouped (`menuRows`). Each project is the account store's; inventory and admission
 * enrich rows, never enumerate them.
 */
export function useZeropsMenu<Row extends CandidateRow>(
  candidates: ReadonlyArray<Row>,
): ReadonlyArray<Row | CandidateRow> {
  const { activeOrganization } = useZeropsSession();
  const view = useAtomValue(hqStructureAtom);
  const organizationId = activeOrganization?.id;
  const structure = view !== null && view.organizationId === organizationId ? view.structure : null;
  const rows = useMemo(
    () =>
      Atom.make((get) => {
        if (organizationId === undefined) return NO_ROWS;
        const gone = new Set(
          candidates.flatMap(({ project }) =>
            get(projectGoneAtom(project.id)) ? [project.id] : [],
          ),
        );
        if (structure === null) return menuRows({ placed: NO_ROWS, candidates, gone });
        const ids = [
          ...structure.ungrouped.map((row) => row.projectId),
          ...structure.apps.flatMap((app) => app.projects.map((row) => row.projectId)),
        ];
        const projects = ids.flatMap((id) => {
          if (get(projectGoneAtom(id))) gone.add(id);
          const project = get(listedProjectAtom(id));
          return project === null ? [] : [project];
        });
        // Each Mate as HQ's overview of it says it: who signed its agent in, whether it needs nobody.
        const placed = menuRowsFromHq({
          organizationId,
          structure,
          projects,
          candidates,
          gone,
          logins: get(hqLoginsAtom),
          readyAgents: get(hqReadyAgentsAtom),
        });
        return menuRows({ placed, candidates, gone });
      }),
    [organizationId, structure, candidates],
  );
  return useAtomValue(rows);
}

/**
 * The admitted product takes over this same HQ row list; the pre-admission menu has no verbs, and
 * says nothing of how current its rows are: the menu it hands over to says that in its header.
 */
export function ZeropsMenuPreview() {
  const rows = useZeropsMenu(NO_ROWS);
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
