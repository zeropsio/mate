/**
 * The menu's rows: the projects HQ's records place (`menuTree`), as HQ places them, then the
 * Platform projects — the roster's projects HQ names nowhere, without its birth tag. HQ decides
 * what the person sees: no row is made here, and none is filtered. A Mate HQ is still making has no
 * row: the tree draws it from its birth (`comingMember`). Until HQ answered, or where it refuses
 * or the organization has none, the organization's projects as Zerops lists them, ungrouped. Each
 * project is the store's; inventory and admission enrich rows, never enumerate them. None is drawn
 * until every source they come from answered or stopped answering (`menuSourcesSettled`): a first
 * paint is the settled one, never reordered. Once drawn, they stay while a source reads again:
 * what was painted is never taken back.
 */
import {
  accountReadsAtom,
  MENU_UNANSWERED,
  menuComing,
  menuPlacedProjectIds,
  menuTree,
  shownHqListedMateIdentitiesAtom,
  shownHqListNavigationAtom,
  shownHqMateDirectoryAtom,
  isListedMateProject,
  listedProjectAtom,
  projectGoneAtom,
  shownHqMatesAnsweredAtom,
  shownProjectsAtom,
  type MenuMate,
  type MenuTree,
} from "@t3tools/client-runtime/data";
import {
  nameUnderApp,
  readMateFace,
  type ZeropsGroupPendingMember,
} from "@t3tools/client-runtime/zerops";
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

/** The menu's tree of the organization in view (`menuTree`); unanswered with no account mounted. */
export const menuTreeAtom = Atom.make((get): MenuTree => {
  const account = get(accountReadsAtom);
  return account?.orgId == null
    ? MENU_UNANSWERED
    : get(account.data.project(menuTree, account.orgId));
}).pipe(Atom.withLabel("zerops:menu-tree"));

/** HQ is making a Mate the menu draws from its birth (`menuComing`): the menu has a row to draw. */
export const menuComingAtom = Atom.make((get): boolean => menuComing(get(menuTreeAtom)));

/**
 * A Mate of the tree that no row draws, as its group draws it: its birth's id is its key from the
 * first frame, its project's once HQ names one, its clock HQ's.
 */
export function comingMember(
  member: MenuMate,
  groupName: string | undefined,
): ZeropsGroupPendingMember {
  const face = readMateFace(member.birth?.face ?? member.placement?.mate?.face ?? "");
  const startedAt = member.bornAt === undefined ? Number.NaN : Date.parse(member.bornAt);
  const role = member.intent?.placement.role;
  const name = member.intent?.placement.name ?? member.placement?.name ?? "Mate";
  return {
    projectId: member.projectId ?? member.key,
    ...(member.birth === null ? {} : { intent: member.birth.id }),
    kind: role === "stage" || role === "devstage" ? "devstage" : "mate",
    name: groupName === undefined ? name : nameUnderApp(name, groupName),
    ...(Number.isNaN(startedAt) ? {} : { startedAt }),
    ...(face?.tint === undefined || face.shape === undefined
      ? {}
      : { face: { tint: face.tint, shape: face.shape } }),
  };
}

/** A drawn Mate's key: its birth's, else its project's — one key from its birth on. */
export const memberKeyOf = (member: Pick<ZeropsGroupPendingMember, "intent" | "projectId">) =>
  member.intent ?? member.projectId;

export function menuRowsAtom<Row extends CandidateRow>(
  organizationId: string | undefined,
  candidates: ReadonlyArray<Row>,
  standing: MenuStanding = FIRST_SIGHT,
): Atom.Atom<MenuRows<Row>> {
  return Atom.make((get): MenuRows<Row> => {
    if (organizationId === undefined) return LOADING;
    const navigation = get(shownHqListNavigationAtom);
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
    const tree = get(menuTreeAtom);
    const allPlacements = get(hqPlacementsAtom);
    const gone = new Set(
      candidates.flatMap(({ project }) => (get(projectGoneAtom(project.id)) ? [project.id] : [])),
    );
    const { structure } = navigation;
    if (!tree.answered || structure === null || allPlacements === null) {
      const directory = get(shownHqMateDirectoryAtom);
      return {
        settled: true,
        rows: menuRows({
          placed: NO_ROWS,
          candidates: candidates.filter((row) => isListedMateProject(directory, row.project)),
          gone,
        }),
      };
    }
    // The projects HQ's records place, each joined to its row; a Platform project after them.
    const placedIds = menuPlacedProjectIds(tree);
    const placements = new Map([...allPlacements].filter(([id]) => placedIds.has(id)));
    const platform = new Set(tree.platform.map((project) => project.id));
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
      candidates,
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
        candidates: candidates.filter((row) => platform.has(row.project.id)),
        gone,
      }),
    };
  });
}
