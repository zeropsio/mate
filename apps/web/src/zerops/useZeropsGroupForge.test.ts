import type { GiteaClient, GiteaPullRequest } from "@t3tools/client-runtime/zerops";
import { flowVerbInvalidations } from "@t3tools/client-runtime/zerops/flow";
import { describe, expect, it } from "vite-plus/test";

import { readForge, type ZeropsGroupForgeState } from "./useZeropsGroupForge";

const pull = (number: number, merged = false): GiteaPullRequest => ({
  number,
  title: `Change ${number}`,
  state: merged ? "closed" : "open",
  merged,
  head: { ref: `mate/p${number}`, sha: `sha${number}` },
});

/** A Gitea org with two code repositories; every call is recorded, and a repository can refuse. */
function forge(refusing: ReadonlySet<string> = new Set()) {
  const calls: string[] = [];
  const open = new Map([
    ["appdev", [pull(4)]],
    ["apidev", [pull(7)]],
  ]);
  const client = {
    listOrganizationRepositories: async (org: string) => {
      calls.push(`repos ${org}`);
      return [{ name: "appdev" }, { name: "apidev" }];
    },
    listPullRequests: async (
      owner: string,
      repo: string,
      options: { readonly state: "open" | "closed" },
    ) => {
      calls.push(`pulls ${owner}/${repo} ${options.state}`);
      if (refusing.has(repo)) throw new Error("Gitea did not answer");
      return options.state === "open" ? (open.get(repo) ?? []) : [pull(1, true)];
    },
    listCommitStatuses: async (owner: string, repo: string, sha: string) => {
      calls.push(`statuses ${owner}/${repo}@${sha}`);
      return [];
    },
    listTags: async (owner: string, repo: string) => {
      calls.push(`tags ${owner}/${repo}`);
      return [];
    },
  } as unknown as GiteaClient;
  return { client, calls, open };
}

async function readAll(client: GiteaClient): Promise<ZeropsGroupForgeState> {
  const update = await readForge(client, "harbor", "group");
  const state = update(undefined);
  if (state === undefined) throw new Error("the first read answered nothing");
  return state;
}

describe("readForge", () => {
  it("Merge re-reads only that repo", async () => {
    const { client, calls, open } = forge();
    const held = await readAll(client);
    calls.length = 0;
    open.set("appdev", []);

    const { forge: scope } = flowVerbInvalidations({
      kind: "merge",
      slug: "harbor",
      repository: "appdev",
      number: 4,
    });
    const update = await readForge(client, "harbor", scope!);
    expect(calls).toEqual(["pulls harbor/appdev open", "pulls harbor/appdev closed"]);

    const next = update(held);
    expect(next?.pullRequests.map((row) => row.number)).toEqual([7]);
    // The other repository's rows are the ones already held, not a new read of them.
    expect(next?.pullRequests[0]).toBe(held.pullRequests[1]);
    expect(next?.releases).toBe(held.releases);
  });

  it("a failed forge read keeps the last PR rows", async () => {
    const healthy = forge();
    const held = await readAll(healthy.client);
    const { client } = forge(new Set(["appdev"]));

    const update = await readForge(client, "harbor", "group");
    const next = update(held);
    // appdev did not answer: its row stays; apidev answered and is read afresh.
    expect(next?.pullRequests.map((row) => [row.repository, row.number])).toEqual([
      ["appdev", 4],
      ["apidev", 7],
    ]);
    expect(next?.pullRequests[0]).toBe(held.pullRequests[0]);
  });

  it("answers nothing, rather than no pull requests, for a repository it never read", async () => {
    const { client } = forge(new Set(["appdev"]));
    const update = await readForge(client, "harbor", "group");
    expect(update(undefined)).toBeUndefined();
  });

  it("reads a release's tags alone after a release", async () => {
    const { client, calls } = forge();
    const held = await readAll(client);
    calls.length = 0;
    const update = await readForge(client, "harbor", { kind: "tags" });
    expect(calls).toEqual(["tags harbor/group"]);
    expect(update(held)?.pullRequests).toBe(held.pullRequests);
  });
});
