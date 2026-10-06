/**
 * The Git tab, given everything it needs from the account.
 *
 * The tab itself joins a checkout with the Mate's change in HQ (`ZeropsGitTab`);
 * this is what tells it *whose*: the group this Mate's project belongs to, and
 * whether this person is the Mate's owner (D11). The group's side — its
 * changes as HQ's stream tells them, the declarations that say which
 * environment picks a branch up — is the project flow's, read for its
 * application while the tab is drawn (`useProjectFlows`); the tab adds only what is this
 * Mate's: its checkouts, and its change in each.
 */
import {
  projectNameInApp,
  readZeropsMembership,
  type GitBlock,
} from "@t3tools/client-runtime/zerops";
import { resolveMateProjectRole } from "@t3tools/client-runtime/zerops/mateAccess";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { useFlowVerbs } from "../../zerops/flowVerbs";
import { useProjectFlows } from "../../zerops/projectFlows";
import { useOpenReview } from "../../zerops/review";
import { useRegistrationRecord } from "../../zerops/registrationRecords";
import { useZeropsInventory } from "../../zerops/ZeropsInventoryProvider";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { ZeropsGitTab } from "./ZeropsGitTab";

export function ZeropsGitSurface({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const navigate = useNavigate();
  const session = useZeropsSessionOptional();
  const inventory = useZeropsInventory();
  const { trouble } = useFlowVerbs();
  const environmentId = threadRef?.environmentId;
  const projectRef = useRegistrationRecord(environmentId)?.projectRef;

  const project = inventory.projects.find((entry) => entry.id === projectRef?.projectId);
  const tags = readZeropsMembership(project);
  const groupId = tags.groupId;
  /**
   * The Mate this panel belongs to, by the name every other surface calls it —
   * never its bot login, which is `mate-{projectId}` (`changeAuthorName`).
   */
  const mateName = project === undefined ? undefined : projectNameInApp(project);
  // The application's flow, held while the panel is drawn.
  const { flows } = useProjectFlows(
    useMemo(() => (groupId === undefined ? [] : [groupId]), [groupId]),
  );
  const projectFlow = groupId === undefined ? undefined : flows.get(groupId);

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

  const openReview = useOpenReview();
  const onReviewPullRequest = useCallback(
    (block: GitBlock, from: HTMLElement) => {
      if (groupId === undefined || block.pullRequestNumber === undefined) return;
      openReview(
        {
          kind: "change",
          groupId,
          repository: block.repository,
          number: block.pullRequestNumber,
        },
        { from },
      );
    },
    [groupId, openReview],
  );

  /**
   * A change opens on its own page, not in Gitea.
   *
   * That page carries the change's conversation, its commits and its *Review*,
   * all of it already drawn from the same reads this panel uses. Sending a
   * person out to a forge they have to sign into, for a change the app can
   * draw, is the long way round to a worse copy (the owner, 2026-09-19: "it
   * linking to a gitea, when we are supposed to already have a panel tab for
   * pull requests").
   */
  const onOpenChange = useCallback(
    (block: GitBlock) => {
      if (groupId === undefined || block.pullRequestNumber === undefined) return;
      void navigate({
        to: "/change/$groupId/$repository/$number",
        params: {
          groupId,
          repository: block.repository,
          number: String(block.pullRequestNumber),
        },
      });
    },
    [groupId, navigate],
  );

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
        appId={groupId}
        changes={projectFlow?.changesKnown === true ? projectFlow : undefined}
        declarations={projectFlow?.declarations ?? []}
        isOwner={isOwner}
        mateName={mateName}
        mateProjectId={project?.id}
        onReviewPullRequest={onReviewPullRequest}
        onOpenChange={onOpenChange}
        threadRef={threadRef}
      />
    </div>
  );
}
