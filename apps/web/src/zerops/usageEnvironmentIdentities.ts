/** Current-owner attribution and stable HQ app identity for sampled agent usage. */
import type { HqMateOwner, HqProjectPeople, HqNavigationRead } from "@t3tools/client-runtime/data";
import { hasMate, projectNameInApp } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { EnvironmentId } from "@t3tools/contracts";

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
  /** Stable HQ app ID; it is never inferred from a name. */
  readonly projectId: string | null;
  /** HQ's application name, independent of its ID; null while unread. */
  readonly projectName: string | null;
  readonly ownerState: "known" | "unassigned" | "unknown";
  readonly owner: UsageEnvironmentOwner | null;
}

export type UsageEnvironmentIdentities = ReadonlyMap<EnvironmentId, UsageEnvironmentIdentity>;

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
  readonly owners: Readonly<Record<string, Pick<HqProjectPeople, "owner" | "owned">>>;
  /** The signed-in Zerops user's id; null when nobody is. */
  readonly viewerUserId: string | null;
}): UsageEnvironmentIdentities {
  const identities = new Map<EnvironmentId, UsageEnvironmentIdentity>();
  for (const candidate of input.candidates) {
    const environmentId = rowEnvironment(candidate, input.registeredOrigins);
    if (environmentId === undefined || identities.has(environmentId) || !hasMate(candidate))
      continue;
    identities.set(environmentId, {
      mateName: projectNameInApp(candidate.project),
      projectId: candidate.project.hq?.appId ?? null,
      ownerState:
        input.owners[candidate.project.id]?.owned === false
          ? "unassigned"
          : input.owners[candidate.project.id]?.owner != null
            ? "known"
            : "unknown",
      projectName: candidate.project.hq?.appName?.trim() || null,
      owner: usageOwner(input.owners[candidate.project.id]?.owner, input.viewerUserId),
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

/** An old organization's answers cannot establish the newly selected scope. */
export function usageBaselineStatus(input: {
  readonly orgId: string | null;
  readonly navigationOrgId: string | null;
  readonly navigation: Pick<HqNavigationRead, "read" | "refusal" | "capped" | "updateRequired">;
  readonly placement: { readonly complete: boolean; readonly unavailableReason?: string };
  readonly listing: Shown<unknown>["state"];
}): UsageOwnersStatus {
  if (input.orgId === null) return "unavailable";
  if (input.orgId !== input.navigationOrgId) return "resolving";
  if (
    input.placement.unavailableReason !== undefined ||
    input.navigation.refusal !== null ||
    (input.navigation.capped && (input.navigation.read !== "read" || !input.placement.complete)) ||
    input.navigation.updateRequired ||
    input.listing === "failed" ||
    input.listing === "withheld" ||
    input.listing === "gone"
  )
    return "unavailable";
  return input.navigation.read === "read" && input.placement.complete && input.listing === "known"
    ? "resolved"
    : "resolving";
}
