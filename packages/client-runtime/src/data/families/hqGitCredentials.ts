/** Credential metadata is account memory; a revealed one-time password is cleared when its view closes. */
import type { GitCredential, GitCredentialRecord } from "@t3tools/shared/hqGit";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";
export interface GitCredentialsKey {
  readonly orgId: string;
  readonly appId: string;
}
export const gitCredentialsId = (key: GitCredentialsKey): string =>
  JSON.stringify([key.orgId, key.appId]);
export const gitCredentialsScope = (key: GitCredentialsKey): ScopeKey =>
  `hq:${key.orgId}:git-credentials:${gitCredentialsId(key)}`;
export interface GitCredentialRequest {
  readonly requestId: string;
  readonly credential: GitCredential | null;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqGitCredentials: ReadonlyArray<GitCredentialRecord>;
    readonly hqGitCredentialRequest: GitCredentialRequest;
  }
}
export const hqGitCredentialsFamily: FamilySpec<"hqGitCredentials"> = {
  family: "hqGitCredentials",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "git-credentials",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
export const hqGitCredentialRequestFamily: FamilySpec<"hqGitCredentialRequest"> = {
  family: "hqGitCredentialRequest",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "git-credential-request",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
