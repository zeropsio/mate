/**
 * A project group's page, and one stop's, in place of the thread.
 *
 * The left menu draws a project as a timeline of where work *is*. These are
 * the same drawing with room: the group's over *time*, a stop's around the one
 * commit it happens to be running. They mount under the chat layout and stand
 * in the frame /zerops stands in, so the menu stays put and only the pane changes —
 * "I imagine the group and the prod/stage detail to be in place of the chat"
 * (the owner, 2026-09-19).
 *
 * Nothing here is fetched twice: the flow is the account-wide read every
 * Zerops surface shares (`projectFlowContext`), and the history is the one
 * read that is opened rather than polled (`useZeropsRepositoryCommits`).
 *
 * Structural only — what a row says is `projectFlow.ts`'s and
 * `groupHistory.ts`'s (rule R5).
 */
import {
  assignCandidateMateTints,
  botDisplayName,
  buildZeropsGroupTree,
  hasMate,
  changeAskLabel,
  changeAuthorName,
  changeConversationCount,
  changeRemarks,
  changeState,
  changeSubtitle,
  changeVerdict,
  historyAge,
  deployWord,
  environmentNameUnderGroup,
  flowVerbKey,
  flowVerbLabel,
  preferredMateTint,
  readZeropsGroupTags,
  PROJECT_ALL_CLEAR,
  projectAttention,
  releaseContentsCommits,
  releaseContentsSummary,
  releasesCarried,
  type GiteaCommit,
  type ReleaseContentsSummary,
  resolvePrimaryConversation,
  shortCommit,
  sidebarChangeLabel,
  type ChangeRemark,
  type ChangeVerdict,
  type ProjectAttentionItem,
  type ZeropsPublicRoute,
  type ProjectAttentionKind,
  type EnvironmentRow,
  type FlowPullRequest,
  type FlowReleaseRow,
  type GroupEnvironmentTier,
  type GroupRowTone,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsRouteOffer,
} from "@t3tools/client-runtime/zerops";
import {
  DEPLOYS_ASIDE,
  earlierReleasesLabel,
  NONE_YET,
  NOT_PUBLIC_YET,
  NOTHING_DEPLOYED,
  serviceBuildToggleLabel,
  serviceRows,
  stopCardTitle,
  stopFailedDeploy,
  stopMetaLine,
  stopVerdict,
  stopView,
  type Deployment,
  type StopServiceRow,
  type StopVerdict,
  type StopView,
} from "@t3tools/client-runtime/zerops/flow";
import type { KnownAffordance, Shown } from "@t3tools/client-runtime/zerops/knowledge";
import {
  candidatesNotice,
  findCandidate,
  heldCandidates,
  type CandidatesNotice,
} from "@t3tools/client-runtime/zerops/projections";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";

import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { compactSidebarTimeLabel } from "../Sidebar.logic";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { mateFaceFor } from "~/zerops/agentActivity";
import { useZeropsAgentActivity } from "~/zerops/useZeropsAgentActivity";
import { useAskMate } from "~/zerops/useAskMate";
import { useNowMs } from "~/zerops/useNowMs";
import {
  useZeropsLandedChange,
  type ZeropsLandedChangeState,
} from "~/zerops/useZeropsLandedChange";
import { giteaSessionLogin } from "~/zerops/accountGiteaSessions";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsChangeComments } from "~/zerops/useZeropsChangeComments";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import type { ZeropsChangeComments } from "~/zerops/useZeropsChangeComments";
import type { ZeropsCommitDetailResult } from "~/zerops/useZeropsCommitDetail";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";
import { useZeropsCommitDetailReader } from "~/zerops/useZeropsCommitDetail";
import type { ZeropsDeployRun, ZeropsDeployRunRequest } from "~/zerops/useZeropsDeployRun";
import { useZeropsDeployRun } from "~/zerops/useZeropsDeployRun";
import {
  useZeropsChangeCommits,
  useZeropsRepositoriesCommits,
  useZeropsRepositoryCommits,
} from "~/zerops/useZeropsRepositoryCommits";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { ZeropsOrganizationSwitcher } from "./ZeropsOrganizationScope";
import { ZeropsAskDialog } from "./ZeropsAskDialog";
import { ZeropsChangeConversation } from "./ZeropsChangeConversation";
import { failedJob, runAgainLabel, ZeropsDeployRunView } from "./ZeropsDeployRun";
import { ZeropsRoleTag } from "./ZeropsEnvironmentRow";
import { ZeropsMergeDialog } from "./ZeropsMergeDialog";
import { ZeropsReleaseDialog } from "./ZeropsReleaseDialog";
import { ZeropsHistoryView, type HistoryNames } from "./ZeropsHistoryView";
import {
  FlatCard,
  MateFace,
  MicroLabel,
  StatusDot,
  VERDICT_BORDER_CLASS,
  VerdictPanel,
} from "./primitives";
import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";
import { ZeropsProjectMenu } from "./ZeropsProjectMenu";
import type { ZeropsMenuAction } from "./ZeropsProjectMenu";
import { ZeropsReleaseRows } from "./ZeropsReleaseRows";
import { ZeropsRenameDialog } from "./ZeropsRenameDialog";
import { ZeropsStopMenu } from "./ZeropsStopMenu";
import { useRenameGroup } from "~/zerops/useRenameGroup";
import { useEnableRoute } from "~/zerops/useEnableRoute";
import { useMateActions } from "~/zerops/useMateActions";
import { useZeropsContainers } from "~/zerops/zeropsContainers";
import { useZeropsRegistry } from "~/zerops/useZeropsRegistry";
import { findInventoryProjectRef, withheldProjectNotice } from "~/zerops/inventoryContext";
import { useStopServices } from "~/zerops/accountForge";
import { useZeropsInventory } from "~/zerops/ZeropsInventoryProvider";
import { useAccountGitea } from "~/zerops/giteaProject";

/** A stop's tone as a dot's. Neutral wears none: nothing has been deployed. */
const STOP_DOT_TONE: Record<GroupRowTone, ServiceStatusToneId | undefined> = {
  good: "ok",
  pending: "busy",
  bad: "failed",
  neutral: undefined,
};

/**
 * The group behind a route parameter, from the same derivation the menu names
 * it by (`buildZeropsGroupTree`).
 *
 * A page titled by its route parameter shows a raw id; a page that wants to
 * *rename* the project needs the group itself, because the name lives on every
 * environment in it.
 */
function useGroup(groupId: string): ZeropsGroup | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(
    // Order is irrelevant here — a lookup by groupId, not a listing.
    () =>
      buildZeropsGroupTree(heldCandidates(listing).rows, { order: "name" }).groups.find(
        (entry) => entry.group.groupId === groupId,
      )?.group,
    [groupId, listing],
  );
}

/**
 * What a stop says in place of its content while the grant withholds its
 * project (DESIGN §3.4), and the stops whose content may be read — what the
 * attention panel is drawn from.
 */
function useWithheldStops(environments: ReadonlyArray<EnvironmentRow> | undefined): {
  readonly withheldNotice: (projectId: string) => string | null;
  readonly shown: ReadonlyArray<EnvironmentRow>;
} {
  const inventory = useZeropsInventory();
  const withheldNotice = useCallback(
    (projectId: string) => withheldProjectNotice(inventory, projectId),
    [inventory],
  );
  const shown = useMemo(
    () =>
      environments === undefined
        ? EMPTY_STOPS
        : environments.filter((environment) => withheldNotice(environment.projectId) === null),
    [environments, withheldNotice],
  );
  return { withheldNotice, shown };
}

/** What the group is called — never the raw group id. */
function useGroupName(groupId: string): string | undefined {
  return useGroup(groupId)?.name;
}

/**
 * Every Mate on this project, with everything that can be done to it.
 *
 * The same `useMateActions` the projects screen uses, so *Rename Mate*,
 * *Restart*, *Hand this Mate over* and the rest are one definition — this page
 * listed its Mates and could do nothing to any of them (the owner,
 * 2026-09-19). The registry and the health read are taken here and handed
 * over: both hold per-instance state, and a second reader is a second poll.
 *
 * The update verbs are not among them: they belong to the server a Mate runs,
 * and `ZeropsMateUpdateControl` is what holds that answer. It rides in as the
 * menu's extra entries, mounted once per Mate, exactly as the Mate card does
 * it — so the same *Check for updates* is offered on both.
 */
function useMateMenus(): {
  readonly menuForMate: (projectId: string) => React.ReactNode;
  readonly dialogs: React.ReactNode;
  readonly trouble: string | null;
} {
  const { activeOrganization, status } = useZeropsSession();
  const { listing } = useZeropsCandidates();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
  const { serverVersions } = useZeropsContainers();
  const giteaProjectId = useAccountGitea(activeOrganization?.id)?.projectId;
  const registry = useZeropsRegistry({ giteaProjectId, enabled: status === "signed-in" });
  const actions = useMateActions({ registry, serverVersions });
  const menuForMate = useCallback(
    (projectId: string) => {
      const found = findCandidate(listing, (entry) => entry.project.id === projectId);
      if (found.kind !== "found") return null;
      const candidate = found.row;
      const tags = readZeropsGroupTags(candidate.project.tagList);
      const menu = (extra: ReadonlyArray<ZeropsMenuAction>) => {
        const entries = actions.actionsFor(candidate, tags, extra);
        // A menu with nothing in it is a button that opens an empty box.
        if (entries.length === 0) return null;
        return (
          <ZeropsProjectMenu
            actions={entries}
            label={`More for ${candidate.project.name}`}
            routes={candidate.routes}
          />
        );
      };
      // *Check for updates* and *Update to x.y.z* are the server's own verbs,
      // and the control that reads that server is a mount per Mate — the same
      // one the Mate card uses, so a check started here and a check started
      // there are the same check (`useZeropsMateUpdate` keys by environment).
      if (candidate.group !== "connected" || candidate.environmentId === undefined) return menu([]);
      return (
        <ZeropsMateUpdateControl environmentId={candidate.environmentId}>
          {({ menuActions }) => menu(menuActions)}
        </ZeropsMateUpdateControl>
      );
    },
    [actions, listing],
  );
  return { menuForMate, dialogs: actions.dialogs, trouble: actions.trouble };
}

/**
 * The project's own quiet actions, on its own page.
 *
 * *Rename project* had lived only on the projects screen, so the page whose
 * whole subject is this project could not name it (the owner, 2026-09-19:
 * "why isn't there options to rename group?"). The write is `useRenameGroup`'s,
 * shared with that screen, so one rename means one thing wherever it is
 * offered.
 */
function useGroupActions(groupId: string): {
  readonly menu: React.ReactNode;
  readonly trouble: string | null;
} {
  const group = useGroup(groupId);
  const [renaming, setRenaming] = useState(false);
  const rename = useRenameGroup();
  if (group === undefined) return { menu: null, trouble: rename.trouble };
  const unnamed = group.nameSource === "id";
  return {
    trouble: rename.trouble,
    menu: (
      <>
        <ZeropsProjectMenu
          actions={[
            {
              id: "rename-group",
              label: unnamed ? "Name this project" : "Rename project",
              onSelect: () => {
                setRenaming(true);
              },
              disabled: rename.renaming,
            },
          ]}
          label={`More for ${group.name}`}
        />
        {renaming ? (
          <ZeropsRenameDialog
            description="The name is written onto every environment in the project."
            initialValue={unnamed ? "" : group.name}
            key={`rename-group:${group.groupId}`}
            label="Project name"
            onCancel={() => {
              setRenaming(false);
            }}
            onOpenChange={(open) => {
              if (!open) setRenaming(false);
            }}
            onSubmit={(name) => {
              setRenaming(false);
              void rename.rename(group, name);
            }}
            open
            submitLabel="Rename"
            title={unnamed ? "Name this project" : "Rename the project"}
            validate={(value) =>
              value.trim().length === 0 ? "Give the project a name." : undefined
            }
          />
        ) : null}
      </>
    ),
  };
}

/** Every environment of a group, by the whole sha it runs. */
function deployedShas(environments: ReadonlyArray<EnvironmentRow>): ReadonlyMap<string, string> {
  const deployed = new Map<string, string>();
  for (const environment of environments) {
    const sha = environment.version.sha;
    if (sha !== undefined) deployed.set(environment.name, sha);
  }
  return deployed;
}

/**
 * The repository a group's history is read from: the one its environments are
 * built from. Never guessed from a hostname — that address 404s.
 */
function groupRepository(environments: ReadonlyArray<EnvironmentRow>): string | undefined {
  for (const environment of environments) {
    if (environment.versionRepository !== undefined) return environment.versionRepository;
  }
  return undefined;
}

/**
 * What a history may call things: a Mate by its name rather than its bot
 * login, and a stop without the project's name in front of it.
 */
function useHistoryNames(groupName: string | undefined): HistoryNames {
  const flowValue = useZeropsProjectFlowOptional();
  const mateNames = flowValue?.mateNames;
  return useMemo(() => ({ mateNames, groupName }), [mateNames, groupName]);
}

/** How "Who is on it" names the listing it is drawn from, while that listing cannot say "none". */
const GROUP_MATES_SURFACE = {
  subject: "who is on this project",
  entity: "project",
  source: "zerops",
  checking: "Checking who is on it…",
  negative: null,
} as const;

/**
 * Every Mate on a project, as its page shows them, and what the section says
 * in place of "no Mate" until the listing may say it (DESIGN §3.4): a
 * placeholder while it is unread, its cause while its read failed, "Still
 * reading…" over the Mates read of a listing known in part.
 *
 * Read from the same three places the menu reads: the group tree for who is in
 * the group, the activity feed for what each is on, and `mateTints` for the
 * colour its face wears — so a Mate is the same Mate on both surfaces.
 */
function useGroupMates(groupId: string): {
  readonly mates: ReadonlyArray<GroupMate>;
  readonly notice: CandidatesNotice | null;
  /** Reads the listing again: the notice's *Try again*. */
  readonly refresh: () => void;
} {
  const { listing, refresh } = useZeropsCandidates();
  const activity = useZeropsAgentActivity();
  const nowMs = useNowMs();
  const mates = useMemo(() => {
    const candidates = heldCandidates(listing).rows;
    const tints = assignCandidateMateTints(candidates);
    // Order is irrelevant here — a lookup by groupId, not a listing.
    const group = buildZeropsGroupTree(candidates, { order: "name" }).groups.find(
      (entry) => entry.group.groupId === groupId,
    );
    // A group's `environments` is every project in it — the stage and the
    // production included. `hasMate` is the predicate the menu has always used
    // to tell a Mate from a stop, and this listed the stops as Mates without it
    // (the owner, 2026-09-19).
    return (group?.environments ?? [])
      .filter(({ item }) => hasMate(item))
      .map(({ item }) => {
        const tags = readZeropsGroupTags(item.project.tagList);
        const live =
          item.group === "connected" && item.environmentId !== undefined
            ? activity.get(item.environmentId)
            : undefined;
        const subject = live?.subject;
        return {
          projectId: item.project.id,
          name: botDisplayName({ bot: tags.bot, projectName: item.project.name }),
          tint: tints.get(item.project.id) ?? "slate",
          face: mateFaceFor(item.group === "connected", live),
          subject,
          snippet: subject === undefined ? undefined : live?.snippet,
          when:
            live === undefined || subject === undefined
              ? undefined
              : compactSidebarTimeLabel(formatRelativeTimeLabel(live.at)),
        };
      });
  }, [activity, groupId, listing]);
  const notice = useMemo(
    () => candidatesNotice(listing, GROUP_MATES_SURFACE, nowMs),
    [listing, nowMs],
  );
  return { mates, notice, refresh };
}

/**
 * Where a stop answers from, and what it could answer from.
 *
 * Both, because the section that lists the addresses is the section somebody
 * would add one from — and it could only list them: the ask lived on the
 * projects screen's row menu, so an environment's own page showed a service
 * that serves HTTP to nobody and no way to open it.
 */
function useStopRoutes(projectId: string): {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
} {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    const found = findCandidate(listing, (entry) => entry.project.id === projectId);
    const candidate = found.kind === "found" ? found.row : undefined;
    return {
      routes: candidate?.routes ?? EMPTY_ROUTES,
      offers: candidate?.routeOffers ?? EMPTY_OFFERS,
    };
  }, [listing, projectId]);
}

const EMPTY_ROUTES: ReadonlyArray<ZeropsPublicRoute> = [];
const EMPTY_OFFERS: ReadonlyArray<ZeropsRouteOffer> = [];

/** Opens a Mate's own conversation, as selecting its row in the menu does. */
function useOpenMate(): (projectId: string) => void {
  const { listing } = useZeropsCandidates();
  const threads = useThreadShells();
  const navigate = useNavigate();
  return useCallback(
    (projectId: string) => {
      const found = findCandidate(listing, (entry) => entry.project.id === projectId);
      const environmentId = found.kind === "found" ? found.row.environmentId : undefined;
      const { primary } =
        environmentId === undefined
          ? { primary: undefined }
          : resolvePrimaryConversation(
              threads.filter((thread) => thread.environmentId === environmentId),
            );
      // Not connected, nothing started, or not read yet: the projects screen
      // owns connecting and starting, and says what it is still reading.
      if (environmentId === undefined || primary === undefined) {
        void navigate({ to: "/zerops" });
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, primary.id)),
      });
    },
    [listing, navigate, threads],
  );
}

/**
 * What this project needs somebody for, and the one handler that deals with
 * whichever row they press.
 *
 * Each row already knows what it acts on, so this is a switch rather than four
 * callbacks threaded down: a Mate opens its conversation, a stop and a change
 * open their pages, and a release is the project's own verb.
 */
function useProjectAttention(
  groupId: string,
  mates: ReadonlyArray<GroupMate>,
  input: {
    readonly environments: ReadonlyArray<EnvironmentRow>;
    readonly pullRequests: ReadonlyArray<FlowPullRequest>;
    readonly notLive: number;
    readonly canRelease: boolean;
  },
): {
  readonly items: ReadonlyArray<ProjectAttentionItem>;
  readonly onAct: (item: ProjectAttentionItem) => void;
} {
  const flowValue = useZeropsProjectFlowOptional();
  const mateNames = flowValue?.mateNames;
  const openMate = useOpenMate();
  const navigate = useNavigate();
  const { environments, pullRequests, notLive, canRelease } = input;

  const items = useMemo(
    () =>
      projectAttention({
        // A face wearing `needs` is a Mate that has stopped and asked
        // something: the one state where nothing moves until a person answers.
        waitingMates: mates
          .filter((mate) => mate.face === "needs")
          .map((mate) => ({ projectId: mate.projectId, name: mate.name })),
        failedStops: environments
          .filter((environment) => environment.tone === "bad")
          .map((environment) => ({
            projectId: environment.projectId,
            name: environment.name,
          })),
        pullRequests,
        notLive,
        canRelease,
        mateNames: mateNames ?? EMPTY_MATE_NAMES,
      }),
    [canRelease, environments, mateNames, mates, notLive, pullRequests],
  );

  const onAct = useCallback(
    (item: ProjectAttentionItem) => {
      const target = item.target;
      if (target === undefined) return;
      if (target.kind === "mate") {
        openMate(target.projectId);
        return;
      }
      if (target.kind === "stop") {
        void navigate({
          to: "/group/$groupId/$projectId",
          params: { groupId, projectId: target.projectId },
        });
        return;
      }
      void navigate({
        to: "/change/$groupId/$repository/$number",
        params: {
          groupId,
          repository: target.repository,
          number: String(target.number),
        },
      });
    },
    [groupId, navigate, openMate],
  );

  return { items, onAct };
}

/** Where a project with nothing set up goes: the screen that sets things up. */
function useOpenProjects(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: "/zerops" });
  }, [navigate]);
}

/** The release the flow offers on a group, read the way the menu row reads it. */
function useReleaseOffer(groupId: string): ReleaseOffer {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const onRelease = useCallback(() => {
    void flowValue?.release(groupId);
  }, [flowValue, groupId]);
  return {
    offered: flow?.release.gate.allowed ?? false,
    releasing: flowValue?.pending.has(flowVerbKey({ kind: "release", groupId })) ?? false,
    tag: flow?.release.suggestion,
    contents: flow?.release.contents ?? [],
    onRelease,
  };
}

/**
 * *Release* where the projects page draws a project's next step, with the same
 * confirm the project's own page asks: one verb, one dialog, wherever it is
 * offered. `label` is the step's own words (`Release v0.1.0`).
 */
export function ZeropsReleaseVerb({
  groupId,
  label,
}: {
  readonly groupId: string;
  readonly label: string;
}) {
  const release = useReleaseOffer(groupId);
  // The projects page's verbs are all one height; this one is theirs.
  return <ReleaseAction label={label} release={release} size="compact" />;
}

export function ZeropsGroupDetailPage({ groupId }: { readonly groupId: string }) {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const environments = flow?.environments ?? [];
  const repo = groupRepository(environments);
  const commits = useZeropsRepositoryCommits(
    flow === undefined || repo === undefined
      ? null
      : { giteaOrigin: flowValue?.giteaOrigin, owner: flow.slug, repo },
  );
  const waiting = releaseContentsSummary(flow?.release.contents ?? [], 20);
  const groupName = useGroupName(groupId);
  const readDetail = useZeropsCommitDetailReader({
    giteaOrigin: flowValue?.giteaOrigin,
    owner: flow?.slug,
    repo,
  });
  const openProjects = useOpenProjects();
  const actions = useGroupActions(groupId);
  const mates_ = useMateMenus();
  const release = useReleaseOffer(groupId);
  const crumbs = useCrumbs();
  const frameActions = useFrameActions();
  const names = useHistoryNames(groupName);
  const { mates, notice: matesNotice, refresh: rereadMates } = useGroupMates(groupId);
  const openMate = useOpenMate();
  const { withheldNotice, shown } = useWithheldStops(environments);
  const attention = useProjectAttention(groupId, mates, {
    environments: shown,
    pullRequests: flow?.pullRequests ?? EMPTY_PULLS,
    notLive: waiting.total,
    canRelease: release.offered,
  });

  if (flow === undefined) {
    return (
      <DetailShell crumbs={crumbs} frameActions={frameActions} title={groupName ?? "Project"}>
        <Note>This project has not been read yet.</Note>
      </DetailShell>
    );
  }

  return (
    <ZeropsGroupPane
      commits={commits}
      environments={environments}
      groupId={groupId}
      attention={attention.items}
      mates={mates}
      matesNotice={matesNotice}
      onMatesNoticeAct={(affordance) => {
        if (affordance.kind === "go-to-projects") openProjects();
        else rereadMates();
      }}
      name={groupName ?? flow.groupId}
      onAct={attention.onAct}
      names={names}
      menu={
        <>
          {actions.menu}
          {mates_.dialogs}
        </>
      }
      menuForMate={mates_.menuForMate}
      onAddMate={openProjects}
      onOpenMate={openMate}
      crumbs={crumbs}
      frameActions={frameActions}
      onSetUp={openProjects}
      release={release}
      trouble={actions.trouble ?? mates_.trouble}
      pullRequests={flow.pullRequests}
      readDetail={readDetail}
      repo={repo}
      waiting={waiting}
      withheldNotice={withheldNotice}
    />
  );
}

/**
 * A project group, drawn — every read already done and handed in.
 *
 * Split from the page above for the same reason the change's pane is: a
 * harness and a test can then look at a project with nothing set up, or twelve
 * changes waiting, without an account behind it.
 */
export function ZeropsGroupPane({
  commits,
  environments,
  attention,
  groupId,
  mates,
  matesNotice = null,
  onMatesNoticeAct,
  onAct,
  name,
  names,
  crumbs,
  frameActions,
  menu,
  menuForMate,
  onAddMate,
  onOpenMate,
  onSetUp,
  trouble,
  pullRequests,
  readDetail,
  release,
  repo,
  waiting,
  withheldNotice,
}: {
  readonly commits: ZeropsCommitsState;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly groupId: string;
  readonly name: string;
  readonly crumbs: ReadonlyArray<Crumb>;
  /** The bar's right side — the organization and the account, handed in by the page. */
  readonly frameActions?: React.ReactNode;
  /** Where a project with nothing set up goes to get something set up. */
  readonly onSetUp: () => void;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  readonly release: ReleaseOffer;
  /** The repository its history is read from; absent where none is declared. */
  readonly repo: string | undefined;
  /** What needs somebody, worst first — the page's opening answer. */
  readonly attention: ReadonlyArray<ProjectAttentionItem>;
  readonly onAct: (item: ProjectAttentionItem) => void;
  /** Every Mate on this project read so far, in the order the menu lists them. */
  readonly mates: ReadonlyArray<GroupMate>;
  /**
   * What "Who is on it" says until the listing may say "no Mate" (DESIGN §3.4);
   * absent or `null` once it is complete.
   */
  readonly matesNotice?: CandidatesNotice | null;
  /** Its affordance, pressed: read the listing again, or go to the projects. */
  readonly onMatesNoticeAct?: ((affordance: KnownAffordance) => void) | undefined;
  readonly names: HistoryNames;
  readonly onAddMate: () => void;
  /** One Mate's own quiet actions, by its project id. */
  readonly menuForMate?: (projectId: string) => React.ReactNode;
  /** The project's own quiet actions — rename, above all. */
  readonly menu?: React.ReactNode;
  /** Why a write from that menu failed, said under the heading it came from. */
  readonly trouble?: string | null;
  readonly onOpenMate: (projectId: string) => void;
  readonly waiting: ReleaseContentsSummary;
  /**
   * What a stop says in place of its content while the grant withholds its
   * project (DESIGN §3.4); `null` while it may be shown. Absent, every stop is.
   */
  readonly withheldNotice?: (projectId: string) => string | null;
}) {
  const deployed = useMemo(
    () =>
      deployedShas(
        environments.filter(
          (environment) => (withheldNotice?.(environment.projectId) ?? null) === null,
        ),
      ),
    [environments, withheldNotice],
  );
  return (
    <DetailShell
      // *Release* left the header when the panel below got a working one: a
      // page says a thing once, and the place it says it is the place you act
      // on it. *Add a Mate* stays — it answers nothing the panel raised.
      actions={
        <>
          <Button onClick={onAddMate} size="sm" variant="outline">
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add a Mate
          </Button>
          {menu}
        </>
      }
      crumbs={crumbs}
      frameActions={frameActions}
      subtitle={groupSubtitle(environments.length, pullRequests.length)}
      title={name}
    >
      {trouble === null || trouble === undefined ? null : (
        <p className="text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
      <AttentionPanel items={attention} onAct={onAct} release={release} />

      <Section title="Who is on it">
        {mates.length === 0 ? (
          matesNotice === null ? (
            <Empty
              action="Add a Mate"
              onAction={onAddMate}
              text="No Mate is working on this project yet."
            />
          ) : null
        ) : (
          <ul className="flex flex-col">
            {mates.map((mate) => (
              <MateLine
                key={mate.projectId}
                mate={mate}
                menu={menuForMate?.(mate.projectId)}
                onOpen={onOpenMate}
              />
            ))}
          </ul>
        )}
        {matesNotice === null ? null : (
          <ListingNotice notice={matesNotice} onAct={onMatesNoticeAct} />
        )}
      </Section>

      <Section title="Where it is">
        <ul className="flex flex-col">
          {environments.length === 0 ? (
            // A project with nothing set up used to land on three sentences
            // saying "no" and no way to change any of them.
            <Empty
              action="Set up an environment"
              onAction={onSetUp}
              text="No stage or production declared yet."
            />
          ) : (
            environments.map((environment) => (
              <StopLine
                environment={environment}
                groupId={groupId}
                groupName={name}
                key={environment.projectId}
                notice={withheldNotice?.(environment.projectId) ?? null}
              />
            ))
          )}
        </ul>
      </Section>

      <Section title="In flight">
        {pullRequests.length === 0 ? (
          <Note>Nothing open. Every change the Mates made has landed.</Note>
        ) : (
          <ul className="flex flex-col">
            {pullRequests.map((pull) => (
              <ChangeLine groupId={groupId} key={`${pull.repository}#${pull.number}`} pull={pull} />
            ))}
          </ul>
        )}
      </Section>

      {waiting.total === 0 ? null : (
        <Section title={`Merged, not live · ${String(waiting.total)}`}>
          <ul className="mb-3 flex flex-col gap-1">
            {waiting.subjects.map((subject) => (
              <li className="truncate text-sm text-foreground" key={subject}>
                {subject}
              </li>
            ))}
            {waiting.more === 0 ? null : (
              <li className="text-sm text-muted-foreground">+{waiting.more} more</li>
            )}
          </ul>
        </Section>
      )}

      <Section title={repo === undefined ? "History" : `History · ${repo}`}>
        {repo === undefined ? (
          <Empty
            action="Set up an environment"
            onAction={onSetUp}
            text="No repository is declared for this project’s services yet."
          />
        ) : (
          <ZeropsHistoryView
            commits={commits}
            names={names}
            readDetail={readDetail}
            request={{ repo, deployed }}
          />
        )}
      </Section>
    </DetailShell>
  );
}

export function ZeropsStopDetailPage({
  groupId,
  projectId,
}: {
  readonly groupId: string;
  readonly projectId: string;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const stop = flow?.environments.find((entry) => entry.projectId === projectId);
  const declared = flow?.environmentInputs.find((entry) => entry.projectId === projectId);
  // A stop whose project the grant withholds draws nothing of it (DESIGN §3.4),
  // nor marks what it runs in another stop's history, and reads nothing its
  // repository and commit address.
  const { withheldNotice, shown } = useWithheldStops(flow?.environments);
  const withheld = withheldNotice(projectId);
  const repo = withheld === null ? stop?.versionRepository : undefined;
  const deployed = useMemo(() => deployedShas(shown), [shown]);
  const stage = stop?.tier === "stage";
  const production = stop?.tier === "production";
  const forge = { giteaOrigin: flowValue?.giteaOrigin, owner: flow?.slug };
  // Only a stage draws its deploys: a production moves by release, and its
  // releases are the list it is read by.
  const commits = useZeropsRepositoryCommits(
    flow === undefined || repo === undefined || !stage
      ? null
      : { giteaOrigin: flowValue?.giteaOrigin, owner: flow.slug, repo },
  );
  const readDetail = useZeropsCommitDetailReader({ ...forge, repo });
  // A production's releases say what each carried: its code services'
  // repositories, read once when the page opens, never on the clock.
  const releaseServices = production && withheld === null ? declared?.services : undefined;
  const repositoryOf =
    releaseServices === undefined
      ? NO_REPOSITORIES
      : new Map(
          releaseServices.flatMap((entry) =>
            entry.repository === undefined ? [] : [[entry.hostname, entry.repository] as const],
          ),
        );
  const repositories = [...new Set(repositoryOf.values())];
  const repositoryReads = useZeropsRepositoriesCommits(
    production && flow !== undefined && repositories.length > 0
      ? { giteaOrigin: flowValue?.giteaOrigin, owner: flow.slug, repositories }
      : null,
  );
  const releaseReads =
    releaseServices === undefined ? undefined : { reads: repositoryReads, repositoryOf };
  const release = useReleaseOffer(groupId);
  const stopGroupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: stopGroupName ?? groupId });
  const frameActions = useFrameActions();
  const names = useHistoryNames(stopGroupName);
  const openProjects = useOpenProjects();
  const { routes, offers } = useStopRoutes(projectId);
  const route = useEnableRoute();
  const inventory = useZeropsInventory();
  const platform = useStopServices(
    withheld === null ? findInventoryProjectRef(inventory, projectId) : null,
  );
  // Only a countdown reads the clock, and nothing here counts down: the time
  // the page was first drawn is enough, as it is for the left menu's rows.
  const [nowMs] = useState(Date.now);
  // A withheld stop lists no service, so no build of one is read either.
  const services =
    declared === undefined || withheld !== null
      ? NO_SERVICE_ROWS
      : serviceRows({
          environment: declared.environment,
          services: declared.services,
          platform,
          mainHead: stage && commits.kind === "read" ? commits.commits[0]?.sha : undefined,
          routes,
          offers,
          nowMs,
          age: formatRelativeTimeLabel,
        });
  const failedDeploy =
    flow === undefined || stop === undefined
      ? undefined
      : stopFailedDeploy({ tier: stop.tier, rows: services, releases: flow.releases });
  // The build behind the deploy that failed — its service's repository, the
  // commit it deployed — read whether or not its row is open: whether its job
  // is known decides the verdict's *Run again*.
  const failedRow =
    failedDeploy === undefined
      ? undefined
      : services.find((row) => row.hostname === failedDeploy.service);
  const failedRun = useZeropsDeployRun(
    failedDeploy === undefined || failedRow === undefined
      ? null
      : serviceBuildRequest({ repository: failedRow.repository, sha: failedDeploy.sha }, forge),
  );

  if (flowValue === null || flow === undefined || stop === undefined) {
    return (
      <DetailShell crumbs={crumbs} frameActions={frameActions} title="Environment">
        <Note>This environment has not been read yet.</Note>
      </DetailShell>
    );
  }
  if (withheld !== null) {
    return (
      <DetailShell crumbs={crumbs} frameActions={frameActions} title={stop.tier}>
        <Note>{withheld}</Note>
      </DetailShell>
    );
  }

  const deployment = flowValue.deployments.get(projectId) ?? UNREAD_DEPLOYMENT;
  const view = stopView({ deployment, row: stop, nowMs });
  const activatedAt =
    deployment.state === "known" && deployment.value.kind === "running"
      ? deployment.value.activatedAt
      : null;
  const live = flow.releases.find((entry) => entry.standing === "live");
  const releasedAge = live?.taggedAt === undefined ? "" : formatRelativeTimeLabel(live.taggedAt);
  const job = failedJob(failedRun.state);
  const verdict = stopVerdict({
    tier: stop.tier,
    view,
    releasing: flow.release.inFlight ?? (release.releasing ? release.tag : undefined),
    failed:
      failedDeploy === undefined ? undefined : { ...failedDeploy, jobKnown: job !== undefined },
    waiting: releaseContentsSummary(flow.release.contents, 20).total,
    release,
    releasedAge: releasedAge.length === 0 ? undefined : releasedAge,
    since: activatedAt === null ? undefined : formatRelativeTimeLabel(activatedAt),
    atMainHead:
      stage &&
      commits.kind === "read" &&
      view.version?.sha !== undefined &&
      commits.commits[0]?.sha === view.version.sha,
  });

  return (
    <ZeropsStopPane
      commits={commits}
      crumbs={crumbs}
      deployed={deployed}
      enablingServiceId={route.enablingServiceId}
      forge={forge}
      frameActions={frameActions}
      groupId={groupId}
      groupName={stopGroupName}
      menuWaiting={
        production ? releaseContentsSummary(flow.release.contents, MENU_CHANGES_SHOWN) : undefined
      }
      names={names}
      onEnableRoute={(serviceId) => {
        void route.enable(projectId, serviceId);
      }}
      onOpenProject={openProjects}
      onRollBack={(tag) => {
        void flowValue.rollBack(groupId, tag);
      }}
      pending={flowValue.pending}
      readDetail={readDetail}
      release={release}
      releaseReads={releaseReads}
      releases={production ? flow.releases : NO_RELEASES}
      repo={repo}
      routeTrouble={route.trouble}
      routes={routes}
      runAgain={
        job === undefined
          ? undefined
          : {
              rerunning: failedRun.rerunning,
              failure: failedRun.rerunFailure,
              onRunAgain: () => {
                void failedRun.rerun(job.id);
              },
            }
      }
      services={services}
      stop={stop}
      trouble={flowValue.trouble}
      verdict={verdict}
      view={view}
      waiting={production ? releaseContentsCommits(flow.release.contents) : NO_COMMITS}
    />
  );
}

/** Where a service's build is read from: its own repository and the commit it runs. */
interface StopBuildForge {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
}

/**
 * The read behind one service's build — that service's repository and commit,
 * never the stop's first service's. `null` where it names no commit: nothing to read.
 */
export function serviceBuildRequest(
  row: Pick<StopServiceRow, "repository" | "sha">,
  forge: StopBuildForge,
): ZeropsDeployRunRequest | null {
  if (row.sha === undefined) return null;
  return { ...forge, repo: row.repository, sha: row.sha };
}

/** A commit merged to `main` and not in front of people yet. */
interface WaitingCommit {
  readonly sha: string;
  readonly subject: string;
}

/** *Run again* on the verdict: the failed job of the service whose deploy failed. */
interface StopRunAgain {
  readonly rerunning: boolean;
  /** Why Gitea refused the last one, until another is pressed. */
  readonly failure: string | null;
  readonly onRunAgain: () => void;
}

/** A stop's role, as its tag reads beside its name. */
const ROLE_TAG: Record<GroupEnvironmentTier, ZeropsEnvironmentRole> = {
  stage: "stage",
  production: "prod",
};

/** A production's code repositories, read for what its releases carried. */
interface StopReleaseReads {
  /** `repository → its read`. */
  readonly reads: ReadonlyMap<string, ZeropsCommitsState>;
  /** `hostname → repository`, the code services only. */
  readonly repositoryOf: ReadonlyMap<string, string>;
}

/** How many releases a production lists before the rest wait behind a quiet verb. */
const RELEASES_SHOWN = 5;

/** How many waiting changes a stop's menu lists before it counts the rest — the left menu's. */
const MENU_CHANGES_SHOWN = 8;

/**
 * One stop, drawn — every read already done and handed in.
 *
 * Split from the page for the same reason the others are: the states worth
 * looking at are a production twelve changes behind, a deploy that failed with
 * nothing running, and a stop nobody has ever deployed to, and none of them is
 * reachable by waiting for an account to be in that state.
 *
 * It opens with its verdict — one sentence, at most one verb — and says the
 * rest in one card: what waits for a release, each service and what it runs,
 * and how the stop got here (a production's releases, a stage's deploys).
 */
export function ZeropsStopPane({
  buildOf,
  commits,
  crumbs,
  deployed,
  enablingServiceId,
  forge,
  frameActions,
  groupId,
  groupName,
  menuWaiting,
  names,
  onEnableRoute,
  onOpenProject,
  onRollBack,
  pending,
  readDetail,
  release,
  releaseReads,
  releases,
  repo,
  routeTrouble,
  routes,
  runAgain,
  services,
  stop,
  trouble,
  verdict,
  view,
  waiting,
}: {
  readonly crumbs: ReadonlyArray<Crumb>;
  /** The bar's right side — the organization and the account, handed in by the page. */
  readonly frameActions?: React.ReactNode;
  readonly groupId: string;
  /** The project's name, so the stop's own title does not repeat it. */
  readonly groupName: string | undefined;
  readonly stop: EnvironmentRow;
  /** What the stop runs, as the left menu reads it — its menu is that menu. */
  readonly view: StopView;
  readonly verdict: StopVerdict;
  /** One row per service, as `serviceRows` says it. */
  readonly services: ReadonlyArray<StopServiceRow>;
  /** Where an opened service's build is read from. */
  readonly forge: StopBuildForge;
  /**
   * The build behind a service's commit where the caller already holds it — the design harness's
   * canned runs; read from Gitea by `forge` otherwise.
   */
  readonly buildOf?: ((row: StopServiceRow) => ZeropsDeployRun) | undefined;
  /** Offered on a production that is behind — the one stop a release moves. */
  readonly release: ReleaseOffer;
  readonly runAgain?: StopRunAgain | undefined;
  /** What `main` has that this production does not; empty for a stage. */
  readonly waiting: ReadonlyArray<WaitingCommit>;
  /** The menu's list of waiting changes; a production's only. */
  readonly menuWaiting: ReleaseContentsSummary | undefined;
  /** Every public address of the stop, for its menu; each service row lists its own. */
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly onOpenProject: () => void;
  /** A production's releases, newest first; empty for a stage. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /**
   * What a production's code repositories read, so each release row says what it carried;
   * `undefined` on a stage, where the rows are their shas.
   */
  readonly releaseReads?: StopReleaseReads | undefined;
  /** The flow's verbs under way (`flowVerbKey`). */
  readonly pending: ReadonlySet<string>;
  readonly onRollBack: (tag: string) => void;
  /** What the last flow verb's refusal said — a *Roll back* refused says so here. */
  readonly trouble: string | null;
  readonly commits: ZeropsCommitsState;
  /** `environment name → the whole sha it runs`, for the history's own marks. */
  readonly deployed: ReadonlyMap<string, string>;
  readonly names: HistoryNames;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  readonly repo: string | undefined;
  readonly onEnableRoute?: ((serviceId: string) => void) | undefined;
  /** Which one is being opened, so its row says so and takes no second press. */
  readonly enablingServiceId?: string | null;
  readonly routeTrouble?: string | null;
}) {
  const [allReleases, setAllReleases] = useState(false);
  const title = environmentNameUnderGroup(groupName, stop.name);
  const production = stop.tier === "production";
  const earlier = Math.max(0, releases.length - RELEASES_SHOWN);
  const listed = allReleases ? releases : releases.slice(0, RELEASES_SHOWN);
  // Over the whole list, not the rows shown: the last row drawn is measured
  // against the first one not drawn.
  const changes = useMemo(
    () =>
      releaseReads === undefined
        ? NO_CHANGES
        : releasesCarried({
            releases,
            repositoryOf: releaseReads.repositoryOf,
            commits: new Map(
              [...releaseReads.reads].flatMap(([repository, state]) =>
                state.kind === "read"
                  ? [[repository, state.commits] as [string, ReadonlyArray<GiteaCommit>]]
                  : [],
              ),
            ),
          }),
    [releaseReads, releases],
  );
  const verb = verdict.verb;
  return (
    <DetailShell
      actions={
        <ZeropsStopMenu
          name={title}
          onOpenProject={onOpenProject}
          onOpenStop={undefined}
          routes={routes}
          stop={view}
          triggerClassName="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          waiting={menuWaiting}
        />
      }
      crumbs={crumbs}
      frameActions={frameActions}
      subtitle={stopMetaLine({ tier: stop.tier, source: stop.source, services: services.length })}
      title={title}
      titleTag={<ZeropsRoleTag label={ROLE_TAG[stop.tier]} />}
    >
      <div>
        <VerdictPanel detail={verdict.detail} text={verdict.text} tone={verdict.tone}>
          {verb?.kind === "release" ? (
            <ReleaseAction
              label={`${flowVerbLabel("release", false)} ${verb.tag}`}
              release={release}
              size="compact"
              variant="outline"
            />
          ) : verb?.kind === "run-again" && runAgain !== undefined ? (
            <Button
              data-zerops-primary-action="Run again"
              disabled={runAgain.rerunning}
              onClick={runAgain.onRunAgain}
              size="compact"
              variant="outline"
            >
              {runAgainLabel(runAgain.rerunning)}
            </Button>
          ) : undefined}
        </VerdictPanel>
        {runAgain?.failure === null || runAgain?.failure === undefined ? null : (
          <p className="mt-1.5 px-3 text-sm text-[var(--zerops-status-failed-text)]">
            {runAgain.failure}
          </p>
        )}
      </div>

      <FlatCard className="flex flex-col divide-y divide-border px-4">
        {waiting.length === 0 ? null : (
          <CardGroup title={stopCardTitle("waiting", waiting.length)}>
            <ul className="flex flex-col">
              {waiting.map((commit) => (
                <li
                  className={cn(CARD_ROW_CLASS, "grid-cols-[4.5rem_minmax(0,1fr)]")}
                  key={commit.sha}
                >
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {shortCommit(commit.sha)}
                  </span>
                  <span className="min-w-0 truncate text-sm text-foreground">{commit.subject}</span>
                </li>
              ))}
            </ul>
          </CardGroup>
        )}

        <CardGroup title={stopCardTitle("services", services.length)}>
          {services.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{NONE_YET}</p>
          ) : (
            <ul className="flex flex-col">
              {services.map((row) => (
                <StopServiceLine
                  buildOf={buildOf}
                  enablingServiceId={enablingServiceId ?? null}
                  forge={forge}
                  key={row.hostname}
                  onEnableRoute={onEnableRoute}
                  row={row}
                />
              ))}
            </ul>
          )}
          {routeTrouble === null || routeTrouble === undefined ? null : (
            <p className="py-2 text-sm text-[var(--zerops-status-failed-text)]">{routeTrouble}</p>
          )}
        </CardGroup>

        {!production || releases.length === 0 ? null : (
          <CardGroup title={stopCardTitle("releases", releases.length)}>
            <ul className="flex flex-col">
              <ZeropsReleaseRows
                {...(releaseReads === undefined
                  ? {}
                  : {
                      carried: {
                        changes,
                        reads: releaseReads.reads,
                        repositoryOf: releaseReads.repositoryOf,
                        forge,
                        names,
                      },
                    })}
                groupId={groupId}
                onRollBack={onRollBack}
                pending={pending}
                releases={listed}
              />
            </ul>
            {earlier === 0 || allReleases ? null : (
              <Button
                className="my-1 text-muted-foreground"
                onClick={() => {
                  setAllReleases(true);
                }}
                size="sm"
                variant="ghost"
              >
                {earlierReleasesLabel(earlier)}
              </Button>
            )}
          </CardGroup>
        )}

        {production ? null : (
          <CardGroup
            aside={DEPLOYS_ASIDE}
            title={stopCardTitle(
              "deploys",
              repo !== undefined && commits.kind === "read" ? commits.commits.length : undefined,
            )}
          >
            {repo === undefined ? (
              <p className="py-2 text-sm text-muted-foreground">
                No repository is declared for this environment&rsquo;s services, so its history
                cannot be read.
              </p>
            ) : commits.kind === "read" && commits.commits.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{NONE_YET}</p>
            ) : (
              <ZeropsHistoryView
                commits={commits}
                here={stop.name}
                names={names}
                readDetail={readDetail}
                request={{ repo, deployed }}
              />
            )}
          </CardGroup>
        )}
      </FlatCard>
      {/* A verb that refused says so under the card it was pressed in. */}
      {trouble === null ? null : (
        <p className="mt-2 text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
    </DetailShell>
  );
}

/** One row of the stop's card: the hairline over it, and the height every row keeps. */
const CARD_ROW_CLASS = "grid min-h-11 items-center gap-x-4 border-t border-border/60 py-2";

/**
 * A service's row: the same five places on every row, so the status dots run
 * down one column — collapsed to name and state over the rest on a phone.
 */
const SERVICE_ROW_CLASS = cn(
  CARD_ROW_CLASS,
  "grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-y-1 sm:grid-cols-[1.25rem_minmax(0,1.1fr)_minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,1.4fr)]",
);

/**
 * One group of the stop's card, under its label: the first 12px under the
 * card's edge, each later one 24px under the hairline between them.
 */
function CardGroup({
  title,
  aside,
  children,
}: {
  readonly title: string;
  /** Said beside the label, muted: what the group is read from. */
  readonly aside?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="pt-6 pb-2 first:pt-3">
      <h2 className="flex items-baseline gap-2 pb-1.5">
        <MicroLabel>{title}</MicroLabel>
        {aside === undefined ? null : (
          <span className="text-xs text-muted-foreground">{aside}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/**
 * One service of a stop: what it is, what it runs, how that deploy went, and
 * where it answers. Its chevron opens the build behind the commit *it* runs.
 */
function StopServiceLine({
  row,
  forge,
  buildOf,
  onEnableRoute,
  enablingServiceId,
}: {
  readonly row: StopServiceRow;
  readonly forge: StopBuildForge;
  readonly buildOf: ((row: StopServiceRow) => ZeropsDeployRun) | undefined;
  readonly onEnableRoute: ((serviceId: string) => void) | undefined;
  readonly enablingServiceId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const request = serviceBuildRequest(row, forge);
  const dot = STOP_DOT_TONE[row.tone];
  // Nothing to offer where the caller cannot act on it — a row with a button
  // that does nothing is worse than no row.
  const offers = onEnableRoute === undefined ? [] : row.offers;
  return (
    <li className="flex flex-col">
      <div className={SERVICE_ROW_CLASS}>
        {request === null ? (
          <span aria-hidden="true" />
        ) : (
          <button
            aria-expanded={open}
            aria-label={serviceBuildToggleLabel(row.hostname, open)}
            className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            onClick={() => {
              setOpen((current) => !current);
            }}
            type="button"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm leading-5 font-medium text-foreground">
            {row.hostname}
          </span>
          <span className="truncate text-xs leading-4 text-muted-foreground">{row.repository}</span>
        </span>
        <span className="col-span-2 col-start-2 flex min-w-0 flex-col sm:col-span-1 sm:col-start-3 sm:row-start-1">
          {/* No commit and a state: what runs is not stated yet, so nothing is claimed. */}
          {row.commit !== undefined ? (
            <span className="truncate font-mono text-[13px] leading-5 text-foreground tabular-nums">
              {row.commit}
            </span>
          ) : row.status === undefined ? (
            <span className="truncate text-sm leading-5 text-muted-foreground">
              {NOTHING_DEPLOYED}
            </span>
          ) : null}
          {row.line === undefined ? null : (
            <span className="truncate text-xs leading-4 text-muted-foreground">{row.line}</span>
          )}
        </span>
        <span className="col-start-3 row-start-1 min-w-0 text-[13px] text-foreground sm:col-start-4">
          {row.status === undefined ? null : dot === undefined ? (
            <span className="truncate text-muted-foreground">{row.status}</span>
          ) : (
            <StatusDot label={row.status} sentence tone={dot} />
          )}
        </span>
        <span className="col-span-2 col-start-2 flex min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-5 sm:row-start-1">
          {row.routes.length === 0 && offers.length === 0 ? (
            <span className="truncate text-[13px] text-muted-foreground">{NOT_PUBLIC_YET}</span>
          ) : null}
          {row.routes.map((route) => (
            <a
              className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground underline-offset-2 hover:underline"
              href={route.url}
              key={route.host}
              rel="noreferrer"
              target="_blank"
            >
              <span className="min-w-0 truncate">{route.host}</span>
              <ExternalLinkIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            </a>
          ))}
          {/* A service that serves HTTP and answers to nobody: the row that
              would list its address is the row you add one from. */}
          {offers.map((offer) => {
            const opening = enablingServiceId === offer.serviceId;
            return (
              <span
                className="flex min-w-0 flex-col items-start gap-0.5"
                data-zerops-surface="stop-route-offer"
                key={offer.serviceId}
              >
                <Button
                  disabled={opening || enablingServiceId !== null}
                  onClick={() => onEnableRoute?.(offer.serviceId)}
                  size="compact"
                  variant="outline"
                >
                  {opening ? "Opening…" : "Open to the internet"}
                </Button>
                <span className="truncate text-xs text-muted-foreground">
                  {offer.service} answers on {offer.port}, but not from outside
                </span>
              </span>
            );
          })}
        </span>
      </div>
      {!open || request === null ? null : buildOf === undefined ? (
        <ServiceBuild request={request} />
      ) : (
        <ServiceBuildView run={buildOf(row)} />
      )}
    </li>
  );
}

/** The build behind one service's commit — read only while its row is open. */
function ServiceBuild({ request }: { readonly request: ZeropsDeployRunRequest }) {
  return <ServiceBuildView run={useZeropsDeployRun(request)} />;
}

function ServiceBuildView({ run }: { readonly run: ZeropsDeployRun }) {
  return (
    <div className="mb-2 ml-9 rounded-md bg-muted/50 px-3 py-2">
      <ZeropsDeployRunView run={run} />
    </div>
  );
}

/**
 * One change's own page: what it carries, what is stopping it, and the verb
 * that moves it.
 *
 * `#4` used to be a link into Gitea, which is a sign-in page for everybody:
 * the app holds the only Gitea token. The commits come from `compareCommits`,
 * which is the right read for a change and the wrong one for a history — it
 * reports what one ref has that another does not, which is what a pull
 * request is.
 */
export function ZeropsChangeDetailPage({
  groupId,
  repository,
  number,
}: {
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
}) {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const open = flow?.pullRequests.find(
    (entry) => entry.repository === repository && entry.number === number,
  );
  /**
   * A change that has landed is not in the flow, which holds the open ones —
   * and it is exactly the change somebody links to. Read it from the forge,
   * once, for this number only.
   */
  const landed = useZeropsLandedChange(
    flow === undefined || open !== undefined
      ? null
      : {
          giteaOrigin: flowValue?.giteaOrigin,
          owner: flow.slug,
          repository,
          number,
        },
  );
  const pull = open ?? (landed.kind === "read" ? landed.pull : undefined);
  const commits = useZeropsChangeCommits(
    flow === undefined || pull === undefined
      ? null
      : {
          giteaOrigin: flowValue?.giteaOrigin,
          owner: flow.slug,
          repo: pull.repository,
          base: pull.baseBranch,
          head: pull.headSha,
        },
  );
  const readDetail = useZeropsCommitDetailReader({
    giteaOrigin: flowValue?.giteaOrigin,
    owner: flow?.slug,
    repo: pull?.repository,
  });
  const comments = useZeropsChangeComments(
    flow === undefined || pull === undefined
      ? null
      : {
          giteaOrigin: flowValue?.giteaOrigin,
          owner: flow.slug,
          repo: pull.repository,
          number: pull.number,
        },
  );
  const askMate = useAskMate();
  const me =
    flowValue?.giteaOrigin === undefined ? undefined : giteaSessionLogin(flowValue.giteaOrigin);
  const mateNames = flowValue?.mateNames;
  const remarks = useMemo(
    () =>
      comments.state.kind === "read"
        ? changeRemarks({
            comments: comments.state.comments,
            mateNames: mateNames ?? EMPTY_MATE_NAMES,
            me,
          })
        : EMPTY_REMARKS,
    [comments.state, mateNames, me],
  );
  const groupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: groupName ?? groupId });
  const frameActions = useFrameActions();
  const names = useHistoryNames(groupName);
  const now = useNowMs();
  const slug = flow?.slug;
  const merge = useCallback(() => {
    if (flowValue === null || slug === undefined || pull === undefined) return;
    void flowValue.mergePullRequest(slug, {
      repository: pull.repository,
      number: pull.number,
      headSha: pull.headSha,
    });
  }, [flowValue, pull, slug]);

  if (flow === undefined || pull === undefined) {
    return (
      <DetailShell crumbs={crumbs} frameActions={frameActions} title={`#${String(number)}`}>
        <Note>{landedNote(landed, repository, number)}</Note>
      </DetailShell>
    );
  }

  return (
    <ZeropsChangePane
      age={historyAge(pull.updatedAt, now)}
      comments={comments}
      commits={commits}
      mateName={
        pull.mateProjectId === undefined ? undefined : flowValue?.mateNames.get(pull.mateProjectId)
      }
      merging={
        flowValue?.pending.has(
          flowVerbKey({
            kind: "merge",
            slug: flow.slug,
            repository: pull.repository,
            number: pull.number,
          }),
        ) ?? false
      }
      names={names}
      onAsk={askMate}
      crumbs={crumbs}
      frameActions={frameActions}
      onMerge={merge}
      pull={pull}
      readDetail={readDetail}
      remarks={remarks}
      trouble={flowValue?.trouble ?? null}
    />
  );
}

/**
 * One change, drawn — every read already done and handed in.
 *
 * The page above holds the hooks; this holds the picture, so a harness and a
 * test can look at a change that is failing its checks, or twelve commits
 * behind, or merged, without an account behind it. Same split as the release
 * confirm's.
 */
/** What to say while a landed change is being fetched, and when it is not there. */
function landedNote(state: ZeropsLandedChangeState, repository: string, number: number): string {
  switch (state.kind) {
    case "reading":
      return "Reading this change…";
    case "gone":
      return `${repository} has no change #${String(number)}.`;
    case "failed":
      return state.reason;
    case "idle":
    case "read":
      return "This project has not been read yet.";
  }
}

export function ZeropsChangePane({
  age,
  comments,
  commits,
  mateName,
  merging,
  names,
  onAsk,
  crumbs,
  frameActions,
  onMerge,
  pull,
  readDetail,
  remarks,
  trouble,
}: {
  /** How long since it last moved, as `historyAge` says it. */
  readonly age: string | undefined;
  readonly comments: ZeropsChangeComments;
  readonly commits: ZeropsCommitsState;
  readonly mateName: string | undefined;
  readonly merging: boolean;
  readonly onAsk: (mateProjectId: string | undefined, ask: string) => void;
  readonly crumbs: ReadonlyArray<Crumb>;
  /** The bar's right side — the organization and the account, handed in by the page. */
  readonly frameActions?: React.ReactNode;
  readonly onMerge: () => void;
  readonly pull: FlowPullRequest;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  readonly names: HistoryNames;
  /** What the last verb's refusal said, where one refused. */
  readonly trouble: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [asking, setAsking] = useState(false);
  const verdict = changeVerdict(pull);
  const author = changeAuthorName(pull, mateName);
  return (
    <DetailShell
      crumbs={crumbs}
      frameActions={frameActions}
      // Every fact the definition list held, as the one line of provenance it
      // always was. The org used to lead it — `shop · appdev · main` — which is
      // the project's name again with a typo's worth of difference.
      subtitle={changeSubtitle({
        number: pull.number,
        repository: pull.repository,
        baseBranch: pull.baseBranch,
        author,
        age,
      })}
      title={pull.title}
    >
      <ChangeVerdictPanel
        merging={merging}
        onAsk={() => {
          setAsking(true);
        }}
        onMerge={() => {
          setConfirming(true);
        }}
        askLabel={changeAskLabel(mateName)}
        trouble={trouble}
        verdict={verdict}
      />
      {/* Both confirms live outside the panel so neither reopens when the
          verdict changes under them mid-flight. */}
      <ZeropsMergeDialog
        mateName={mateName}
        merging={merging}
        onConfirm={() => {
          setConfirming(false);
          onMerge();
        }}
        onOpenChange={setConfirming}
        open={confirming}
        pull={pull}
      />
      <ZeropsAskDialog
        ask={verdict.ask ?? ""}
        mateName={mateName}
        onConfirm={() => {
          setAsking(false);
          onAsk(pull.mateProjectId, verdict.ask ?? "");
        }}
        onOpenChange={setAsking}
        open={asking}
        sending={false}
        tint={mateName === undefined ? undefined : preferredMateTint(mateName)}
        what={verdict.text}
      />

      <Section title={`Conversation · ${changeConversationCount(remarks)}`}>
        <ZeropsChangeConversation
          change={{
            mateProjectId: pull.mateProjectId,
            number: pull.number,
            repository: pull.repository,
            title: pull.title,
          }}
          comments={comments}
          mateName={mateName}
          onAsk={onAsk}
          remarks={remarks}
        />
      </Section>

      {/* Was `What it carries · appdev`: the repository is on the line under
          the title already, and what a change carries is its commits. */}
      <Section
        title={commits.kind === "read" ? `Commits · ${String(commits.commits.length)}` : "Commits"}
      >
        <ZeropsHistoryView
          commits={commits}
          names={names}
          readDetail={readDetail}
          request={{ repo: pull.repository, deployed: EMPTY_DEPLOYED }}
        />
      </Section>
    </DetailShell>
  );
}

/** Nothing in an unmerged change is running anywhere yet. */
const EMPTY_DEPLOYED: ReadonlyMap<string, string> = new Map();

/** Nothing said, and nobody to name: the states before the reads land. */
const EMPTY_REMARKS: ReadonlyArray<ChangeRemark> = [];
const EMPTY_MATE_NAMES: ReadonlyMap<string, string> = new Map();
const EMPTY_PULLS: ReadonlyArray<FlowPullRequest> = [];
const EMPTY_STOPS: ReadonlyArray<EnvironmentRow> = [];

/** A stop whose project the flow has no listing for: not read, never "nothing". */
const UNREAD_DEPLOYMENT: Shown<Deployment> = { state: "unread", waitingFor: null };
/** A stop's parts before its flow has been read — the page says it is unread in their place. */
const NO_SERVICE_ROWS: ReadonlyArray<StopServiceRow> = [];
/** What a stage lists in a production's place: it has no releases and waits for none. */
const NO_RELEASES: ReadonlyArray<FlowReleaseRow> = [];
const NO_REPOSITORIES: ReadonlyMap<string, string> = new Map();
const NO_CHANGES: ReturnType<typeof releasesCarried> = new Map();
const NO_COMMITS: ReadonlyArray<WaitingCommit> = [];

/**
 * Where a detail page sits, outermost first — a containment trail, not a way
 * back to wherever you came from.
 *
 * The first crumb said *Conversation* and went to `/`, which resolves to
 * whichever thread the router settles on: "this `conversation` link never
 * makes sense, it will just redirect to some random convo" (the owner,
 * 2026-09-19). A trail whose root is a guess is worse than no trail, because
 * it looks like it knows.
 *
 * So it is the hierarchy these pages actually sit in — every project, then the
 * project, then this page's own name in the title. Each step is the page of
 * the thing that contains this one, which is a claim the route can keep. The
 * conversations are not above these pages anyway: they hang off the Mates, and
 * a Mate's row on the project's page is the way into its own.
 */
function useCrumbs(
  inside?: { readonly groupId: string; readonly name: string } | undefined,
): ReadonlyArray<Crumb> {
  const navigate = useNavigate();
  const groupId = inside?.groupId;
  const name = inside?.name;
  return useMemo(() => {
    const trail: Array<Crumb> = [
      {
        label: "Projects",
        onClick: () => {
          void navigate({ to: "/zerops" });
        },
      },
    ];
    if (groupId !== undefined && name !== undefined) {
      trail.push({
        label: name,
        onClick: () => {
          void navigate({ to: "/group/$groupId/flow", params: { groupId } });
        },
      });
    }
    return trail;
  }, [groupId, name, navigate]);
}

/**
 * A project's one line under its name.
 *
 * It was the Gitea org — `Shop` over `shop` — which reads as the name repeated
 * with a typo. What is actually worth knowing at a glance is how much there is.
 */
function groupSubtitle(stops: number, changes: number): string {
  const stopPart = stops === 1 ? "1 environment" : `${String(stops)} environments`;
  const changePart = changes === 1 ? "1 change open" : `${String(changes)} changes open`;
  return `${stopPart} · ${changePart}`;
}

/** What *Release* is offered on a page, or that it is not offered at all. */
export interface ReleaseOffer {
  /** False where the stage has nothing the production lacks, or there is no production. */
  readonly offered: boolean;
  readonly releasing: boolean;
  /** The version it would cut, where the flow suggested one. */
  readonly tag: string | undefined;
  readonly contents: ReadonlyArray<{
    readonly commits: ReadonlyArray<{ sha: string; subject: string }>;
  }>;
  readonly onRelease: () => void;
}

/**
 * *Release*, on the page that shows what is waiting for it.
 *
 * The menu row offered this and the page the row expands to did not, so the
 * one screen listing three changes merged and not live was the one screen that
 * could not put them live.
 */
function ReleaseAction({
  release,
  label,
  size = "sm",
  variant,
}: {
  readonly release: ReleaseOffer;
  /** The verb's words where the caller has them; *Release* otherwise. */
  readonly label?: string;
  /** `compact` where it stands among the projects page's verbs. */
  readonly size?: "sm" | "compact";
  /** `outline` in a stop's verdict, where a verb stands beside the sentence it acts on. */
  readonly variant?: "outline";
}) {
  const [confirming, setConfirming] = useState(false);
  if (!release.offered) return null;
  return (
    <>
      <Button
        data-zerops-primary-action="Release"
        disabled={release.releasing}
        onClick={() => {
          setConfirming(true);
        }}
        size={size}
        variant={variant}
      >
        {release.releasing
          ? flowVerbLabel("release", true)
          : (label ?? flowVerbLabel("release", false))}
      </Button>
      <ZeropsReleaseDialog
        contents={release.contents}
        onConfirm={() => {
          setConfirming(false);
          release.onRelease();
        }}
        onOpenChange={setConfirming}
        open={confirming}
        releasing={release.releasing}
        tag={release.tag}
      />
    </>
  );
}

/** A section with nothing in it yet, and the way to put something there. */
function Empty({
  text,
  action,
  onAction,
}: {
  readonly text: string;
  readonly action: string;
  readonly onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Note>{text}</Note>
      <Button onClick={onAction} size="sm" variant="outline">
        {action}
      </Button>
    </div>
  );
}

/**
 * What the project needs somebody for, before anything else on the page.
 *
 * Not a Section: it is the answer, and an answer that looks like the four
 * blocks under it is an answer nobody reads first. It sits in a panel, above
 * the heading rhythm, and every row is the way to deal with the thing it
 * names.
 */
function AttentionPanel({
  items,
  onAct,
  release,
}: {
  readonly items: ReadonlyArray<ProjectAttentionItem>;
  readonly onAct: (item: ProjectAttentionItem) => void;
  /**
   * What *Release* would do, for the one item whose verb is not a way
   * somewhere. Without it that row drew a button with no target, and `onAct`
   * returned on the spot: the panel's only completing verb did nothing.
   */
  readonly release: ReleaseOffer;
}) {
  const [first] = items;
  if (first === undefined) {
    return (
      <p
        className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground"
        data-zerops-surface="project-attention-clear"
      >
        {PROJECT_ALL_CLEAR}
      </p>
    );
  }
  const worst = ATTENTION_TONE[first.kind];
  return (
    <ul
      // The edge wears the worst thing inside it, and the list is ordered
      // worst first. It used to be amber whatever it held, so a panel whose
      // only row was a blue *Release* still had a blocked change's border.
      className={cn("flex flex-col overflow-hidden rounded-lg border", VERDICT_BORDER_CLASS[worst])}
      data-zerops-surface="project-attention"
    >
      {items.map((item) => (
        <li
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
          key={`${item.kind}:${item.text}`}
        >
          <StatusDot
            className="min-w-0 text-sm text-foreground"
            label={item.text}
            sentence
            tone={ATTENTION_TONE[item.kind]}
          />
          {/* One column for the verbs: three buttons stacked with only
              `justify-end` between them landed on three different edges.
              `min-w`, not `w`: `See the build` is wider than `Open`. */}
          <span className="flex min-w-28 shrink-0 justify-end">
            {item.kind === "not-live" ? (
              // The release asks before it goes, so it brings its own confirm
              // rather than being a button that reports to `onAct`.
              <ReleaseAction release={release} />
            ) : item.verb === undefined ? null : (
              <Button
                onClick={() => {
                  onAct(item);
                }}
                size="sm"
                variant="outline"
              >
                {item.verb}
              </Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A change's opening answer: can it land, and what moves it if it cannot.
 *
 * The page used to open on a four-row definition list and a greyed-out
 * *Merge* whose reason was two lines below it. Here the sentence and the
 * buttons that act on it are one element, for the reason a count and its cure
 * became one on the menu: "why are `1 waiting` and `Release` two different
 * elements?" (the owner, 2026-09-19). *Merge* stays drawn where the forge
 * would refuse it, disabled and carrying the refusal as its name — a button
 * that vanishes teaches the reader that this page does not merge.
 */
function ChangeVerdictPanel({
  askLabel,
  merging,
  onAsk,
  onMerge,
  trouble,
  verdict,
}: {
  /** What the remedy verb is called: `Ask Theo`, or `Ask the Mate`. */
  readonly askLabel: string;
  readonly merging: boolean;
  readonly onAsk: () => void;
  readonly onMerge: () => void;
  readonly trouble: string | null;
  readonly verdict: ChangeVerdict;
}) {
  return (
    <div data-zerops-surface="change-verdict">
      <VerdictPanel text={verdict.text} tone={verdict.tone}>
        {verdict.ask === undefined ? null : (
          <Button data-zerops-primary-action="Ask" onClick={onAsk} size="sm" variant="outline">
            {askLabel}
          </Button>
        )}
        {verdict.offersMerge ? (
          <Button
            aria-label={verdict.canMerge ? undefined : `Merge: ${verdict.text}`}
            data-zerops-primary-action="Merge"
            disabled={merging || !verdict.canMerge}
            onClick={onMerge}
            size="sm"
          >
            {flowVerbLabel("merge", merging)}
          </Button>
        ) : null}
      </VerdictPanel>
      {/* A verb that refused says so under the verb that refused, not in a
          toast somewhere off the page. */}
      {trouble === null ? null : (
        <p className="mt-2 text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
    </div>
  );
}

/**
 * A halted Mate and a failed deploy are not the same kind of bad — and work
 * merged and waiting is not bad at all.
 *
 * The list is ordered worst first, so the tones run down it as a ladder: red
 * broken, amber blocked, blue moving. *Release* wears the same blue in the
 * left menu; one fact does not get two colours depending on which surface
 * reports it.
 */
const ATTENTION_TONE: Record<ProjectAttentionKind, ServiceStatusToneId> = {
  "mate-waiting": "attention",
  "deploy-failed": "failed",
  "change-blocked": "attention",
  "not-live": "busy",
};

/** One Mate on a project's page: who it is and what it is on. */
export interface GroupMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly face: MateMarkState;
  /** What it is on, or was last on; absent until somebody has spoken to it. */
  readonly subject: string | undefined;
  readonly snippet: string | undefined;
  readonly when: string | undefined;
}

/**
 * Who is working on this project.
 *
 * The page listed environments, changes and commits and not one of the Mates
 * that made them — on a product whose whole proposition is that Mates do the
 * work (the owner, 2026-09-19: "it's basically a group dashboard and you
 * didn't think to show a preview of mates"). It is the first section because
 * it answers the first question anybody opens this page with.
 *
 * The same three lines the menu gives a Mate, at the page's size: the face
 * wearing its state, what it is on, and the last thing it said.
 */
function MateLine({
  mate,
  menu,
  onOpen,
}: {
  readonly mate: GroupMate;
  /** This Mate's own quiet actions — the same set the projects screen offers. */
  readonly menu?: React.ReactNode;
  readonly onOpen: (projectId: string) => void;
}) {
  return (
    // The row is a control and the menu is another: a button inside a button
    // is not a thing, so they sit side by side and the row keeps the hover.
    <li className="group/row flex min-w-0 items-center gap-1">
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={() => {
          onOpen(mate.projectId);
        }}
        type="button"
      >
        <MateFace size="md" state={mate.face} tint={mate.tint} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-sm leading-5 font-medium text-foreground">
              {mate.name}
            </span>
            {mate.when === undefined || mate.when.length === 0 ? null : (
              <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums">
                {mate.when}
              </span>
            )}
          </span>
          {mate.subject === undefined ? (
            <span className="truncate text-xs leading-4 text-muted-foreground/70">
              Nothing asked of it yet
            </span>
          ) : (
            <span className="truncate text-xs leading-4 text-muted-foreground">{mate.subject}</span>
          )}
          {mate.snippet === undefined ? null : (
            <span className="truncate text-xs leading-4 text-muted-foreground/70">
              {mate.snippet}
            </span>
          )}
        </span>
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
      {menu === undefined ? null : <span className="shrink-0">{menu}</span>}
    </li>
  );
}

function StopLine({
  environment,
  groupId,
  groupName,
  notice,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  /** The project's name, so a stop under it does not repeat it. */
  readonly groupName: string | undefined;
  /**
   * Said in place of the stop while the grant withholds its project: its
   * tier stays, and its name, what it runs and its page do not (DESIGN §3.4).
   */
  readonly notice: string | null;
}) {
  const navigate = useNavigate();
  const word = deployWord(environment.tone);
  const dotTone = STOP_DOT_TONE[environment.tone];
  const open = useCallback(() => {
    void navigate({
      to: "/group/$groupId/$projectId",
      params: { groupId, projectId: environment.projectId },
    });
  }, [environment.projectId, groupId, navigate]);
  if (notice !== null) {
    return (
      <li className="flex min-w-0 items-baseline gap-3 px-2 py-2">
        <span className="shrink-0 text-sm font-medium text-foreground">{environment.tier}</span>
        <span className="truncate text-xs text-muted-foreground">{notice}</span>
      </li>
    );
  }
  return (
    <li>
      <button
        // Fixed tracks, not a right-ragged flex: a version and a state that
        // start at a different x on every row cannot be read down the column.
        className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_6rem_7.5rem_1rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={open}
        type="button"
      >
        {/* `Links - stage` under a page titled `Links` says it twice. */}
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {environmentNameUnderGroup(groupName, environment.name)}
        </span>
        <span className="truncate text-end font-mono text-xs text-muted-foreground tabular-nums">
          {environment.version.label ?? "none"}
        </span>
        {/* Never a wordless dot on its own: a colour that has to be learnt is
            a colour nobody reads, and a screen reader gets nothing from it. */}
        {/* The dot carries the state; the word supports it. Unsized, it
            inherited 16px and came out larger than the name it annotates. */}
        {word === undefined || dotTone === undefined ? null : (
          <StatusDot
            className="shrink-0 text-xs text-muted-foreground"
            label={word}
            sentence
            tone={dotTone}
          />
        )}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
    </li>
  );
}

function ChangeLine({
  groupId,
  pull,
}: {
  readonly groupId: string;
  readonly pull: FlowPullRequest;
}) {
  const navigate = useNavigate();
  // One vocabulary down the column: `changeState` answers a rebase and a
  // passing check in the same register, which two sources did not.
  const state = changeState(pull);
  // The group page is where somebody comes looking for a change, so its rows
  // open one — a stop's row next to it has always been a door.
  const open = useCallback(() => {
    void navigate({
      to: "/change/$groupId/$repository/$number",
      params: { groupId, repository: pull.repository, number: String(pull.number) },
    });
  }, [groupId, navigate, pull.number, pull.repository]);
  return (
    <li>
      <button
        className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_7.5rem_1rem] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={open}
        type="button"
      >
        <span className="min-w-0 truncate text-sm text-foreground">{sidebarChangeLabel(pull)}</span>
        {state === undefined ? null : (
          <StatusDot
            className="shrink-0 text-xs text-muted-foreground"
            label={state.word}
            sentence
            tone={state.tone}
          />
        )}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
    </li>
  );
}

/** One step of the trail above a page's name. */
export interface Crumb {
  readonly label: string;
  readonly onClick: () => void;
}

/**
 * The bar's right side, as /zerops has it: the organization, once there is a
 * choice to show, and the account.
 *
 * Read by the pages only — the panes are drawn by harnesses and tests with no
 * session behind them, so they take it handed in.
 */
function useFrameActions(): React.ReactNode {
  const { activeOrganization, organizations, organizationStatus, selectOrganization, status } =
    useZeropsSession();
  const scoped =
    status === "signed-in" && organizationStatus === "selected" && activeOrganization !== null;
  return (
    <>
      {scoped ? (
        <ZeropsOrganizationSwitcher
          activeOrganization={activeOrganization}
          organizations={organizations}
          onSelect={(membershipId) => {
            void selectOrganization(membershipId);
          }}
        />
      ) : null}
      <ZeropsSessionAccountControl />
    </>
  );
}

function DetailShell({
  title,
  titleTag,
  subtitle,
  actions,
  crumbs,
  frameActions,
  children,
}: {
  readonly title: string;
  /** What kind of thing the page is about, as a pill trailing its name. */
  readonly titleTag?: React.ReactNode;
  readonly subtitle?: string;
  /** The verbs this page carries, beside its name rather than under it. */
  readonly actions?: React.ReactNode;
  /**
   * Where this page sits, outermost first. A stop used to offer only "back to
   * the conversation", so reaching its project meant leaving through the chat
   * and coming in again.
   */
  readonly crumbs: ReadonlyArray<Crumb>;
  /** The bar's right side; absent where no session is behind the page. */
  readonly frameActions?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <ZeropsHostedFrame
      actions={frameActions}
      // The trail is a way out, not the page's business: it sits in the bar,
      // where /zerops keeps its own, rather than competing with the verbs
      // beside the name.
      breadcrumb={
        crumbs.length === 0 ? undefined : (
          <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
            {crumbs.map((crumb, index) => (
              <Fragment key={crumb.label}>
                {index === 0 ? null : <WorkspaceBreadcrumbSeparator />}
                <WorkspaceBreadcrumbItem className="min-w-0 shrink">
                  <button
                    className="min-w-0 cursor-pointer truncate hover:text-foreground"
                    onClick={crumb.onClick}
                    type="button"
                  >
                    {crumb.label}
                  </button>
                </WorkspaceBreadcrumbItem>
              </Fragment>
            ))}
          </WorkspaceBreadcrumb>
        )
      }
      width="expanded"
    >
      {/* The frame's page gap spaces the header and every block after it, as on /zerops. */}
      <header>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="min-w-0 text-2xl leading-8 font-semibold tracking-tight wrap-anywhere">
                {title}
              </h1>
              {titleTag}
            </div>
            {subtitle === undefined ? null : (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions === undefined ? null : (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      </header>
      {children}
    </ZeropsHostedFrame>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      {/* A hairline under the heading: without one the page was four blocks of
          identical weight and a reader had to parse it to find the seams. */}
      <h2 className="mb-3 border-b border-border pb-1.5 text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * What a section drawn from the listing says in place of a "none" it may not
 * say yet: its message, after the delay that keeps a quick answer from
 * flickering it, and its one affordance.
 */
function ListingNotice({
  notice,
  onAct,
}: {
  readonly notice: CandidatesNotice;
  readonly onAct?: ((affordance: KnownAffordance) => void) | undefined;
}) {
  const { affordance, message } = notice;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3",
        message.afterMs > 0 && "animate-zerops-appear",
      )}
      role={notice.region === "message" ? "alert" : "status"}
      style={message.afterMs > 0 ? { animationDelay: `${message.afterMs}ms` } : undefined}
    >
      <p
        className={cn(
          "text-sm",
          message.tone === "alert"
            ? "text-[var(--zerops-status-failed-text)]"
            : "text-muted-foreground",
        )}
      >
        {message.text}
      </p>
      {affordance === null || onAct === undefined ? null : (
        <Button onClick={() => onAct(affordance)} size="sm" variant="outline">
          {affordance.label}
        </Button>
      )}
    </div>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
