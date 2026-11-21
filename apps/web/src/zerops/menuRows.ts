/**
 * The menu's rows: the projects HQ's records place (`menuTree`), as HQ places them, then the
 * Platform projects — the roster's projects HQ names nowhere, without its birth tag. HQ decides
 * what the person sees: no row is made here, and none is filtered. A Mate HQ is still making has no
 * row: the tree draws it from its birth (`comingMember`). Where HQ refuses, the organization's
 * Mates as Zerops lists them, ungrouped. Each project is the store's; inventory and admission
 * enrich rows, never enumerate them. The rows paint at HQ's first answer, in HQ's order, and never
 * before it (`menuRows`): the roster and each Mate's last words fill them as they come, and HQ
 * going away later takes none back.
 */
import {
  accountReadsAtom,
  MENU_LOADING,
  menuComing,
  menuPlacedProjectIds,
  menuTree,
  shownHqListedMateIdentitiesAtom,
  shownHqListNavigationAtom,
  shownHqMateDirectoryAtom,
  isListedMateProject,
  listedProjectAtom,
  projectGoneAtom,
  shownProjectsAtom,
  type MenuMate,
  type MenuTree,
  type MenuTreeState,
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
import { menuRows } from "./zeropsMenu.logic";

export interface MenuRows<Row extends CandidateRow = CandidateRow> {
  /** Where HQ's word on the organization in view stands; `loading`: no row yet. */
  readonly state: MenuTreeState;
  readonly rows: ReadonlyArray<Row | CandidateRow>;
}

const NO_ROWS: ReadonlyArray<CandidateRow> = [];
const LOADING: MenuRows<never> = { state: "loading", rows: NO_ROWS };

/** The menu's tree of the organization in view (`menuTree`); loading with no account mounted. */
export const menuTreeAtom = Atom.make((get): MenuTree => {
  const account = get(accountReadsAtom);
  return account?.orgId == null ? MENU_LOADING : get(account.data.project(menuTree, account.orgId));
}).pipe(Atom.withLabel("zerops:menu-tree"));

/** Where HQ's word on the organization in view stands, alone: it changes far less than the tree. */
export const menuTreeStateAtom = Atom.make((get): MenuTreeState => get(menuTreeAtom).state).pipe(
  Atom.withLabel("zerops:menu-tree-state"),
);

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

/** The menu's rows for the organization in view, as `menuRows` draws them for HQ's state. */
export function menuRowsAtom<Row extends CandidateRow>(
  organizationId: string | undefined,
  candidates: ReadonlyArray<Row>,
): Atom.Atom<MenuRows<Row>> {
  return Atom.make((get): MenuRows<Row> => {
    if (organizationId === undefined) return LOADING;
    const navigation = get(shownHqListNavigationAtom);
    const listing = get(shownProjectsAtom);
    if (navigation.orgId !== organizationId || listing.orgId !== organizationId) return LOADING;
    const tree = get(menuTreeAtom);
    const { state } = tree;
    if (state === "loading") return LOADING;
    const gone = new Set(
      candidates.flatMap(({ project }) => (get(projectGoneAtom(project.id)) ? [project.id] : [])),
    );
    const draw = (placed: ReadonlyArray<Row | CandidateRow>): MenuRows<Row> => {
      const directory = state === "refused" ? get(shownHqMateDirectoryAtom) : null;
      const rows = menuRows({
        state,
        placed,
        candidates,
        platform: new Set(tree.platform.map((project) => project.id)),
        listedMate: (row) => directory !== null && isListedMateProject(directory, row.project),
        gone,
      });
      return rows === null ? LOADING : { state, rows };
    };
    if (state !== "known") return draw(NO_ROWS);
    const allPlacements = get(hqPlacementsAtom);
    const { structure } = navigation;
    // Read from the same delivery as the tree: known with it.
    if (structure === null || allPlacements === null) return LOADING;
    // The projects HQ's records place, each joined to its row.
    const placedIds = menuPlacedProjectIds(tree);
    const placements = new Map([...allPlacements].filter(([id]) => placedIds.has(id)));
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
    return draw(
      placed.map((row) => {
        const identity = identities[row.project.id];
        return identity === undefined
          ? row
          : { ...row, project: { ...row.project, name: identity.fullName } };
      }),
    );
  });
}
