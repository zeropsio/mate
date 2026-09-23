import type { GiteaClient } from "@t3tools/client-runtime/zerops";
import { createGroupAnswers, flowVerbInvalidations } from "@t3tools/client-runtime/zerops/flow";
import { describe, expect, it } from "vite-plus/test";

import {
  deployGroupKey,
  readGroupDeploys,
  type ZeropsDeployGroup,
  type ZeropsGroupDeployState,
} from "./useZeropsGroupDeploys";

const SHA = "3f9c1b2000000000000000000000000000000000";

const GROUP: ZeropsDeployGroup = {
  groupId: "g1",
  slug: "harbor",
  projects: [
    {
      projectId: "p-stage",
      name: "Harbor - stage",
      services: [{ serviceId: "s1", hostname: "app" }],
    },
  ],
};

const NEIGHBOUR: ZeropsDeployGroup = {
  groupId: "g2",
  slug: "links",
  projects: [{ projectId: "p-links", name: "Links - stage", services: [] }],
};

describe("deployGroupKey", () => {
  it("is stable while nothing the group's reads depend on has changed", () => {
    expect(deployGroupKey(GROUP)).toBe(deployGroupKey({ ...GROUP }));
  });

  it("moves when a project's role appears, which is what fills a tier", () => {
    const withRole: ZeropsDeployGroup = {
      ...GROUP,
      projects: [{ ...GROUP.projects[0]!, role: "stage" }],
    };
    expect(deployGroupKey(withRole)).not.toBe(deployGroupKey(GROUP));
  });

  it("moves when the platform pushes a new active deploy, so the version is read again", () => {
    const running = (activeDeploy: string): ZeropsDeployGroup => ({
      ...GROUP,
      projects: [
        {
          ...GROUP.projects[0]!,
          services: [{ serviceId: "s1", hostname: "app", activeDeploy }],
        },
      ],
    });
    const before = running("2026-09-20T10:00:00Z v1.4.0");
    expect(deployGroupKey(before)).toBe(deployGroupKey(running("2026-09-20T10:00:00Z v1.4.0")));
    expect(deployGroupKey(running("2026-09-21T08:00:00Z v1.5.0"))).not.toBe(deployGroupKey(before));
  });

  it("Key change creates a fact; neighbours unchanged", async () => {
    const reads: string[] = [];
    const published: string[] = [];
    const answers = createGroupAnswers<ZeropsDeployGroup, never, string>({
      pass: "deploys",
      idOf: (group) => group.groupId,
      keyOf: deployGroupKey,
      read: async (group) => {
        reads.push(group.groupId);
        return () => `${group.groupId}@${reads.length}`;
      },
      publish: (groupId) => {
        published.push(groupId);
      },
      forget: () => {},
      failure: () => {},
    });
    answers.setGroups([GROUP, NEIGHBOUR]);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    // One project of the group resolves its services: the group is read again
    // on its own, and its neighbour is neither read nor published again.
    answers.setGroups([
      { ...GROUP, projects: [{ ...GROUP.projects[0]!, role: "stage" }] },
      NEIGHBOUR,
    ]);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(reads).toEqual(["g1", "g2", "g1"]);
    expect(published).toEqual(["g1", "g2", "g1"]);
    answers.dispose();
  });
});

/** The group repo declares one stage; the version read is the caller's. */
function groupRepo() {
  return {
    readFile: async (_owner: string, _repo: string, path: string) =>
      path === "environments.yaml"
        ? {
            content: `version: 1
environments:
  stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
`,
          }
        : undefined,
    listPullRequests: async () => [],
    listCommitStatuses: async () => [],
    getBranch: async () => undefined,
  } as unknown as GiteaClient;
}

describe("readGroupDeploys", () => {
  it("Merge re-reads only that repository's main on the deploy side", async () => {
    const calls: string[] = [];
    const client = {
      getBranch: async (owner: string, repo: string, branch: string) => {
        calls.push(`branch ${owner}/${repo} ${branch}`);
        return { commit: { id: "c0ffee0000000000000000000000000000000000" } };
      },
      commitDetail: async (owner: string, repo: string, sha: string) => {
        calls.push(`commit ${owner}/${repo}@${sha.slice(0, 7)}`);
        return { sha, subject: "Add the cart" };
      },
      compareCommits: async () => {
        calls.push("compare");
        return [];
      },
    } as unknown as GiteaClient;
    const apiContents = { service: "api", commits: [{ sha: "a1", subject: "Earlier" }] };
    const held: ZeropsGroupDeployState = {
      declarations: [],
      environments: [],
      pullRequests: [],
      missing: [],
      mainHeadRepositories: new Map([
        ["app", "appdev"],
        ["api", "apidev"],
      ]),
      mainHeads: new Map([
        ["app", SHA],
        ["api", "a1"],
      ]),
      releaseContents: [
        { service: "app", commits: [{ sha: SHA, subject: "Before the merge" }] },
        apiContents,
      ],
    };
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: { kind: "main-head", repository: "appdev" },
      readVersion: () => Promise.reject(new Error("not read on a merge")),
      held,
      signal: new AbortController().signal,
    });
    expect(calls).toEqual(["branch harbor/appdev main", "commit harbor/appdev@c0ffee0"]);
    const next = update(held);
    expect(next?.mainHeads).toEqual(
      new Map([
        ["app", "c0ffee0000000000000000000000000000000000"],
        ["api", "a1"],
      ]),
    );
    // The other repository's release contents are the ones already held.
    expect(next?.releaseContents).toEqual([
      {
        service: "app",
        commits: [{ sha: "c0ffee0000000000000000000000000000000000", subject: "Add the cart" }],
      },
      apiContents,
    ]);
    expect(next?.releaseContents[1]).toBe(apiContents);
    expect(next?.environments).toBe(held.environments);
  });

  it("a merge into the group repo reads its declarations again", async () => {
    const read: string[] = [];
    const repo = groupRepo();
    const client = {
      ...repo,
      readFile: (owner: string, repository: string, path: string, ref: string) => {
        read.push(`${repository}/${path}@${ref}`);
        return repo.readFile(owner, repository, path, ref);
      },
    } as unknown as GiteaClient;
    const held: ZeropsGroupDeployState = {
      declarations: [],
      environments: [],
      pullRequests: [],
      missing: [],
      mainHeadRepositories: new Map([["app", "appdev"]]),
      mainHeads: new Map(),
      releaseContents: [],
    };
    const { deploys } = flowVerbInvalidations({
      kind: "merge",
      slug: "harbor",
      repository: "group",
      number: 2,
    });
    if (deploys === null) throw new Error("a recipe merge changes the deploy half");
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: deploys,
      readVersion: async () => SHA,
      held,
      signal: new AbortController().signal,
    });
    expect(read).toContain("group/environments.yaml@main");
    expect(update(held)?.declarations.map((declaration) => declaration.name)).toEqual(["stage"]);
  });

  it("keeps the version the group last read when reading it again fails", async () => {
    const client = groupRepo();
    const first = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
    });
    const held = first(undefined) as ZeropsGroupDeployState;
    expect(held.environments[0]?.services[0]?.appVersionName).toBe(SHA);

    const again = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: () => Promise.reject(new Error("the platform refused the read")),
      held,
      signal: new AbortController().signal,
    });
    expect(again(held)?.environments[0]?.services[0]?.appVersionName).toBe(SHA);
  });

  it("answers that a group repo declaring nothing declares nothing, from its first read", async () => {
    const client = { ...groupRepo(), readFile: async () => undefined } as unknown as GiteaClient;
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
    });
    expect(update(undefined)).toMatchObject({ declarations: [], environments: [], missing: [] });
  });

  it("fails the group's read when the group repo does not answer, rather than declaring nothing", async () => {
    const client = {
      ...groupRepo(),
      readFile: () => Promise.reject(new Error("Gitea did not answer")),
    } as unknown as GiteaClient;
    await expect(
      readGroupDeploys({
        client,
        group: GROUP,
        scope: "group",
        readVersion: async () => SHA,
        held: undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Gitea did not answer");
  });
});
