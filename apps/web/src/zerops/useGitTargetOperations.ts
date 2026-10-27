/** Mounted Git controls use the account coordinator and the official HQ's offered verdicts. */
import { canonicalHqNavigation } from "@t3tools/client-runtime/data";
import type { HqEnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useAccountOrgId, useProjection } from "./ZeropsAccountData";
import { useAccountOperationsOptional } from "./accountOperations";
import { hqProjectIdOf } from "./hqWrites";
const NONE = Atom.make(null);
export function useGitTargetOperations(appId: string) {
  const orgId = useAccountOrgId();
  const navigation = useProjection(canonicalHqNavigation, orgId, NONE);
  const operations = useAccountOperationsOptional();
  const hqProjectId = orgId === null ? null : hqProjectIdOf(orgId);
  const app = navigation?.structure?.apps.find((row) => row.id === appId);
  const scope = orgId === null || hqProjectId === null ? null : { orgId, appId, hqProjectId };
  const options = {
    orgId: orgId ?? "",
    unobserved: "HQ isn't answering. Check the original operation when it returns.",
  };
  return {
    can: app?.can,
    live: navigation?.live ?? false,
    actions:
      scope === null || operations === null
        ? undefined
        : {
            ...(operations.runGitCandidate === undefined
              ? {}
              : {
                  connect: (repo: string, url: string, token: string) =>
                    operations.runGitCandidate!(
                      { kind: "connect-git-remote", ...scope, repo, url },
                      token,
                    ),
                  replaceToken: (repo: string, token: string) =>
                    operations.runGitCandidate!(
                      { kind: "replace-git-remote-token", ...scope, repo },
                      token,
                    ),
                  reviewAddress: (repo: string, url: string, token: string) =>
                    operations.runGitCandidate!(
                      { kind: "probe-git-remote", ...scope, repo, url },
                      token,
                    ),
                }),
            disconnect: async (repo: string) => {
              await operations.run({ kind: "disconnect-git-remote", ...scope, repo }, options);
            },
            viaApp: async (repo: string, repository: string) => {
              await operations.run(
                { kind: "connect-git-remote-via-app", orgId: scope.orgId, appId, repo, repository },
                options,
              );
            },
            follow: async (repo: string, url: string) => {
              await operations.run(
                { kind: "follow-github-repository", orgId: scope.orgId, appId, repo, url },
                options,
              );
            },
            unfollow: async (repo: string) => {
              await operations.run(
                { kind: "stop-following-github-repository", orgId: scope.orgId, appId, repo },
                options,
              );
            },
            deleteRepository: async (repo: string) => {
              await operations.run(
                { kind: "delete-repository", orgId: scope.orgId, appId, repo },
                options,
              );
            },
            updateAddress: async (repo: string, url: string) => {
              await operations.run(
                { kind: "update-git-remote-address", ...scope, repo, url },
                options,
              );
            },
            removeEnvironment: async (
              environmentId: HqEnvironmentId,
              loseUnresolvedHistory?: true,
            ) => {
              await operations.run(
                {
                  kind: "remove-git-environment",
                  ...scope,
                  environmentId,
                  ...(loseUnresolvedHistory === true ? { loseUnresolvedHistory } : {}),
                },
                options,
              );
            },
            // HQ reads the release's remote branches now; its answer arrives as the app's preflight.
            preflight: async () => {
              await operations.run({ kind: "preflight-git-release", ...scope }, options);
            },
            runAgain: async (environmentId: HqEnvironmentId, repo: string) => {
              await operations.run(
                { kind: "run-git-again", ...scope, environmentId, repo },
                options,
              );
            },
          },
  };
}
