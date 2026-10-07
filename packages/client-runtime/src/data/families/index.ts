import { mateVcsFamily } from "./mateVcs.ts";
import { hqGitCredentialsFamily, hqGitCredentialRequestFamily } from "./hqGitCredentials.ts";
import { mateAssetUrlFamily } from "./mateAssetUrl.ts";
import { mateFilesystemFamily } from "./mateFilesystem.ts";
import { matePullRequestFamily } from "./matePullRequest.ts";
import { mateReviewFamily } from "./mateReview.ts";
import { mateReviewFileFamily } from "./mateReviewFile.ts";
import { mateWorkspaceFileFamily } from "./mateWorkspaceFile.ts";
import { mateWorkspaceEntriesFamily } from "./mateWorkspaceEntries.ts";
import { mateWorkspacePathsFamily } from "./mateWorkspacePaths.ts";
import { mateWorkspaceContentsFamily } from "./mateWorkspaceContents.ts";
import { mateMcpServersFamily } from "./mateMcpServers.ts";
import { mateVcsRefsFamily } from "./mateVcsRefs.ts";
import { hqRepositorySourceFamily } from "./hqRepositorySource.ts";
import { mateActionRequestFamily } from "./mateActionRequest.ts";
import { MATE_FEED_FAMILIES } from "./mateFeeds.ts";
import { mateUpdateAvailabilityFamily, mateUpdateRequestFamily } from "./mateUpdate.ts";
import { mateSetupFamily } from "./mateSetup.ts";
import { locationLatencyFamily } from "./locationLatency.ts";
import { hqLifecycleFamily } from "./hqLifecycle.ts";
import { mateImageFamily } from "./mateImage.ts";
/**
 * The fact families this account holds. A new family is one module beside these and one line
 * here; the reducer, the store and the Zerops adapter loop over this list.
 *
 * @module data/families
 */
import { databaseFamily, databaseSessionFamily } from "./database.ts";
import { mateBrowserFrameFamily } from "./mateBrowserFrame.ts";
import { hqChangeReadFamily } from "./hqChangeRead.ts";
import type { Family, MemberState, ScopeKey } from "../model.ts";
import {
  hqAppFamily,
  hqOrganizationFamily,
  hqPersonFamily,
  hqPressFamily,
  hqStatusFamily,
  placementFamily,
} from "./hqNavigation.ts";
import { hqDiscussionFamily } from "./hqDiscussion.ts";
import { hqAppDetailFamily } from "./hqAppDetail.ts";
import { hqProtocolFamily } from "./hqProtocol.ts";
import { hqPictureFamily } from "./hqPicture.ts";
import { hqMateFamily } from "./hqMate.ts";
import { mateAttentionFamily } from "./mateAttention.ts";
import { organizationLocationsFamily } from "./organizationLocations.ts";
import { organizationMembersFamily } from "./organizationMembers.ts";
import { hqVerdictFamily } from "./hqVerdict.ts";
import { mateLinkFamily } from "./mateLink.ts";
import { processFamily } from "./process.ts";
import { projectFamily } from "./project.ts";
import { versionFamily } from "./version.ts";
import { publicRoutingFamily } from "./publicRouting.ts";
import { serviceAgentsFamily } from "./serviceAgents.ts";
import { mateVariablesFamily } from "./mateVariables.ts";
import { projectVariablesFamily } from "./projectVariables.ts";
import { serviceVariableFamily } from "./serviceVariables.ts";
import { serviceFamily } from "./service.ts";
import { usageFamily } from "./usage.ts";
import { usageHistoryFamily } from "./usageHistory.ts";
import type { AnyFamilySpec, DetailListing } from "./spec.ts";

/** The registry, checked once at startup: a family, a scope name and an index name each once. */
export function defineFamilies(
  families: ReadonlyArray<AnyFamilySpec>,
): ReadonlyArray<AnyFamilySpec> {
  const seen = new Set<string>();
  const once = (what: string) => {
    if (seen.has(what)) throw new Error(`The data layer registers ${what} twice.`);
    seen.add(what);
  };
  for (const spec of families) {
    if (spec.sampled !== undefined && (spec.zerops !== undefined || spec.scope.demand !== "detail"))
      throw new Error(`The sampled family ${spec.family} is read on demand, never registered.`);
    once(`family ${spec.family}`);
    once(`scope ${spec.scope.suffix}`);
    for (const listing of spec.details ?? []) once(`scope ${listing.suffix}`);
    for (const index of spec.indexes ?? []) once(`index ${index.name}`);
  }
  return families;
}

export const FAMILIES = defineFamilies([
  mateVcsFamily,
  hqGitCredentialsFamily,
  hqGitCredentialRequestFamily,
  mateAssetUrlFamily,
  mateFilesystemFamily,
  matePullRequestFamily,
  mateReviewFamily,
  mateReviewFileFamily,
  mateWorkspaceFileFamily,
  mateWorkspaceEntriesFamily,
  mateWorkspacePathsFamily,
  mateWorkspaceContentsFamily,
  mateMcpServersFamily,
  mateVcsRefsFamily,

  hqRepositorySourceFamily,
  mateSetupFamily,
  ...Object.values(MATE_FEED_FAMILIES),
  mateActionRequestFamily,
  hqLifecycleFamily,
  projectFamily,
  processFamily,
  versionFamily,
  hqOrganizationFamily,
  hqStatusFamily,
  hqAppFamily,
  placementFamily,
  hqPersonFamily,
  hqPressFamily,
  hqMateFamily,
  serviceFamily,
  mateAttentionFamily,
  hqDiscussionFamily,
  usageFamily,
  usageHistoryFamily,
  organizationMembersFamily,
  organizationLocationsFamily,
  locationLatencyFamily,
  serviceAgentsFamily,
  publicRoutingFamily,
  hqAppDetailFamily,
  hqVerdictFamily,
  mateVariablesFamily,
  mateLinkFamily,
  mateImageFamily,
  hqProtocolFamily,
  hqPictureFamily,
  hqChangeReadFamily,
  projectVariablesFamily,
  serviceVariableFamily,
  databaseFamily,
  databaseSessionFamily,
  mateBrowserFrameFamily,
  mateUpdateAvailabilityFamily,
  mateUpdateRequestFamily,
]);

const byFamily = new Map<string, AnyFamilySpec>(FAMILIES.map((spec) => [spec.family, spec]));
/** What a scope lists: its family, what leaving it means, and the detail listing it is, if one. */
export interface ScopeListing {
  readonly spec: AnyFamilySpec;
  readonly leaving: MemberState;
  readonly detail: DetailListing | null;
}

const bySuffix = new Map<string, ScopeListing>(
  FAMILIES.flatMap((spec) => [
    [spec.scope.suffix, { spec, leaving: spec.scope.leaving, detail: null }] as const,
    ...(spec.details ?? []).map(
      (detail) => [detail.suffix, { spec, leaving: detail.leaving, detail }] as const,
    ),
  ]),
);

export function familySpec(family: Family): AnyFamilySpec {
  const spec = byFamily.get(family);
  if (spec === undefined) throw new Error(`No family ${family} is registered.`);
  return spec;
}

/** What a scope lists. */
export function scopeListing(scope: ScopeKey): ScopeListing {
  const listing = bySuffix.get(scope.split(":")[2] ?? "");
  if (listing === undefined) throw new Error(`No family lists the scope ${scope}.`);
  return listing;
}

/**
 * How a stream is observed: a sampled family's scope is read, never pushed to — on a cadence, or
 * once where time never ages it; the rest realtime.
 */
export function streamMode(key: string): "realtime" | "sampled" | "once" {
  if (key.startsWith("mate:image/")) return "once";
  if (key.startsWith("mate:browser-") || key.startsWith("mate:database-session-"))
    return "realtime";
  const declaredMode = bySuffix.get(key.split(":")[2] ?? "")?.spec.scope.mode;
  if (declaredMode !== undefined) return declaredMode;
  if (key.startsWith("mate:")) return "sampled";
  const sampled = bySuffix.get(key.split(":")[2] ?? "")?.spec.sampled;
  if (sampled === undefined) return "realtime";
  return sampled.freshMs === null ? "once" : "sampled";
}

/** The family whose members a scope lists. */
export const scopeSpec = (scope: ScopeKey): AnyFamilySpec => scopeListing(scope).spec;

/**
 * The family's own scope under the link a scope belongs to: where a member's `listed` is read,
 * whichever listing delivered its value. A detail listing's members are listed in their family's
 * own navigation scope.
 */
export function ownScopeOf(scope: ScopeKey): ScopeKey {
  const { spec, detail } = scopeListing(scope);
  if (detail === null) return scope;
  const [source, linkOwner] = scope.split(":");
  return `${source}:${linkOwner}:${spec.scope.suffix}` as ScopeKey;
}
