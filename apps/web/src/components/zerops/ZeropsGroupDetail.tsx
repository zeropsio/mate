/**
 * A project group's page, and one stop's, in place of the thread.
 *
 * The left menu draws a project as a timeline of where work *is*. These are
 * the same drawing with room: the group's over *time*, a stop's around the one
 * commit it happens to be running. They mount under the chat layout and render
 * their own `SidebarInset`, so the menu stays put and only the pane changes —
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
  environmentAttention,
  environmentNameUnderGroup,
  flowVerbKey,
  flowVerbLabel,
  preferredMateTint,
  readZeropsGroupTags,
  PROJECT_ALL_CLEAR,
  projectAttention,
  releaseContentsSummary,
  type ReleaseContentsSummary,
  resolvePrimaryConversation,
  sidebarChangeLabel,
  stopSourceLine,
  type ChangeRemark,
  type ChangeVerdict,
  type ProjectAttentionItem,
  type ZeropsPublicRoute,
  type ProjectAttentionKind,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupRowTone,
} from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PlusIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

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
import { giteaSessionLogin } from "~/zerops/giteaSession";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsChangeComments } from "~/zerops/useZeropsChangeComments";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import type { ZeropsChangeComments } from "~/zerops/useZeropsChangeComments";
import type { ZeropsCommitDetailResult } from "~/zerops/useZeropsCommitDetail";
import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";
import { useZeropsCommitDetailReader } from "~/zerops/useZeropsCommitDetail";
import type { ZeropsDeployRun } from "~/zerops/useZeropsDeployRun";
import { useZeropsDeployRun } from "~/zerops/useZeropsDeployRun";
import {
  useZeropsChangeCommits,
  useZeropsRepositoryCommits,
} from "~/zerops/useZeropsRepositoryCommits";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { ZeropsAskDialog } from "./ZeropsAskDialog";
import { ZeropsChangeConversation } from "./ZeropsChangeConversation";
import { ZeropsDeployRunView } from "./ZeropsDeployRun";
import { ZeropsMergeDialog } from "./ZeropsMergeDialog";
import { ZeropsReleaseDialog } from "./ZeropsReleaseDialog";
import { ZeropsHistoryView, type HistoryNames } from "./ZeropsHistoryView";
import { MateFace, StatusDot } from "./primitives";

/** A stop's tone as a dot's. Neutral wears none: nothing has been deployed. */
const STOP_DOT_TONE: Record<GroupRowTone, ServiceStatusToneId | undefined> = {
  good: "ok",
  pending: "busy",
  bad: "failed",
  neutral: undefined,
};

/**
 * What the group is called, from the same derivation the menu names it by
 * (`buildZeropsGroupTree`) — never the raw group id, which is what a page
 * titled by its route parameter shows.
 */
function useGroupName(groupId: string): string | undefined {
  const { candidates } = useZeropsCandidates();
  return useMemo(
    () =>
      buildZeropsGroupTree(candidates, {}).groups.find((entry) => entry.group.groupId === groupId)
        ?.group.name,
    [candidates, groupId],
  );
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

/**
 * Every Mate on a project, as its page shows them.
 *
 * Read from the same three places the menu reads: the group tree for who is in
 * the group, the activity feed for what each is on, and `mateTints` for the
 * colour its face wears — so a Mate is the same Mate on both surfaces.
 */
function useGroupMates(groupId: string): ReadonlyArray<GroupMate> {
  const { candidates } = useZeropsCandidates();
  const activity = useZeropsAgentActivity();
  return useMemo(() => {
    const tints = assignCandidateMateTints(candidates);
    const group = buildZeropsGroupTree(candidates, {}).groups.find(
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
  }, [activity, candidates, groupId]);
}

/** Where a stop answers from, as the menu's globe reads it. */
function useStopRoutes(projectId: string): ReadonlyArray<ZeropsPublicRoute> {
  const { candidates } = useZeropsCandidates();
  return useMemo(
    () => candidates.find((entry) => entry.project.id === projectId)?.routes ?? EMPTY_ROUTES,
    [candidates, projectId],
  );
}

const EMPTY_ROUTES: ReadonlyArray<ZeropsPublicRoute> = [];

/** Opens a Mate's own conversation, as selecting its row in the menu does. */
function useOpenMate(): (projectId: string) => void {
  const { candidates } = useZeropsCandidates();
  const threads = useThreadShells();
  const navigate = useNavigate();
  return useCallback(
    (projectId: string) => {
      const candidate = candidates.find((entry) => entry.project.id === projectId);
      const environmentId = candidate?.environmentId;
      const { primary } =
        environmentId === undefined
          ? { primary: undefined }
          : resolvePrimaryConversation(
              threads.filter((thread) => thread.environmentId === environmentId),
            );
      // Not connected, or nothing started: the projects screen owns both.
      if (environmentId === undefined || primary === undefined) {
        void navigate({ to: "/zerops" });
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, primary.id)),
      });
    },
    [candidates, navigate, threads],
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

export function ZeropsGroupDetailPage({ groupId }: { readonly groupId: string }) {
  const flowValue = useZeropsProjectFlowOptional();
  const flow = flowValue?.flows.get(groupId);
  const environments = flow?.environments ?? [];
  const repo = groupRepository(environments);
  const deployed = useMemo(() => deployedShas(environments), [environments]);
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
  const release = useReleaseOffer(groupId);
  const crumbs = useCrumbs();
  const names = useHistoryNames(groupName);
  const mates = useGroupMates(groupId);
  const openMate = useOpenMate();
  const attention = useProjectAttention(groupId, mates, {
    environments,
    pullRequests: flow?.pullRequests ?? EMPTY_PULLS,
    notLive: waiting.total,
    canRelease: release.offered,
  });

  if (flow === undefined) {
    return (
      <DetailShell crumbs={crumbs} title={groupName ?? "Project"}>
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
      name={groupName ?? flow.groupId}
      onAct={attention.onAct}
      names={names}
      onAddMate={openProjects}
      onOpenMate={openMate}
      crumbs={crumbs}
      onSetUp={openProjects}
      release={release}
      pullRequests={flow.pullRequests}
      readDetail={readDetail}
      repo={repo}
      slug={flow.slug}
      waiting={waiting}
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
  onAct,
  name,
  names,
  crumbs,
  onAddMate,
  onOpenMate,
  onSetUp,
  pullRequests,
  readDetail,
  release,
  repo,
  slug,
  waiting,
}: {
  readonly commits: ZeropsCommitsState;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly groupId: string;
  readonly name: string;
  readonly crumbs: ReadonlyArray<Crumb>;
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
  /** Every Mate on this project, in the order the menu lists them. */
  readonly mates: ReadonlyArray<GroupMate>;
  readonly names: HistoryNames;
  readonly onAddMate: () => void;
  readonly onOpenMate: (projectId: string) => void;
  readonly slug: string;
  readonly waiting: ReleaseContentsSummary;
}) {
  const deployed = useMemo(() => deployedShas(environments), [environments]);
  return (
    <DetailShell
      // *Release* left the header when the panel below got a working one: a
      // page says a thing once, and the place it says it is the place you act
      // on it. *Add a Mate* stays — it answers nothing the panel raised.
      actions={
        <Button onClick={onAddMate} size="sm" variant="outline">
          <PlusIcon aria-hidden="true" className="size-3.5" />
          Add a Mate
        </Button>
      }
      crumbs={crumbs}
      subtitle={groupSubtitle(environments.length, pullRequests.length)}
      title={name}
    >
      <AttentionPanel items={attention} onAct={onAct} release={release} />

      <Section title="Who is on it">
        {mates.length === 0 ? (
          <Empty
            action="Add a Mate"
            onAction={onAddMate}
            text="No Mate is working on this project yet."
          />
        ) : (
          <ul className="flex flex-col">
            {mates.map((mate) => (
              <MateLine key={mate.projectId} mate={mate} onOpen={onOpenMate} />
            ))}
          </ul>
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
  const environments = flow?.environments ?? [];
  const stop = environments.find((entry) => entry.projectId === projectId);
  const repo = stop?.versionRepository;
  const deployed = useMemo(() => deployedShas(environments), [environments]);
  const commits = useZeropsRepositoryCommits(
    flow === undefined || repo === undefined
      ? null
      : { giteaOrigin: flowValue?.giteaOrigin, owner: flow.slug, repo },
  );
  const production = stop?.tier === "production";
  const waiting = releaseContentsSummary(flow?.release.contents ?? [], 20);
  // The build behind what is running — the reads for this existed and were
  // wired to nothing, so a failed deploy was a red dot and no more.
  const readDetail = useZeropsCommitDetailReader({
    giteaOrigin: flowValue?.giteaOrigin,
    owner: flow?.slug,
    repo,
  });
  const release = useReleaseOffer(groupId);
  const stopGroupName = useGroupName(groupId);
  const crumbs = useCrumbs({ groupId, name: stopGroupName ?? groupId });
  const names = useHistoryNames(stopGroupName);
  const routes = useStopRoutes(projectId);
  const run = useZeropsDeployRun(
    flow === undefined || repo === undefined
      ? null
      : {
          giteaOrigin: flowValue?.giteaOrigin,
          owner: flow.slug,
          repo,
          sha: stop?.version.sha,
        },
  );

  if (flow === undefined || stop === undefined) {
    return (
      <DetailShell crumbs={crumbs} title="Environment">
        <Note>This environment has not been read yet.</Note>
      </DetailShell>
    );
  }

  return (
    <ZeropsStopPane
      commits={commits}
      deployed={deployed}
      crumbs={crumbs}
      groupName={stopGroupName}
      names={names}
      production={production}
      readDetail={readDetail}
      release={release}
      routes={routes}
      repo={repo}
      run={run}
      stop={stop}
      waiting={waiting}
    />
  );
}

/**
 * One stop, drawn — every read already done and handed in.
 *
 * Split from the page for the same reason the others are: the states worth
 * looking at are a production twelve changes behind, a deploy that failed with
 * nothing running, and a stop nobody has ever deployed to, and none of them is
 * reachable by waiting for an account to be in that state.
 */
export function ZeropsStopPane({
  commits,
  deployed,
  crumbs,
  production,
  readDetail,
  groupName,
  names,
  release,
  routes,
  repo,
  run,
  stop,
  waiting,
}: {
  readonly commits: ZeropsCommitsState;
  /** `environment name → the whole sha it runs`, for the history's own marks. */
  readonly deployed: ReadonlyMap<string, string>;
  readonly crumbs: ReadonlyArray<Crumb>;
  readonly production: boolean;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  /** Offered on a production that is behind — the one stop a release moves. */
  readonly release: ReleaseOffer;
  readonly repo: string | undefined;
  readonly run: ZeropsDeployRun;
  /** The project's name, so the stop's own title does not repeat it. */
  readonly groupName: string | undefined;
  readonly names: HistoryNames;
  /** Where this stop answers from — a page about an environment you cannot open is half an answer. */
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly stop: EnvironmentRow;
  readonly waiting: ReleaseContentsSummary;
}) {
  const word = deployWord(stop.tone);
  const dotTone = STOP_DOT_TONE[stop.tone];
  const attention = environmentAttention({
    failed: stop.tone === "bad",
    deployed: stop.version.sha !== undefined,
    production,
    notLive: waiting.total,
    canRelease: release.offered,
  });
  return (
    <DetailShell
      crumbs={crumbs}
      subtitle={stopSourceLine(stop.source)}
      title={environmentNameUnderGroup(groupName, stop.name)}
    >
      {/* The same opening answer the project's page gives, one zoom in. It
          carries *Release* too, so the page that lists what is waiting is the
          page that can send it — it used to say so in a panel and act on it
          from the header, two elements for one thing. */}
      <AttentionPanel items={attention} onAct={NO_ACT} release={release} />

      <Section title="What is running">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          <Fact term="Version">{stop.version.label ?? "Nothing deployed yet"}</Fact>
          {stop.version.commit === undefined ? null : (
            <Fact term="Commit">
              <span className="font-mono tabular-nums">{stop.version.commit}</span>
            </Fact>
          )}
          {stop.version.taggedBy === undefined ? null : (
            <Fact term="Tagged by">{stop.version.taggedBy}</Fact>
          )}
          <Fact term="Last deploy">
            {word === undefined || dotTone === undefined ? (
              "Nothing has been deployed here"
            ) : (
              <StatusDot label={word} sentence tone={dotTone} />
            )}
          </Fact>
        </dl>
      </Section>

      {!production || waiting.total === 0 ? null : (
        <Section title={`Not live yet · ${String(waiting.total)}`}>
          <ul className="flex flex-col gap-1">
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

      {routes.length === 0 ? null : (
        <Section
          title={
            routes.length === 1 ? "Where it answers" : `Where it answers · ${String(routes.length)}`
          }
        >
          <ul className="flex flex-col">
            {routes.map((route) => (
              <li key={`${route.service}:${route.host}`}>
                <a
                  className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted"
                  href={route.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <GlobeIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{route.host}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{route.service}</span>
                  <ExternalLinkIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground/60"
                  />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="How it got here">
        <ZeropsDeployRunView run={run} />
      </Section>

      <Section title={repo === undefined ? "History" : `History · ${repo}`}>
        {repo === undefined ? (
          <Note>
            No repository is declared for this environment&rsquo;s services, so its history cannot
            be read.
          </Note>
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
  const pull = flow?.pullRequests.find(
    (entry) => entry.repository === repository && entry.number === number,
  );
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
  const names = useHistoryNames(groupName);
  const now = useNowMs();
  const slug = flow?.slug;
  const merge = useCallback(() => {
    if (flowValue === null || slug === undefined || pull === undefined) return;
    void flowValue.mergePullRequest(slug, { repository: pull.repository, number: pull.number });
  }, [flowValue, pull, slug]);

  if (flow === undefined || pull === undefined) {
    return (
      <DetailShell crumbs={crumbs} title={`#${String(number)}`}>
        <Note>This change is not open on {repository} any more.</Note>
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
export function ZeropsChangePane({
  age,
  comments,
  commits,
  mateName,
  merging,
  names,
  onAsk,
  crumbs,
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

/**
 * A stop's panel raises nothing that is dealt with somewhere else: its one
 * verb brings its own confirm, and the rest are statements.
 */
const NO_ACT = (): void => {};

/** Nothing in an unmerged change is running anywhere yet. */
const EMPTY_DEPLOYED: ReadonlyMap<string, string> = new Map();

/** Nothing said, and nobody to name: the states before the reads land. */
const EMPTY_REMARKS: ReadonlyArray<ChangeRemark> = [];
const EMPTY_MATE_NAMES: ReadonlyMap<string, string> = new Map();
const EMPTY_PULLS: ReadonlyArray<FlowPullRequest> = [];

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
function ReleaseAction({ release }: { readonly release: ReleaseOffer }) {
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
        size="sm"
      >
        {flowVerbLabel("release", release.releasing)}
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
        className="mb-8 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground"
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
      className={cn(
        "mb-8 flex flex-col overflow-hidden rounded-lg border",
        VERDICT_BORDER_CLASS[worst],
      )}
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
    <div className="mb-8" data-zerops-surface="change-verdict">
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5",
          VERDICT_BORDER_CLASS[verdict.tone],
        )}
      >
        <StatusDot
          className="min-w-0 text-sm text-foreground"
          label={verdict.text}
          sentence
          tone={verdict.tone}
        />
        <span className="flex shrink-0 items-center gap-2">
          {verdict.ask === undefined ? null : (
            <Button data-zerops-primary-action="Ask" onClick={onAsk} size="sm" variant="outline">
              {askLabel}
            </Button>
          )}
          <Button
            aria-label={verdict.canMerge ? undefined : `Merge: ${verdict.text}`}
            data-zerops-primary-action="Merge"
            disabled={merging || !verdict.canMerge}
            onClick={onMerge}
            size="sm"
          >
            {flowVerbLabel("merge", merging)}
          </Button>
        </span>
      </div>
      {/* A verb that refused says so under the verb that refused, not in a
          toast somewhere off the page. */}
      {trouble === null ? null : (
        <p className="mt-2 text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
      )}
    </div>
  );
}

/** The panel's edge, in the colour of the answer inside it. */
const VERDICT_BORDER_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "border-[var(--zerops-status-ok)]/40",
  busy: "border-[var(--zerops-status-busy)]/40",
  attention: "border-[var(--zerops-status-attention)]/40",
  failed: "border-[var(--zerops-status-failed)]/40",
  off: "border-border",
};

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
  // No signal rather than a bad one: an environment nobody has deployed to is
  // not broken, it is empty.
  "never-deployed": "off",
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
  onOpen,
}: {
  readonly mate: GroupMate;
  readonly onOpen: (projectId: string) => void;
}) {
  return (
    <li>
      <button
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
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
    </li>
  );
}

function StopLine({
  environment,
  groupId,
  groupName,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
  /** The project's name, so a stop under it does not repeat it. */
  readonly groupName: string | undefined;
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

function DetailShell({
  title,
  subtitle,
  actions,
  crumbs,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  /** The verbs this page carries, beside its name rather than under it. */
  readonly actions?: React.ReactNode;
  /**
   * Where this page sits, outermost first. A stop used to offer only "back to
   * the conversation", so reaching its project meant leaving through the chat
   * and coming in again.
   */
  readonly crumbs: ReadonlyArray<Crumb>;
  readonly children: React.ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-y-auto overscroll-y-none bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-8">
          {/* The trail is a way out, not the page's business: it sits above
              the name, quiet, rather than competing with the verbs below it. */}
          <nav aria-label="Breadcrumb" className="-ms-2 mb-3 flex min-w-0 flex-wrap items-center">
            {crumbs.map((crumb, index) => (
              <span className="flex min-w-0 items-center" key={crumb.label}>
                {index === 0 ? (
                  <ArrowLeftIcon
                    aria-hidden="true"
                    className="ms-2 size-3.5 text-muted-foreground"
                  />
                ) : (
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground/60"
                  />
                )}
                <Button
                  className="h-7 min-w-0 px-2 text-muted-foreground hover:text-foreground"
                  onClick={crumb.onClick}
                  size="sm"
                  variant="ghost"
                >
                  <span className="min-w-0 truncate">{crumb.label}</span>
                </Button>
              </span>
            ))}
          </nav>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl leading-8 font-semibold tracking-tight wrap-anywhere">
                {title}
              </h1>
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
      </div>
    </SidebarInset>
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
    <section className="mb-8">
      {/* A hairline under the heading: without one the page was four blocks of
          identical weight and a reader had to parse it to find the seams. */}
      <h2 className="mb-3 border-b border-border pb-1.5 text-sm font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ term, children }: { readonly term: string; readonly children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
