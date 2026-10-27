/**
 * The menu's rows: those HQ places, from the account's store (`hqNavigation`), and the
 * organization's projects only Zerops lists so far, ungrouped (`menuRows`) — a project HQ places
 * later moves into its application then. Each project is the store's; inventory and admission
 * enrich rows, never enumerate them. None is drawn until every source they come from answered or
 * stopped answering (`menuSourcesSettled`): a first paint is the settled one, never reordered.
 * Once drawn, they stay while a source reads again: what was painted is never taken back.
 */
import {
  shownHqListedMateIdentitiesAtom,
  shownCanonicalHqListNavigationAtom,
  shownHqMateDirectoryAtom,
  isListedMateProject,
  listedProjectAtom,
  projectGoneAtom,
  shownHqMatesAnsweredAtom,
  shownProjectsAtom,
} from "@t3tools/client-runtime/data";
import { placedMenuRows, placedNames } from "@t3tools/client-runtime/zerops/hq";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { Atom } from "effect/reactivity";

import { hqPlacementsAtom } from "../state/zerops";
import { menuRows, menuSourcesSettled } from "./zeropsMenu.logic";

export interface MenuRows<Row extends CandidateRow = CandidateRow> {
  /** Every source answered or stopped answering; until then no row, and the menu is loading. */
  readonly settled: boolean;
  readonly rows: ReadonlyArray<Row | CandidateRow>;
}

/** Where the menu stands for the organization in view, as `useMenuRows` keeps it. */
export interface MenuStanding {
  /** The menu waited its patience for its sources' first answers. */
  readonly waitedOut: boolean;
  /** Its rows were drawn: a source reading again never takes them back. */
  readonly drawn: boolean;
}

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const LOADING: MenuRows<never> = { settled: false, rows: NO_ROWS };
const FIRST_SIGHT: MenuStanding = { waitedOut: false, drawn: false };

export function menuRowsAtom<Row extends CandidateRow>(
  organizationId: string | undefined,
  candidates: ReadonlyArray<Row>,
  standing: MenuStanding = FIRST_SIGHT,
): Atom.Atom<MenuRows<Row>> {
  return Atom.make((get): MenuRows<Row> => {
    if (organizationId === undefined) return LOADING;
    const navigation = get(shownCanonicalHqListNavigationAtom);
    const listing = get(shownProjectsAtom);
    if (navigation.orgId !== organizationId || listing.orgId !== organizationId) return LOADING;
    if (
      !standing.drawn &&
      !menuSourcesSettled({
        projects: listing,
        hq: navigation,
        matesAnswered: get(shownHqMatesAnsweredAtom),
        waitedOut: standing.waitedOut,
      })
    )
      return LOADING;
    const directory = get(shownHqMateDirectoryAtom);
    const allPlacements = get(hqPlacementsAtom);
    const placements =
      allPlacements === null
        ? null
        : new Map([...allPlacements].filter(([id]) => isListedMateProject(directory, { id })));
    const listedCandidates = candidates.filter((row) =>
      isListedMateProject(directory, row.project),
    );
    const { structure } = navigation;
    const gone = new Set(
      candidates.flatMap(({ project }) => (get(projectGoneAtom(project.id)) ? [project.id] : [])),
    );
    if (structure === null || placements === null)
      return {
        settled: true,
        rows: menuRows({ placed: NO_ROWS, candidates: listedCandidates, gone }),
      };
    const projects = [...placements.keys()].flatMap((id) => {
      if (get(projectGoneAtom(id))) gone.add(id);
      const project = get(listedProjectAtom(id));
      return project === null ? [] : [project];
    });
    const identities = get(shownHqListedMateIdentitiesAtom);
    const placed = placedMenuRows({
      organizationId,
      placements,
      names: placedNames(structure),
      projects,
      candidates: listedCandidates,
      gone,
    });
    return {
      settled: true,
      rows: menuRows({
        placed: placed.map((row) => {
          const identity = identities[row.project.id];
          return identity === undefined
            ? row
            : { ...row, project: { ...row.project, name: identity.fullName } };
        }),
        candidates: listedCandidates,
        gone,
      }),
    };
  });
}
