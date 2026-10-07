/** Repository bytes are scoped to the requested repository, revision and path. */
import type { RepositorySource } from "@t3tools/shared/hqGit";
import type { RepositoryTarget } from "../../zerops/hq/repositoryStore.ts";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqRepositorySource: RepositorySource;
  }
}
export interface RepositorySourceKey {
  readonly orgId: string;
  readonly target: RepositoryTarget;
}
export const repositorySourceId = ({ orgId, target }: RepositorySourceKey): string =>
  JSON.stringify([
    orgId,
    target.appId,
    target.repo,
    target.query.rev ?? null,
    target.query.path,
    target.query.kind,
  ]);
export const repositorySourceScope = (key: RepositorySourceKey): ScopeKey =>
  `hq:${key.orgId}:repository-source:${repositorySourceId(key)}`;
export const hqRepositorySourceFamily: FamilySpec<"hqRepositorySource"> = {
  family: "hqRepositorySource",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "repository-source",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
