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
  buildZeropsGroupTree,
  changeAskLabel,
  changeConversationCount,
  changeRemarks,
  changeState,
  deployWord,
  flowVerbKey,
  flowVerbLabel,
  pullRequestBlocked,
  pullRequestMergeLine,
  releaseContentsSummary,
  type ReleaseContentsSummary,
  sidebarChangeLabel,
  type ChangeRemark,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupRowTone,
} from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAskMate } from "~/zerops/useAskMate";
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
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { ZeropsChangeConversation } from "./ZeropsChangeConversation";
import { ZeropsDeployRunView } from "./ZeropsDeployRun";
import { ZeropsMergeDialog } from "./ZeropsMergeDialog";
import { ZeropsReleaseDialog } from "./ZeropsReleaseDialog";
import { ZeropsHistoryView } from "./ZeropsHistoryView";
import { checkDotTone } from "./ZeropsGitBlock";
import { StatusDot } from "./primitives";

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
  const back = useBackToConversation();
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

  if (flow === undefined) {
    return (
      <DetailShell onBack={back} title={groupName ?? "Project"}>
        <Note>This project has not been read yet.</Note>
      </DetailShell>
    );
  }

  return (
    <ZeropsGroupPane
      commits={commits}
      environments={environments}
      groupId={groupId}
      name={groupName ?? flow.groupId}
      onBack={back}
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
  groupId,
  name,
  onBack,
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
  readonly onBack: () => void;
  /** Where a project with nothing set up goes to get something set up. */
  readonly onSetUp: () => void;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  readonly release: ReleaseOffer;
  /** The repository its history is read from; absent where none is declared. */
  readonly repo: string | undefined;
  readonly slug: string;
  readonly waiting: ReleaseContentsSummary;
}) {
  const deployed = useMemo(() => deployedShas(environments), [environments]);
  return (
    <DetailShell
      actions={<ReleaseAction release={release} />}
      onBack={onBack}
      subtitle={slug}
      title={name}
    >
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
              <StopLine environment={environment} groupId={groupId} key={environment.projectId} />
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
  const back = useBackToConversation();
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
      <DetailShell onBack={back} title="Environment">
        <Note>This environment has not been read yet.</Note>
      </DetailShell>
    );
  }

  return (
    <ZeropsStopPane
      commits={commits}
      deployed={deployed}
      onBack={back}
      production={production}
      readDetail={readDetail}
      release={release}
      repo={repo}
      run={run}
      slug={flow.slug}
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
  onBack,
  production,
  readDetail,
  release,
  repo,
  run,
  slug,
  stop,
  waiting,
}: {
  readonly commits: ZeropsCommitsState;
  /** `environment name → the whole sha it runs`, for the history's own marks. */
  readonly deployed: ReadonlyMap<string, string>;
  readonly onBack: () => void;
  readonly production: boolean;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  /** Offered on a production that is behind — the one stop a release moves. */
  readonly release: ReleaseOffer;
  readonly repo: string | undefined;
  readonly run: ZeropsDeployRun;
  readonly slug: string;
  readonly stop: EnvironmentRow;
  readonly waiting: ReleaseContentsSummary;
}) {
  const word = deployWord(stop.tone);
  const dotTone = STOP_DOT_TONE[stop.tone];
  return (
    <DetailShell
      actions={production ? <ReleaseAction release={release} /> : undefined}
      onBack={onBack}
      subtitle={`${slug} · ${stop.source}`}
      title={stop.name}
    >
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
          <Fact term="Follows">{stop.source}</Fact>
        </dl>
      </Section>

      {!production || waiting.total === 0 ? null : (
        <Section title={`Not in it yet · ${String(waiting.total)}`}>
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

      <Section title="How it got here">
        <ZeropsDeployRunView run={run} />
      </Section>

      <Section title={repo === undefined ? "What is in it" : `What is in it · ${repo}`}>
        {repo === undefined ? (
          <Note>
            No repository is declared for this environment&rsquo;s services, so its history cannot
            be read.
          </Note>
        ) : (
          <ZeropsHistoryView
            commits={commits}
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
  const onBack = useBackToConversation();
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
  const slug = flow?.slug;
  const merge = useCallback(() => {
    if (flowValue === null || slug === undefined || pull === undefined) return;
    void flowValue.mergePullRequest(slug, { repository: pull.repository, number: pull.number });
  }, [flowValue, pull, slug]);

  if (flow === undefined || pull === undefined) {
    return (
      <DetailShell onBack={onBack} title={`#${String(number)}`}>
        <Note>This change is not open on {repository} any more.</Note>
      </DetailShell>
    );
  }

  return (
    <ZeropsChangePane
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
      onAsk={askMate}
      onBack={onBack}
      onMerge={merge}
      pull={pull}
      readDetail={readDetail}
      remarks={remarks}
      slug={flow.slug}
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
  comments,
  commits,
  mateName,
  merging,
  onAsk,
  onBack,
  onMerge,
  pull,
  readDetail,
  remarks,
  slug,
  trouble,
}: {
  readonly comments: ZeropsChangeComments;
  readonly commits: ZeropsCommitsState;
  readonly mateName: string | undefined;
  readonly merging: boolean;
  readonly onAsk: (mateProjectId: string | undefined, ask: string) => void;
  readonly onBack: () => void;
  readonly onMerge: () => void;
  readonly pull: FlowPullRequest;
  readonly readDetail?: ((sha: string) => Promise<ZeropsCommitDetailResult>) | undefined;
  readonly remarks: ReadonlyArray<ChangeRemark>;
  /** The project's Gitea org — the subtitle's first word. */
  readonly slug: string;
  /** What the last verb's refusal said, where one refused. */
  readonly trouble: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const blocked = pullRequestBlocked(pull);
  const checks = checkDotTone(pull);
  return (
    <DetailShell
      actions={
        <>
          <Button
            data-zerops-primary-action="Merge"
            disabled={merging || blocked !== null}
            onClick={() => {
              setConfirming(true);
            }}
            size="sm"
          >
            {flowVerbLabel("merge", merging)}
          </Button>
          {/* The same confirm the menu's verb opens: one verb, one question. */}
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
        </>
      }
      onBack={onBack}
      subtitle={`${slug} · ${pull.repository} · ${pull.baseBranch}`}
      title={pull.title}
    >
      <Section title="Where it stands">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          <Fact term="Change">#{pull.number}</Fact>
          {pull.author === undefined ? null : <Fact term="Opened by">{pull.author}</Fact>}
          <Fact term="Checks">
            {pull.checkWord === undefined || checks === undefined ? (
              "Nothing has run yet"
            ) : (
              <StatusDot label={pull.checkWord} sentence tone={checks} />
            )}
          </Fact>
          <Fact term="Merges">
            {blocked === null ? (
              pullRequestMergeLine(pull)
            ) : (
              <StatusDot label={pullRequestMergeLine(pull)} sentence tone={blocked.tone} />
            )}
          </Fact>
        </dl>
        {blocked?.ask === undefined ? null : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* What is stopping it is the Mate's to move, so the sentence that
                says so is the button that hands it over rather than advice. */}
            <Button
              onClick={() => {
                onAsk(pull.mateProjectId, blocked.ask ?? "");
              }}
              size="sm"
              variant="outline"
            >
              {changeAskLabel(mateName)} to fix it
            </Button>
            <span className="min-w-0 text-sm text-muted-foreground">{blocked.ask}</span>
          </div>
        )}
        {trouble === null ? null : (
          <p className="mt-3 text-sm text-[var(--zerops-status-failed-text)]">{trouble}</p>
        )}
      </Section>

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

      <Section title={`What it carries · ${pull.repository}`}>
        <ZeropsHistoryView
          commits={commits}
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

/**
 * The way out of a detail page: the conversation it stands in place of.
 *
 * `/` is the index, which lands on the environment's one conversation — the
 * same place closing the page ought to leave you.
 */
function useBackToConversation(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);
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

function StopLine({
  environment,
  groupId,
}: {
  readonly environment: EnvironmentRow;
  readonly groupId: string;
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
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={open}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {environment.name}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {environment.version.label ?? "nothing deployed yet"}
        </span>
        {/* Never a wordless dot on its own: a colour that has to be learnt is
            a colour nobody reads, and a screen reader gets nothing from it. */}
        {word === undefined || dotTone === undefined ? null : (
          <StatusDot label={word} sentence tone={dotTone} />
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
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
        onClick={open}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {sidebarChangeLabel(pull)}
        </span>
        {state === undefined ? null : <StatusDot label={state.word} sentence tone={state.tone} />}
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
    </li>
  );
}

function DetailShell({
  title,
  subtitle,
  actions,
  onBack,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  /** The verbs this page carries, beside its name rather than under it. */
  readonly actions?: React.ReactNode;
  /** Where the way out goes; the shell holds no router of its own. */
  readonly onBack: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-y-auto overscroll-y-none bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-8">
          {/* Going back is a way out, not the page's business: it sits above
              the name, quiet, rather than competing with the verbs below it. */}
          <Button
            className="-ms-2 mb-3 h-7 px-2 text-muted-foreground hover:text-foreground"
            onClick={onBack}
            size="sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to the conversation
          </Button>
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
    <section className="mb-9">
      <h2 className="mb-2 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
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
