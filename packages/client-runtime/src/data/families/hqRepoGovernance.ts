import type { RepoGovernanceEntry } from "../../zerops/hq/client.ts";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { HqAppKey } from "../projections/hqAppDetail.ts";
import type { HqAppDetailValue } from "./hqAppDetail.ts";
import type { FamilySpec } from "./spec.ts";

export const repoGovernanceId = ({ orgId, appId }: HqAppKey) => JSON.stringify([orgId, appId]);
export const repoGovernanceScope = (key: HqAppKey): ScopeKey =>
  `hq:${key.orgId}:repo-governance:${repoGovernanceId(key)}`;
export const repoGovernanceLink = (key: HqAppKey): LinkKey =>
  `hq:repo-governance-${encodeURIComponent(repoGovernanceId(key))}`;

/** Only a different remote or its first sync changes which rules the screen is asking about. */
export function repoGovernanceSubject(detail: HqAppDetailValue | undefined) {
  if (detail?.kind !== "repos") return [];
  return detail.value
    .flatMap(({ name, remote, mirror }) =>
      remote?.via === "app" ? [[name, remote.url, mirror?.syncedAt != null] as const] : [],
    )
    .sort(([left], [right]) => left.localeCompare(right));
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqRepoGovernance: ReadonlyArray<RepoGovernanceEntry>;
  }
}

export const hqRepoGovernanceFamily: FamilySpec<"hqRepoGovernance"> = {
  family: "hqRepoGovernance",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "repo-governance",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
