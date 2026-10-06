/**
 * Who each usage environment belongs to: its Mate, the project the left menu
 * groups it under, and the person who owns it — so the Usage page can roll an
 * environment's spend up per Mate, per project and per person.
 *
 * Every name is the one the left menu draws: the Mate by its project's name, the
 * project by the group header `buildZeropsGroupTree` derives, the owner as HQ
 * names and pictures them (`hqProjectPeople`, drawn by `zeropsMateOwnerOf`). An
 * environment no Mate lives in is left out.
 */
import type { HqMateOwner } from "@t3tools/client-runtime/data";
import { buildZeropsGroupTree, hasMate, projectNameInApp } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { EnvironmentId } from "@t3tools/contracts";

import { groupNameUnread } from "~/components/zerops/ZeropsGroupTree.logic";

import { rowEnvironment } from "./environmentOrigins";
import { zeropsMateOwnerOf } from "./useZeropsMateOwners";
import type { ZeropsOrganizationStatus, ZeropsSessionStatus } from "./ZeropsSessionProvider";

export interface UsageEnvironmentOwner {
  /** Stable person key: the Zerops user id. */
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
  /** The group's name as the left menu header shows it; null when its name could not be read. */
  readonly projectName: string | null;
  readonly owner: UsageEnvironmentOwner | null;
}

export type UsageEnvironmentIdentities = ReadonlyMap<EnvironmentId, UsageEnvironmentIdentity>;

/** Each project's group header, as the left menu names it; names that could not be read left out. */
function groupNamesByProject(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const { group, environments } of buildZeropsGroupTree(candidates, { order: "name" })
    .groups) {
    if (groupNameUnread(group)) continue;
    for (const environment of environments) names.set(environment.item.project.id, group.name);
  }
  return names;
}

/** The owner as the Mate's corner badge draws them, keyed by person; null when HQ names nobody. */
function usageOwner(
  owner: HqMateOwner | null | undefined,
  viewerUserId: string | null,
): UsageEnvironmentOwner | null {
  const badge = zeropsMateOwnerOf(owner, viewerUserId);
  return owner == null || badge === undefined ? null : { id: owner.userId, ...badge };
}

export function usageEnvironmentIdentities(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly registeredOrigins: ReadonlyMap<string, EnvironmentId>;
  /** Each Mate's owner as HQ names them, by project (`hqProjectPeople`). */
  readonly owners: Readonly<Record<string, HqMateOwner | null>>;
  /** The signed-in Zerops user's id; null when nobody is. */
  readonly viewerUserId: string | null;
}): UsageEnvironmentIdentities {
  const projectNames = groupNamesByProject(input.candidates);
  const identities = new Map<EnvironmentId, UsageEnvironmentIdentity>();
  for (const candidate of input.candidates) {
    const environmentId = rowEnvironment(candidate, input.registeredOrigins);
    if (environmentId === undefined || identities.has(environmentId) || !hasMate(candidate))
      continue;
    identities.set(environmentId, {
      mateName: projectNameInApp(candidate.project),
      projectName: projectNames.get(candidate.project.id) ?? null,
      owner: usageOwner(input.owners[candidate.project.id], input.viewerUserId),
    });
  }
  return identities;
}

/**
 * Whether an owner missing from the identities means "nobody" yet: `resolving`
 * while the session, the organization, HQ's people or the candidate listing is
 * still arriving; `unavailable` when one of them will not (signed out, no
 * organization chosen, an HQ that names nobody, a failed or withheld read).
 */
export type UsageOwnersStatus = "resolving" | "resolved" | "unavailable";

/**
 * Where HQ's people stand for the Usage page: `idle` with nobody signed in, `loading` until HQ or
 * this browser's memory of it names them, `ready` once named, `failed` where HQ answered naming
 * nobody — one from before the overviews.
 */
export type UsagePeopleStatus = "idle" | "loading" | "ready" | "failed";

export function usageOwnersStatus(input: {
  readonly session: ZeropsSessionStatus;
  readonly organization: ZeropsOrganizationStatus;
  readonly people: UsagePeopleStatus;
  readonly listing: Shown<unknown>["state"];
}): UsageOwnersStatus {
  if (input.session === "loading") return "resolving";
  if (input.session !== "signed-in") return "unavailable";
  if (input.people === "failed") return "unavailable";
  if (
    input.people === "idle" &&
    input.organization !== "idle" &&
    input.organization !== "loading"
  ) {
    return "unavailable";
  }
  if (input.listing === "failed" || input.listing === "gone" || input.listing === "withheld") {
    return "unavailable";
  }
  if (input.people !== "ready" || input.listing !== "known") return "resolving";
  return "resolved";
}
