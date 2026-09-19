/**
 * The Git tab, given everything it needs from the account.
 *
 * The tab itself joins a checkout with a forge (`ZeropsGitTab`); this is what
 * tells it *which* forge: the account's Gitea, the group this Mate's project
 * belongs to, and whether this person is the Mate's owner (D11). The group's
 * side — its Gitea org, the declarations that say which environment picks a
 * branch up, the session with Gitea — is the project flow's, read once for
 * the whole account (`ZeropsProjectFlowProvider`); the tab adds only what is
 * this Mate's: its checkouts, and the pull request open from each.
 *
 * Signed out of Gitea, only the checkout half can speak; the tab says so.
 */
import { botDisplayName, readZeropsGroupTags, type GitBlock } from "@t3tools/client-runtime/zerops";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

import { useZeropsProjectFlow } from "../../zerops/projectFlowContext";
import { browserZeropsStorage } from "../../zerops/storage";
import { useZeropsInventory } from "../../zerops/ZeropsInventoryProvider";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { ZeropsGitTab } from "./ZeropsGitTab";

export function ZeropsGitSurface({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const session = useZeropsSessionOptional();
  const inventory = useZeropsInventory();
  const flow = useZeropsProjectFlow();
  const environmentId = threadRef?.environmentId;
  const [projectRef, setProjectRef] = useState<
    { readonly projectId: string; readonly orgId: string } | undefined
  >(undefined);

  useEffect(() => {
    if (environmentId === undefined) return;
    let cancelled = false;
    void lookupEnvironmentProjectRef(browserZeropsStorage, environmentId as EnvironmentId).then(
      (ref) => {
        if (!cancelled) setProjectRef(ref);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  const project = inventory.projects.find((entry) => entry.id === projectRef?.projectId);
  const tags = readZeropsGroupTags(project?.tagList ?? []);
  const groupId = tags.groupId;
  /**
   * The Mate this panel belongs to, by the name every other surface calls it —
   * never its bot login, which is `mate-{projectId}` (`changeAuthorName`).
   */
  const mateName =
    project === undefined
      ? undefined
      : botDisplayName({ bot: tags.bot, projectName: project.name });
  const owner = groupId === undefined ? undefined : flow.slugs.get(groupId);
  const projectFlow = groupId === undefined ? undefined : flow.flows.get(groupId);

  /**
   * Whose Mate this is. A checkout verb runs in the container as the agent's
   * user, so it is the owner's alone — an org admin who can open the Mate is
   * not the person whose agent that is (D11).
   */
  const isOwner =
    project !== undefined &&
    session?.activeOrganization !== null &&
    session?.activeOrganization !== undefined &&
    resolveMateProjectRole({
      project: { id: project.id, clientId: project.clientId, userRoles: project.userRoles },
      viewer: {
        id: session.activeOrganization.id,
        membershipId: session.activeOrganization.membershipId ?? "",
        roleCode: session.activeOrganization.roleCode,
      },
    }) === "OWNER";

  /**
   * The two verbs that run in Gitea as the person (D21), where Gitea's own
   * permissions are the gate: a pull request from the Mate's branch onto the
   * repository's default branch, and its merge. Both are the flow's, so the
   * left menu's timeline moves the moment they settle.
   */
  const onCreatePullRequest = useCallback(
    async (block: GitBlock) => {
      if (owner === undefined) return;
      await flow.createPullRequest(owner, {
        repository: block.repository,
        head: block.branch,
        base: block.baseBranch,
        title: `${block.repository}: ${block.branch}`,
      });
    },
    [flow, owner],
  );

  const onMergePullRequest = useCallback(
    async (block: GitBlock) => {
      if (owner === undefined || block.pullRequestNumber === undefined) return;
      await flow.mergePullRequest(owner, {
        repository: block.repository,
        number: block.pullRequestNumber,
      });
    },
    [flow, owner],
  );

  const openInGitea = useCallback((url: string | undefined) => {
    if (url === undefined) return;
    window.open(url, "_blank", "noopener");
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {flow.trouble === null ? null : (
        <p
          className="px-4 pt-3 text-xs text-[var(--zerops-status-failed)]"
          data-zerops-surface="git-error"
        >
          {flow.trouble}
        </p>
      )}
      <ZeropsGitTab
        declarations={projectFlow?.declarations ?? []}
        giteaOrigin={flow.giteaOrigin}
        isOwner={isOwner}
        mateName={mateName}
        onCreatePullRequest={onCreatePullRequest}
        onMergePullRequest={onMergePullRequest}
        onOpenPullRequest={(block: GitBlock) => openInGitea(block.pullRequestUrl)}
        owner={owner}
        signedIn={flow.signedIn}
        signInTrouble={flow.signInTrouble ?? undefined}
        threadRef={threadRef}
      />
    </div>
  );
}
