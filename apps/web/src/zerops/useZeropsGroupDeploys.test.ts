import type { GiteaClient } from "@t3tools/client-runtime/zerops";
import { createGroupAnswers } from "@t3tools/client-runtime/zerops/flow";
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
  it("keeps the version the group last read when reading it again fails", async () => {
    const client = groupRepo();
    const first = await readGroupDeploys({
      client,
      group: GROUP,
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
    });
    const held = first(undefined) as ZeropsGroupDeployState;
    expect(held.environments[0]?.services[0]?.appVersionName).toBe(SHA);

    const again = await readGroupDeploys({
      client,
      group: GROUP,
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
        readVersion: async () => SHA,
        held: undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Gitea did not answer");
  });
});
