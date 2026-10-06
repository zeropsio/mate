/**
 * The menu's rows: those HQ places, from the account's store (`hqNavigation`), and the
 * organization's projects only Zerops lists so far, ungrouped (`menuRows`) — a project HQ places
 * later moves into its application then. Each project is the store's; inventory and admission
 * enrich rows, never enumerate them. None is drawn until every source they come from answered or
 * stopped answering (`menuSourcesSettled`): a first paint is the settled one, never reordered.
 */
import {
  listedProjectAtom,
  projectGoneAtom,
  shownHqVerdictAtom,
  shownProjectsAtom,
} from "@t3tools/client-runtime/data";
import { placedMenuRows, placedNames } from "@t3tools/client-runtime/zerops/hq";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/unstable/reactivity";

import { hqNavigationAtom, hqPlacementsAtom } from "../state/zerops";
import { menuRows, menuSourcesSettled } from "./zeropsMenu.logic";

export interface MenuRows<Row extends CandidateRow = CandidateRow> {
  /** Every source answered or stopped answering; until then no row, and the menu is loading. */
  readonly settled: boolean;
  readonly rows: ReadonlyArray<Row | CandidateRow>;
}

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const LOADING: MenuRows<never> = { settled: false, rows: NO_ROWS };

export function menuRowsAtom<Row extends CandidateRow>(
  organizationId: string | undefined,
  candidates: ReadonlyArray<Row>,
): Atom.Atom<MenuRows<Row>> {
  return Atom.make((get): MenuRows<Row> => {
    if (organizationId === undefined) return LOADING;
    const navigation = get(hqNavigationAtom);
    const listing = get(shownProjectsAtom);
    if (
      navigation.orgId !== organizationId ||
      listing.orgId !== organizationId ||
      !menuSourcesSettled({ projects: listing, hq: navigation, verdict: get(shownHqVerdictAtom) })
    )
      return LOADING;
    const placements = get(hqPlacementsAtom);
    const { structure } = navigation;
    const gone = new Set(
      candidates.flatMap(({ project }) => (get(projectGoneAtom(project.id)) ? [project.id] : [])),
    );
    if (structure === null || placements === null)
      return { settled: true, rows: menuRows({ placed: NO_ROWS, candidates, gone }) };
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
    return { settled: true, rows: menuRows({ placed, candidates, gone }) };
  });
}
