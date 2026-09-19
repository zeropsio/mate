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
  deployWord,
  pullRequestBlocked,
  releaseContentsSummary,
  sidebarChangeLabel,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupRowTone,
} from "@t3tools/client-runtime/zerops";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsProjectFlowOptional } from "~/zerops/projectFlowContext";
import { useZeropsDeployRun } from "~/zerops/useZeropsDeployRun";
import { useZeropsRepositoryCommits } from "~/zerops/useZeropsRepositoryCommits";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { ZeropsDeployRunView } from "./ZeropsDeployRun";
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

  if (flow === undefined) {
    return (
      <DetailShell title={groupName ?? "Project"}>
        <Note>This project has not been read yet.</Note>
      </DetailShell>
    );
  }

  return (
    <DetailShell subtitle={flow.slug} title={groupName ?? flow.groupId}>
      <Section title="Where it is">
        <ul className="flex flex-col">
          {environments.length === 0 ? (
            <Note>No stage or production declared yet.</Note>
          ) : (
            environments.map((environment) => (
              <StopLine environment={environment} groupId={groupId} key={environment.projectId} />
            ))
          )}
        </ul>
      </Section>

      <Section title="In flight">
        {flow.pullRequests.length === 0 ? (
          <Note>Nothing open. Every change the Mates made has landed.</Note>
        ) : (
          <ul className="flex flex-col">
            {flow.pullRequests.map((pull) => (
              <ChangeLine key={`${pull.repository}#${pull.number}`} pull={pull} />
            ))}
          </ul>
        )}
      </Section>

      {waiting.total === 0 ? null : (
        <Section title={`Merged, not live · ${String(waiting.total)}`}>
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

      <Section title={repo === undefined ? "History" : `History · ${repo}`}>
        {repo === undefined ? (
          <Note>No repository is declared for this project&rsquo;s services yet.</Note>
        ) : (
          <ZeropsHistoryView commits={commits} request={{ repo, deployed }} />
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
      <DetailShell title="Environment">
        <Note>This environment has not been read yet.</Note>
      </DetailShell>
    );
  }

  const word = deployWord(stop.tone);
  const dotTone = STOP_DOT_TONE[stop.tone];
  return (
    <DetailShell subtitle={`${flow.slug} · ${stop.source}`} title={stop.name}>
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
          <ZeropsHistoryView commits={commits} request={{ repo, deployed }} />
        )}
      </Section>
    </DetailShell>
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
        {word === undefined || dotTone === undefined ? null : (
          <StatusDot dotOnly label={word} tone={dotTone} />
        )}
      </button>
    </li>
  );
}

function ChangeLine({ pull }: { readonly pull: FlowPullRequest }) {
  const blocked = pullRequestBlocked(pull);
  const checks = checkDotTone(pull);
  return (
    <li className="flex min-w-0 items-center gap-3 px-2 py-2">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {sidebarChangeLabel(pull)}
      </span>
      {blocked === null ? (
        pull.checkWord === undefined || checks === undefined ? null : (
          <StatusDot label={pull.checkWord} sentence tone={checks} />
        )
      ) : (
        <StatusDot label={blocked.word} sentence tone={blocked.tone} />
      )}
    </li>
  );
}

function DetailShell({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-y-auto overscroll-y-none bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">{title}</h1>
          {subtitle === undefined ? null : (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
          <Button
            className="mt-4"
            onClick={() => {
              void navigate({ to: "/" });
            }}
            size="sm"
            variant="ghost"
          >
            Back to the conversation
          </Button>
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
