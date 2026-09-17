/**
 * The Git tab, given everything it needs from the account.
 *
 * The tab itself joins a checkout with a forge (`ZeropsGitTab`); this is what
 * tells it *which* forge: the account's Gitea, the group this Mate's project
 * belongs to, and whether this person is the Mate's owner (D11). All of it
 * comes from the providers the whole app already mounts — the session, the
 * inventory and the registry — so opening the tab costs the group repo and the
 * version of each service its environments run (`groupDeploys.ts`), which is
 * the read the projects screen already performs for every group.
 *
 * Signed out of Gitea, only the checkout half can speak; the tab says so and
 * offers the way in, which is the broker's consent page (`giteaSession.ts`).
 */
import {
  environmentRow,
  readZeropsGroupTags,
  releaseDeploys,
  releaseEntriesFromStage,
  releaseMessage,
  releaseOffer,
  releaseTagName,
  rollbackTo,
  summarizeEnvironmentServices,
  type GitBlock,
} from "@t3tools/client-runtime/zerops";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { findAccountGitea } from "../../zerops/giteaProject";
import {
  ensureGiteaSession,
  giteaClientFor,
  giteaSignInMessage,
  useGiteaSignedIn,
} from "../../zerops/giteaSession";
import { browserZeropsStorage } from "../../zerops/storage";
import { useZeropsDeployedVersionReader } from "../../zerops/useZeropsDeployedVersion";
import { useZeropsGroupDeploys, type ZeropsDeployGroup } from "../../zerops/useZeropsGroupDeploys";
import { useZeropsGroupRepo } from "../../zerops/useZeropsGroupRepo";
import { registryGroupSlug, useZeropsRegistry } from "../../zerops/useZeropsRegistry";
import { useZeropsInventory } from "../../zerops/ZeropsInventoryProvider";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { ZeropsGitTab } from "./ZeropsGitTab";
import type { ZeropsGitRelease } from "./ZeropsGitPanel";

/** The group repo, whose tags are the releases. */
const GROUP_REPOSITORY = "group";

/** How long to wait before asking a Gitea that is still setting up again. */
const GITEA_RETRY_MS = 20_000;

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
  const signedIn = useGiteaSignedIn(giteaOrigin);
  const zeropsClient = session?.client;
  const orgId = projectRef?.orgId;

  /**
   * Signed in to Mate is signed in to Gitea (D21). The token that acts as
   * the person comes from the org's broker on a throwaway, the same proof the
   * door takes — nothing to click. A Gitea still setting up is asked again in
   * a while; a refusal is said once and left.
   */
  useEffect(() => {
    if (
      signedIn ||
      giteaOrigin === undefined ||
      brokerOrigin === undefined ||
      zeropsClient === undefined ||
      orgId === undefined
    ) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      void ensureGiteaSession({
        giteaOrigin,
        brokerOrigin,
        clientId: orgId,
        platform: zeropsThrowawayPlatform(zeropsClient),
      })
        .then(() => {
          if (!cancelled) setTrouble(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          const failure = giteaSignInMessage(cause);
          if (failure.pending) {
            timer = setTimeout(attempt, GITEA_RETRY_MS);
            return;
          }
          setTrouble(failure.message);
        });
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [signedIn, giteaOrigin, brokerOrigin, zeropsClient, orgId]);

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
  /**
   * The group's Zerops side: every project the registry tags into this group,
   * with the runtime services a version read is issued for. The declarations
   * decide which of them is an environment (`groupDeploys.ts`); the account
   * only says what is there.
   */
  const deployGroups = useMemo<ReadonlyArray<ZeropsDeployGroup>>(() => {
    if (groupId === undefined || owner === undefined) return [];
    return [
      {
        groupId,
        slug: owner,
        projects: inventory.projects
          .filter((entry) => readZeropsGroupTags(entry.tagList ?? []).groupId === groupId)
          .map((entry) => {
            const services = inventory.services.get(entry.id);
            return {
              projectId: entry.id,
              name: entry.name,
              services:
                services?.status === "resolved"
                  ? summarizeEnvironmentServices(services.services).deployable
                  : [],
            };
          }),
      },
    ];
  }, [groupId, inventory.projects, inventory.services, owner]);

  /**
   * What each environment of the group runs — the projects screen's read,
   * performed here for the one group this Mate belongs to (`groupDeploys.ts`).
   * It is what *Release* compares and what puts a commit on the rows below:
   * the group repo can say what feeds an environment and never what it runs.
   */
  const readVersion = useZeropsDeployedVersionReader();
  const deploys = useZeropsGroupDeploys({
    groups: deployGroups,
    giteaOrigin,
    readVersion,
    enabled: signedIn,
  });
  const deployed = groupId === undefined ? undefined : deploys.get(groupId);
  const deployedCommits = useMemo(
    () => releaseDeploys(deployed?.environments ?? []),
    [deployed?.environments],
  );
  const release = useMemo(
    () =>
      releaseOffer({
        mayRelease,
        stage: deployedCommits.stage,
        production: deployedCommits.production,
        tags: group.tags,
      }),
    [deployedCommits, group.tags, mayRelease],
  );

  /**
   * The rows themselves: the group repo's until the versions land, and the
   * account's afterwards. Both are built from the same declarations in the
   * same order, so a row never moves — it gains the commit it runs.
   */
  const environments = useMemo(
    () =>
      deployed === undefined || deployed.environments.length === 0
        ? group.environments
        : deployed.environments.map((entry) => environmentRow(entry)),
    [deployed, group.environments],
  );

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
    const entries = releaseEntriesFromStage(deployedCommits.stage);
    if (entries.length === 0) return;
    void tagAs(releaseTagName(release.suggestion.replace(/^v/u, "")), releaseMessage(entries));
  }, [deployedCommits, release.suggestion, tagAs]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {trouble === null ? null : (
        <p
          className="px-4 pt-3 text-xs text-[var(--zerops-status-failed)]"
          data-zerops-surface="git-error"
        >
          {trouble}
        </p>
      )}
      <ZeropsGitTab
        declarations={group.declarations}
        giteaOrigin={giteaOrigin}
        group={{
          environments,
          releases: group.releases,
          recipeChanges: group.recipeChanges,
          release,
        }}
        isOwner={isOwner}
        onOpenPullRequest={(block: GitBlock) => openInGitea(block.pullRequestUrl)}
        onOpenRecipeChange={(change) => openInGitea(change.url)}
        onRelease={onRelease}
        onRollBack={onRollBack}
        owner={owner}
        signedIn={signedIn}
        threadRef={threadRef}
      />
    </div>
  );
}
