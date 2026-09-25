/**
 * Who each usage environment belongs to: its Mate, the project the left menu
 * groups it under, and the person who owns it — so the Usage page can roll an
 * environment's spend up per Mate, per project and per person.
 *
 * Every name is the one the left menu draws: the Mate by `botDisplayName`, the
 * project by the group header `buildZeropsGroupTree` derives (never the single
 * project's own `mate:name:` tag, which can differ), the owner by
 * `resolveMateOwner` over the org's members. An environment no Mate lives in is
 * left out.
 */
import {
  botDisplayName,
  buildZeropsGroupTree,
  hasMate,
  readZeropsGroupTags,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { resolveMateOwner } from "@t3tools/client-runtime/zerops/mateAccess";
import type { EnvironmentId } from "@t3tools/contracts";

import { groupNameIsPlaceholder } from "~/components/zerops/ZeropsGroupTree.logic";

import { rowEnvironment } from "./environmentOrigins";
import { zeropsMateOwner } from "./useZeropsMateOwners";

export interface UsageEnvironmentOwner {
  /** Stable person key: the Zerops user id (member.user?.id), else the member id. */
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  /** True when this owner is the signed-in Zerops user. */
  readonly isViewer: boolean;
}

export interface UsageEnvironmentIdentity {
  /** The Mate's display name as the left menu shows it, e.g. "Lena". */
  readonly mateName: string;
  /** The group's name as the left menu header shows it; null when the group has no real name (placeholder). */
  readonly projectName: string | null;
  readonly owner: UsageEnvironmentOwner | null;
}

export type UsageEnvironmentIdentities = ReadonlyMap<EnvironmentId, UsageEnvironmentIdentity>;

/** Each project's group header, as the left menu names it; placeholder names left out. */
function groupNamesByProject(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const { group, environments } of buildZeropsGroupTree(candidates, { order: "name" })
    .groups) {
    if (groupNameIsPlaceholder(group)) continue;
    for (const environment of environments) names.set(environment.item.project.id, group.name);
  }
  return names;
}

/** The owner as the Mate's corner badge draws them, keyed by person; null when the list names nobody. */
function usageOwner(
  member: ZeropsOrganizationMember | undefined,
  viewerUserId: string | null,
): UsageEnvironmentOwner | null {
  const badge = zeropsMateOwner(member);
  if (member === undefined || badge === undefined) return null;
  const userId = member.user?.id;
  return {
    id: userId ?? member.id,
    ...badge,
    isViewer: userId !== undefined && userId === viewerUserId,
  };
}

export function usageEnvironmentIdentities(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly registeredOrigins: ReadonlyMap<string, EnvironmentId>;
  readonly members: ReadonlyArray<ZeropsOrganizationMember>;
  /** The signed-in Zerops user's id; null when nobody is. */
  readonly viewerUserId: string | null;
}): UsageEnvironmentIdentities {
  const projectNames = groupNamesByProject(input.candidates);
  const identities = new Map<EnvironmentId, UsageEnvironmentIdentity>();
  for (const candidate of input.candidates) {
    const environmentId = rowEnvironment(candidate, input.registeredOrigins);
    if (environmentId === undefined || identities.has(environmentId) || !hasMate(candidate))
      continue;
    const tags = readZeropsGroupTags(candidate.project.tagList);
    identities.set(environmentId, {
      mateName: botDisplayName({ bot: tags.bot, projectName: candidate.project.name }),
      projectName: projectNames.get(candidate.project.id) ?? null,
      owner: usageOwner(
        resolveMateOwner({ project: candidate.project, members: input.members }),
        input.viewerUserId,
      ),
    });
  }
  return identities;
}
