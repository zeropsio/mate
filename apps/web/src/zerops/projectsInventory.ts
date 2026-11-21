/**
 * The projects page's groups are the menu's one tree (`menuTree`): HQ's applications, their
 * environments and the Mates HQ is making — each keyed by its birth from the first frame, as the
 * menu's row is — in HQ's order under the person's own. The page's candidates only decorate its
 * members, joined by project id; nothing this tab made draws a row.
 */
import { useAtomValue } from "@effect/atom-react";
import type { MenuEnvironment, MenuGroup, MenuTree } from "@t3tools/client-runtime/data";
import {
  buildCanonicalGroupTree,
  rankZeropsCandidateForListing,
  type CanonicalGroupTreeView,
  type ZeropsGroupPendingMember,
} from "@t3tools/client-runtime/zerops";
import { useMemo } from "react";

import { comingMember, memberKeyOf, menuTreeAtom } from "./menuRows";
import type { ProjectOrderOptions } from "./projectOrderPreference";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

export interface ProjectsInventory extends CanonicalGroupTreeView<ZeropsCandidatePresentation> {
  /** The applications HQ lists that the tree draws no group for (`MenuTree.undrawn`). */
  readonly undrawn: ReadonlyArray<string>;
}

const NO_COMING: ReadonlyArray<ZeropsGroupPendingMember> = [];

type DeliveryEnvironment = Exclude<
  MenuEnvironment["environment"],
  { readonly target: { readonly kind: "outside" } }
>;

/** A stage or production Mate delivers to: an outside production is no place the page draws. */
const delivers = (
  environment: MenuEnvironment["environment"],
): environment is DeliveryEnvironment => environment.target.kind !== "outside";

/** An application as the group derivation takes it: its readable environments, HQ's records. */
const appOf = (group: MenuGroup) => ({
  id: group.id,
  name: group.name ?? "",
  environments: group.members.flatMap((member) =>
    member.kind === "environment" && delivers(member.environment) ? [member.environment] : [],
  ),
});

/** The Mates HQ is making that no placement holds yet, under their application's name. */
const comingOf = (group: MenuGroup): ReadonlyArray<ZeropsGroupPendingMember> =>
  group.members.flatMap((member) =>
    member.kind === "mate" && member.placement === null ? [comingMember(member, group.name)] : [],
  );

function shapedTree(
  menu: MenuTree,
  candidates: ReadonlyArray<ZeropsCandidatePresentation>,
  order: ProjectOrderOptions["order"],
  customOrder: ProjectOrderOptions["customOrder"],
): ProjectsInventory {
  // A Mate being made in an application is drawn from its birth, as its group's coming Mate: its
  // project, listed before HQ places it, is no second row. Only such a project is held out — one
  // in no application has no coming row here and stays a row, and one that is its application's
  // stage or production stays that environment's.
  const making = new Set(
    menu.groups.flatMap((group) => {
      const targets = new Set(
        group.members.flatMap((member) =>
          member.kind === "environment" && member.projectId !== null ? [member.projectId] : [],
        ),
      );
      return group.members.flatMap((member) =>
        member.kind === "mate" &&
        member.placement === null &&
        member.projectId !== null &&
        !targets.has(member.projectId)
          ? [member.projectId]
          : [],
      );
    }),
  );
  const built = buildCanonicalGroupTree(
    candidates.filter((candidate) => !making.has(candidate.project.id)),
    {
      apps: menu.groups.map(appOf),
      rank: rankZeropsCandidateForListing,
      order,
      ...(customOrder === undefined ? {} : { customOrder }),
    },
  );
  // HQ's order of its applications (newest first) under the person's own arrangement, as the menu.
  const hqOrder = new Map(menu.groups.map((group, at) => [group.id, at]));
  const arranged = new Map(
    (order === "custom" ? (customOrder ?? []) : []).map((id, at) => [id, at]),
  );
  const placeOf = (groupId: string) =>
    arranged.get(groupId) ?? arranged.size + (hqOrder.get(groupId) ?? hqOrder.size);
  const coming = new Map(menu.groups.map((group) => [group.id, comingOf(group)]));
  return {
    ...built,
    groups: built.groups
      .map((entry) => ({
        ...entry,
        group: { ...entry.group, pending: coming.get(entry.group.groupId) ?? NO_COMING },
      }))
      .sort((left, right) =>
        order === "name" ? 0 : placeOf(left.group.groupId) - placeOf(right.group.groupId),
      ),
    undrawn: menu.undrawn,
  };
}

export function useProjectsInventory(
  candidates: ReadonlyArray<ZeropsCandidatePresentation>,
  { order, customOrder }: ProjectOrderOptions,
): ProjectsInventory {
  const menu = useAtomValue(menuTreeAtom);
  return useMemo(
    () => shapedTree(menu, candidates, order, customOrder),
    [menu, candidates, order, customOrder],
  );
}

/** A Mate being made's key on the page: its member's in the tree, the menu row's (`memberKeyOf`). */
export function comingKeyOf(
  group: { readonly pending: ReadonlyArray<ZeropsGroupPendingMember> },
  projectId: string,
): string {
  const member = group.pending.find((pending) => pending.projectId === projectId);
  return member === undefined ? projectId : memberKeyOf(member);
}
