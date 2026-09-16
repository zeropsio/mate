/**
 * The Git tab, given everything it needs from the account.
 *
 * The tab itself joins a checkout with a forge (`ZeropsGitTab`); this is what
 * tells it *which* forge: the account's Gitea, the group this Mate's project
 * belongs to, and whether this person is the Mate's owner (D11). All of it
 * comes from the providers the whole app already mounts — the session, the
 * inventory and the registry — so opening the tab costs one group-repo read
 * and nothing else.
 *
 * Signed out of Gitea, only the checkout half can speak; the tab says so and
 * offers the way in, which is the broker's consent page (`giteaSession.ts`).
 */
import {
  compareForRelease,
  readZeropsGroupTags,
  releaseEntriesFromStage,
  releaseGate,
  releaseMessage,
  releaseTagName,
  rollbackTo,
  suggestReleaseTags,
  type GitBlock,
} from "@t3tools/client-runtime/zerops";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { findAccountGitea } from "../../zerops/giteaProject";
import { giteaClientFor, hasGiteaSession, startGiteaSignIn } from "../../zerops/giteaSession";
import { browserZeropsStorage } from "../../zerops/storage";
import { useZeropsGroupRepo } from "../../zerops/useZeropsGroupRepo";
import { registryGroupSlug, useZeropsRegistry } from "../../zerops/useZeropsRegistry";
import { useZeropsInventory } from "../../zerops/ZeropsInventoryProvider";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { ZeropsGitTab } from "./ZeropsGitTab";
import type { ZeropsGitRelease } from "./ZeropsGitPanel";

/** The group repo, whose tags are the releases. */
const GROUP_REPOSITORY = "group";

export function ZeropsGitSurface({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const session = useZeropsSessionOptional();
  const inventory = useZeropsInventory();
  const environmentId = threadRef?.environmentId;
  const [projectRef, setProjectRef] = useState<
    { readonly projectId: string; readonly orgId: string } | undefined
  >(undefined);
  const [generation, setGeneration] = useState(0);
  const [trouble, setTrouble] = useState<string | null>(null);

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

  const accountGitea = findAccountGitea(inventory, projectRef?.orgId);
  const giteaOrigin = accountGitea?.state.url;
  const brokerOrigin = accountGitea?.state.brokerUrl;
  const registry = useZeropsRegistry({
    giteaProjectId: accountGitea?.projectId,
    enabled: session !== null,
  });
  const project = inventory.projects.find((entry) => entry.id === projectRef?.projectId);
  const groupId = readZeropsGroupTags(project?.tagList ?? []).groupId;
  const owner = registryGroupSlug(registry.registry, groupId);
  const signedIn = giteaOrigin !== undefined && hasGiteaSession(giteaOrigin);

  const group = useZeropsGroupRepo({ giteaOrigin, owner, generation, enabled: signedIn });

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
   * Whether this person may tag. The app's own gate — Gitea's tag protection
   * is the one that decides, and a `403` from it says the same sentence
   * (`release.ts`). Until the production project is in reach, the group's
   * releasers are the org's admins, which is what the role function answers.
   */
  const mayRelease =
    session?.activeOrganization?.roleCode === "ADMIN" ||
    session?.activeOrganization?.roleCode === "OWNER";
  // What a release would list. The stage's commits are the account's to prove
  // (`groupDeploys.ts`) and the tab does not hold that read, so until it does
  // the gate says there is nothing to release rather than tagging a guess.
  const stageCommits = useMemo(() => new Map<string, string>(), []);
  const release = useMemo(() => {
    const entries = releaseEntriesFromStage(stageCommits);
    return {
      gate: releaseGate({ mayRelease, entries }),
      suggestion: suggestReleaseTags(group.tags).patch,
      comparison: compareForRelease({ stage: stageCommits, production: group.productionCommits }),
    };
  }, [group.productionCommits, group.tags, mayRelease, stageCommits]);

  const tagAs = useCallback(
    async (tag: string, message: string) => {
      if (giteaOrigin === undefined || owner === undefined) return;
      const client = giteaClientFor(giteaOrigin);
      if (client === null) return;
      const head = await client.getBranch(owner, GROUP_REPOSITORY, "main").catch(() => undefined);
      const target = head?.commit?.id;
      if (target === undefined) {
        setTrouble("The group repository has no main to tag.");
        return;
      }
      try {
        await client.createTag(owner, GROUP_REPOSITORY, { tag, target, message });
        setGeneration((current) => current + 1);
        setTrouble(null);
      } catch (cause) {
        // Gitea's tag protection is the real gate; a refusal from it means
        // this person is not a releaser, whatever the mirror said.
        setTrouble(
          cause instanceof Error && "status" in cause && cause.status === 403
            ? "Only releasers can tag."
            : "Gitea would not create the tag.",
        );
      }
    },
    [giteaOrigin, owner],
  );

  const onRelease = useCallback(() => {
    const entries = releaseEntriesFromStage(stageCommits);
    if (entries.length === 0) return;
    void tagAs(releaseTagName(release.suggestion.replace(/^v/u, "")), releaseMessage(entries));
  }, [release.suggestion, stageCommits, tagAs]);

  const onRollBack = useCallback(
    (earlier: ZeropsGitRelease) => {
      void (async () => {
        if (giteaOrigin === undefined || owner === undefined) return;
        const client = giteaClientFor(giteaOrigin);
        if (client === null) return;
        const tags = await client.listTags(owner, GROUP_REPOSITORY).catch(() => []);
        const found = tags.find((entry) => entry.name === earlier.tag);
        const plan =
          found === undefined
            ? undefined
            : rollbackTo({
                tag: found.name,
                message: found.message ?? "",
                existingTags: tags.map((entry) => entry.name),
              });
        if (plan === undefined) {
          setTrouble(`${earlier.tag} does not list commits this build can read.`);
          return;
        }
        await tagAs(plan.tag, plan.message);
      })();
    },
    [giteaOrigin, owner, tagAs],
  );

  const openInGitea = useCallback((url: string | undefined) => {
    if (url === undefined) return;
    window.open(url, "_blank", "noopener");
  }, []);

  const signIn = useCallback(() => {
    if (giteaOrigin === undefined || brokerOrigin === undefined) return;
    void startGiteaSignIn({
      giteaOrigin,
      brokerOrigin,
      returnTo: `${window.location.pathname}${window.location.search}`,
    }).catch((cause: unknown) => {
      setTrouble(cause instanceof Error ? cause.message : "Gitea sign-in could not start.");
    });
  }, [brokerOrigin, giteaOrigin]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {trouble === null ? null : (
        <p
          className="px-4 pt-3 text-xs text-[var(--zerops-status-failed-text)]"
          data-zerops-surface="git-error"
        >
          {trouble}
        </p>
      )}
      <ZeropsGitTab
        declarations={group.declarations}
        giteaOrigin={giteaOrigin}
        group={{
          environments: group.environments,
          releases: group.releases,
          recipeChanges: group.recipeChanges,
          release,
        }}
        isOwner={isOwner}
        onOpenPullRequest={(block: GitBlock) => openInGitea(block.pullRequestUrl)}
        onOpenRecipeChange={(change) => openInGitea(change.url)}
        onRelease={onRelease}
        onRollBack={onRollBack}
        onSignIn={signIn}
        owner={owner}
        // Proved by the credential reconcile's receipt, never by a key's
        // presence — and `undefined` until it has answered (guide 4.5).
        provisioned={undefined}
        remoteReachable={useMemo(() => new Map<string, boolean>(), [])}
        signedIn={signedIn}
        threadRef={threadRef}
      />
    </div>
  );
}
