/**
 * The group, read from its own repository — the Git tab's second half.
 *
 * Everything below the repositories comes from the group repo as the person:
 * `environments.yaml` says which environments there are and what feeds them,
 * the `v*` tags and their `mate/release/{tag}` statuses are the releases, and
 * the open pull requests are the recipe changes.
 *
 * ## What this half deliberately does not say
 *
 * **Which commit an environment is running.** That lives in the deployed
 * version's name on the Zerops side, and the group repo cannot prove it: a
 * branch head is what *should* be there (guide 4.5). So an environment row
 * here names what feeds it and stops. The commit comes from the account read
 * beside this one (`groupDeploys.ts`), which the surface performs for this
 * Mate's group exactly as the projects screen does for every group — including
 * production's side of the release comparison, which is what production runs
 * rather than what the newest tag asked for.
 *
 * Re-read when the tab opens, after each action, and every sixty seconds while
 * it is open (`useZeropsGitForge` keeps the same clock). Nothing here is
 * cached across a sign-out: without a Gitea session there is nothing to read
 * and the hook makes no call at all.
 */

import {
  environmentRow,
  isReleaseTag,
  pullRequestRow,
  readGroupEnvironments,
  readReleaseMessage,
  releaseVerdict,
  shortCommit,
  suggestReleaseTags,
  type EnvironmentRow,
  type GiteaClient,
  type GroupEnvironment,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";
import type { ZeropsGitRecipeChange, ZeropsGitRelease } from "../components/zerops/ZeropsGitPanel";

const GROUP_REPOSITORY = "group";
const ENVIRONMENTS_PATH = "environments.yaml";
/** How often the group half is re-read while the tab is open. */
export const GROUP_REPO_REFRESH_MS = 60_000;

export interface ZeropsGroupRepoState {
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly releases: ReadonlyArray<ZeropsGitRelease>;
  readonly recipeChanges: ReadonlyArray<ZeropsGitRecipeChange>;
  /** Every `v*` tag, so the next one can be suggested without reusing a name. */
  readonly tags: ReadonlyArray<string>;
}

const EMPTY: ZeropsGroupRepoState = {
  declarations: [],
  environments: [],
  releases: [],
  recipeChanges: [],
  tags: [],
};

export function useZeropsGroupRepo(input: {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly generation: number;
  readonly enabled: boolean;
}): ZeropsGroupRepoState {
  const { enabled, generation, giteaOrigin, owner } = input;
  const key =
    enabled && giteaOrigin !== undefined && owner !== undefined ? `${giteaOrigin}|${owner}` : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly state: ZeropsGroupRepoState;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === "") return;
    const timer = setInterval(() => setTick((current) => current + 1), GROUP_REPO_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined || owner === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    const controller = new AbortController();
    void readGroupRepo(client, owner)
      .then((state) => {
        if (!controller.signal.aborted) setAnswer({ key, state });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswer({ key, state: EMPTY });
      });
    return () => {
      controller.abort();
    };
  }, [generation, giteaOrigin, key, owner, tick]);

  return answer?.key === key ? answer.state : EMPTY;
}

async function readGroupRepo(client: GiteaClient, owner: string): Promise<ZeropsGroupRepoState> {
  const file = await client.readFile(owner, GROUP_REPOSITORY, ENVIRONMENTS_PATH, "main");
  const declarations = file === undefined ? [] : readGroupEnvironments(file.content);

  const environments = declarations.map((declaration) =>
    environmentRow({
      projectId: declaration.project,
      name: declaration.name,
      tier: declaration.tier,
      sources: declaration.sources,
      environment: declaration.name,
      // No services: what an environment runs is the account's to prove, and
      // a row that guessed would be the "configured" the guide warns about.
      services: [],
    }),
  );

  const tags = await client.listTags(owner, GROUP_REPOSITORY).catch(() => []);
  const releaseTags = tags.filter((tag) => isReleaseTag(tag.name));
  const releases: Array<ZeropsGitRelease> = [];
  for (const tag of releaseTags) {
    const entries = readReleaseMessage(tag.message ?? "");
    const sha = tag.commit?.sha;
    const statuses =
      sha === undefined
        ? []
        : await client.listCommitStatuses(owner, GROUP_REPOSITORY, sha).catch(() => []);
    const { verdict, detail } = releaseVerdict(tag.name, statuses);
    releases.push({
      tag: tag.name,
      verdict,
      detail: verdict === "refused" ? detail : undefined,
      line: entries.map((entry) => `${entry.service} ${shortCommit(entry.commit)}`).join(" · "),
    });
  }

  const pulls = await client
    .listPullRequests(owner, GROUP_REPOSITORY, { state: "open" })
    .catch(() => []);

  return {
    declarations,
    environments,
    releases,
    recipeChanges: pulls.map((pull) => {
      const row = pullRequestRow(pull);
      return { number: row.number, title: row.title, line: row.line, url: pull.html_url };
    }),
    tags: releaseTags.map((tag) => tag.name),
  };
}
