/**
 * The Git tab, given everything it needs from the account.
 *
 * The tab itself joins a checkout with the Mate's change in HQ (`ZeropsGitTab`);
 * this is what tells it *whose*: the group this Mate's project belongs to, and
 * whether this person is the Mate's owner (D11). The group's side — its
 * changes as HQ's stream tells them, the declarations that say which
 * environment picks a branch up — is the project flow's, read for its
 * application while the tab is drawn (`useProjectFlows`); the tab adds only what is this
 * Mate's: its checkouts, and its change in each. Where that work goes — the project's places and
 * what waits for production — and each repository's state on GitHub come from the same reads the
 * project's pages draw (`useMatePanelProject`, the flow's repositories).
 */
import {
  projectNameInApp,
  readZeropsMembership,
  type FlowPullRequest,
  type GitBlock,
} from "@t3tools/client-runtime/zerops";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { HQ_REMOTE_WRITE_VERB, hqOffer } from "@t3tools/shared/hqOffers";
import { usePlatformCapabilities } from "../../zerops/usePlatformCapabilities";
import { useHqProjectPerson, zeropsMateOwnerOf } from "../../zerops/useZeropsMateOwners";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { useHqAppDetailHold } from "../../zerops/useHqAppDetail";
import { useFlowVerbs } from "../../zerops/flowVerbs";
import { useProjectFlows } from "../../zerops/projectFlows";
import { useOpenReview } from "../../zerops/review";
import { useZeropsEnvironmentProject } from "../../zerops/useZeropsEnvironmentProject";
import { useZeropsInventory } from "../../zerops/ZeropsInventoryProvider";
import { useZeropsSessionOptional } from "../../zerops/ZeropsSessionProvider";
import { useGitMirrorApps } from "../../zerops/useGitMirrorApps";
import { useGitTargetOperations } from "../../zerops/useGitTargetOperations";
import { useNowMs } from "../../zerops/useNowMs";
import { GitMirrorDialog } from "./GitMirrorDialog";
import { mirrorAuthorityLine, repoState } from "./gitMirror.logic";
import { landedChangeWords } from "./matePanels.logic";
import { MateFace } from "./primitives";
import { useMateOnPanel } from "./useMateOnPanel";
import { useMatePanelProject } from "./useMatePanelProject";
import { ZeropsGitTab } from "./ZeropsGitTab";

export function ZeropsGitSurface({ threadRef }: { readonly threadRef: ScopedThreadRef | null }) {
  const session = useZeropsSessionOptional();
  const inventory = useZeropsInventory();
  const { trouble } = useFlowVerbs();
  const environmentId = threadRef?.environmentId;
  const projectRef = useZeropsEnvironmentProject(environmentId ?? null);

  const mateProject = inventory.projects.find((entry) => entry.id === projectRef?.projectId);
  const tags = readZeropsMembership(mateProject);
  const groupId = tags.groupId;
  /**
   * The Mate this panel belongs to, by the name every other surface calls it —
   * never its bot login, which is `mate-{projectId}` (`changeAuthorName`).
   */
  const mateName = mateProject === undefined ? undefined : projectNameInApp(mateProject);
  useHqAppDetailHold(groupId === undefined ? [] : [groupId]);
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
  const capabilities = usePlatformCapabilities(environmentId ?? null);
  const people = useHqProjectPerson(projectRef?.projectId ?? "");
  const owner = zeropsMateOwnerOf(people?.owner, session?.user?.id);
  const isOwner = capabilities.operate && owner?.isViewer === true;

  const project = useMatePanelProject(environmentId);
  const { mate } = useMateOnPanel(environmentId);
  const mateFace =
    mate === undefined ? undefined : (
      <MateFace shape={mate.shape} size={20} state={mate.face} tint={mate.tint} />
    );

  /**
   * A change opens its sheet from its row, wherever it stands: its review while open — the one
   * door to merging (pass 16, R1) — and what it became once landed. Never Gitea, never a forge a
   * person has to sign into for a change the app can draw (the owner, 2026-09-19).
   */
  const openReview = useOpenReview();
  const onOpenChange = useCallback(
    (block: GitBlock, from: HTMLElement) => {
      if (groupId === undefined || block.pullRequestNumber === undefined) return;
      openReview(
        {
          kind: "change",
          groupId,
          repository: block.hqRepository,
          number: block.pullRequestNumber,
        },
        { from },
      );
    },
    [groupId, openReview],
  );
  const landedWords = useCallback(
    (change: FlowPullRequest) =>
      projectFlow === undefined ? undefined : landedChangeWords(projectFlow, change),
    [projectFlow],
  );

  // Each repository's state on GitHub, in the words its row on the project's page says it.
  // Kept by the flow's own lists, so a render that reads nothing new words nothing again.
  const listed = projectFlow?.codeRepos ?? projectFlow?.repos;
  const repos = useMemo(() => listed?.filter((entry) => entry.name !== RECIPE_REPO), [listed]);
  const git = useGitTargetOperations(groupId ?? "");
  const writes =
    mirrorAuthorityLine(
      hqOffer(git.can, HQ_REMOTE_WRITE_VERB, {
        current: git.live,
        unavailableSince: git.live ? null : 0,
      }),
    ) === null;
  // The apps are asked only where a repository's stop is told by them.
  const mirror = useGitMirrorApps(
    (repos ?? []).some(
      (entry) => entry.remote?.via === "app" && entry.remote.invalidSince !== null,
    ),
  );
  const now = useNowMs();
  const orgName = session?.activeOrganization?.name;
  const github = useCallback(
    (repository: string) => {
      const entry = repos?.find((candidate) => candidate.name === repository);
      return entry === undefined
        ? undefined
        : repoState(entry, {
            apps: mirror.apps?.kind === "ready" ? mirror.apps : null,
            orgName,
            now,
          });
    },
    [mirror.apps, now, orgName, repos],
  );
  const [connecting, setConnecting] = useState<string | null>(null);

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
        github={github}
        isOwner={isOwner}
        landedWords={landedWords}
        mateFace={mateFace}
        mateName={mateName}
        mateProjectId={mateProject?.id}
        onConnect={writes && project !== undefined ? setConnecting : undefined}
        onOpenChange={onOpenChange}
        project={project}
        threadRef={threadRef}
      />
      {connecting === null || groupId === undefined || project === undefined ? null : (
        <GitMirrorDialog
          appId={groupId}
          appName={project.name}
          key={connecting}
          onClose={() => setConnecting(null)}
          repo={connecting}
        />
      )}
    </div>
  );
}
