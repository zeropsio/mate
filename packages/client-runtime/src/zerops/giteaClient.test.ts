import { describe, expect, it } from "vite-plus/test";

import {
  base64Decode,
  base64Encode,
  createGiteaClient,
  GiteaApiError,
  type GiteaClient,
} from "./giteaClient.ts";

const ORIGIN = "https://web-1234-3000.prg1.zerops.app";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function fake(answers: ReadonlyArray<{ status?: number; body?: unknown; text?: string }>): {
  readonly client: GiteaClient;
  readonly calls: ReadonlyArray<Call>;
} {
  const calls: Array<Call> = [];
  let index = 0;
  const client = createGiteaClient({
    origin: ORIGIN,
    token: "t-1",
    fetch: (input, init) => {
      const raw = typeof init?.body === "string" ? init.body : undefined;
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ]),
        ),
        body: raw === undefined ? undefined : JSON.parse(raw),
      });
      const answer = answers[index++] ?? { body: {} };
      if (answer.text !== undefined) {
        return Promise.resolve(new Response(answer.text, { status: answer.status ?? 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(answer.body ?? {}), {
          status: answer.status ?? 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  return { client, calls };
}

describe("base64", () => {
  it.each(["", "a", "ab", "abc", "version: 1\nenvironments: {}\n", "naïve — ✓"])(
    "round-trips %j",
    (text) => {
      expect(base64Decode(base64Encode(text))).toBe(text);
    },
  );

  it("decodes what Gitea sends, newlines and all", () => {
    const encoded = base64Encode("hello world");
    expect(base64Decode(`${encoded.slice(0, 4)}\n${encoded.slice(4)}`)).toBe("hello world");
  });
});

describe("GiteaClient request shapes", () => {
  it("bearers the token on every call, under /api/v1", async () => {
    const { client, calls } = fake([{ body: { id: 1, login: "u-jan" } }]);
    await client.currentUser();
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/user`);
    expect(calls[0]?.headers.authorization).toBe("Bearer t-1");
  });

  it("reads the current token each call, so a refresh needs no new client", async () => {
    let token = "first";
    const calls: Array<string> = [];
    const client = createGiteaClient({
      origin: ORIGIN,
      token: () => token,
      fetch: (_input, init) => {
        calls.push(((init?.headers ?? {}) as Record<string, string>).authorization ?? "");
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });
    await client.currentUser();
    token = "second";
    await client.currentUser();
    expect(calls).toEqual(["Bearer first", "Bearer second"]);
  });

  it("reads a repository with the permissions this person has there", async () => {
    const { client, calls } = fake([
      {
        body: {
          id: 3,
          name: "group",
          full_name: "acme/group",
          default_branch: "main",
          permissions: { admin: false, push: false, pull: true },
        },
      },
    ]);
    const repository = await client.getRepository("acme", "group");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group`);
    expect(repository?.permissions).toEqual({ admin: false, push: false, pull: true });
  });

  it.each([
    {
      what: "an org the broker has not made yet",
      call: (c: GiteaClient) => c.getOrganization("acme"),
    },
    {
      what: "a repository that is not there",
      call: (c: GiteaClient) => c.getRepository("acme", "group"),
    },
    {
      what: "a file the group repo does not carry yet",
      call: (c: GiteaClient) => c.readFile("acme", "group", "environments.yaml"),
    },
  ])("answers undefined for $what rather than throwing", async ({ call }) => {
    const { client } = fake([{ status: 404, body: { message: "Not found" } }]);
    await expect(call(client)).resolves.toBeUndefined();
  });

  it("throws Gitea's own status and message on anything else", async () => {
    const { client } = fake([{ status: 403, body: { message: "user does not have push access" } }]);
    const failure = await client.listBranches("acme", "group").catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GiteaApiError);
    expect((failure as GiteaApiError).status).toBe(403);
    expect((failure as GiteaApiError).detail).toBe("user does not have push access");
  });

  it("decodes a file's content and keeps its blob sha", async () => {
    const { client, calls } = fake([
      { body: { content: base64Encode("version: 1\n"), sha: "blob-1", encoding: "base64" } },
    ]);
    const file = await client.readFile("acme", "group", "0 — AI Agent/import.yaml", "main");
    expect(calls[0]?.url).toBe(
      `${ORIGIN}/api/v1/repos/acme/group/contents/0%20%E2%80%94%20AI%20Agent/import.yaml?ref=main`,
    );
    expect(file).toEqual({
      path: "0 — AI Agent/import.yaml",
      content: "version: 1\n",
      sha: "blob-1",
    });
  });

  it("writes files[] base64-encoded, on a branch it creates", async () => {
    const { client, calls } = fake([{ status: 201, body: {} }]);
    await client.changeFiles("acme", "group", {
      message: "Add the stage environment",
      branch: "main",
      newBranch: "mate-app/env-stage",
      files: [
        { operation: "update", path: "environments.yaml", content: "version: 1\n", sha: "blob-1" },
      ],
    });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/contents`);
    expect(calls[0]?.body).toEqual({
      message: "Add the stage environment",
      branch: "main",
      new_branch: "mate-app/env-stage",
      files: [
        {
          operation: "update",
          path: "environments.yaml",
          content: base64Encode("version: 1\n"),
          sha: "blob-1",
        },
      ],
    });
  });

  it("opens a pull request and merges one by its number", async () => {
    const { client, calls } = fake([
      { body: { number: 12, title: "t", state: "open" } },
      { body: {} },
    ]);
    const pull = await client.createPullRequest("acme", "group", {
      head: "mate-app/env-stage",
      base: "main",
      title: "Add the stage environment",
    });
    await client.mergePullRequest("acme", "group", pull.number);
    expect(calls[0]?.body).toEqual({
      head: "mate-app/env-stage",
      base: "main",
      title: "Add the stage environment",
    });
    expect(calls[1]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/pulls/12/merge`);
    expect(calls[1]?.body).toEqual({ Do: "merge" });
  });

  it("lists open pull requests by default", async () => {
    const { client, calls } = fake([{ body: [] }]);
    await client.listPullRequests("acme", "group");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/pulls?state=open`);
  });

  it("creates a tag on a commit", async () => {
    const { client, calls } = fake([{ status: 201, body: {} }]);
    await client.createTag("acme", "group", { tag: "v1.2.0", target: "abc", message: "api abc" });
    expect(calls[0]?.body).toEqual({ tag_name: "v1.2.0", target: "abc", message: "api abc" });
  });

  it("lists a repository's tags, message and all", async () => {
    const { client, calls } = fake([
      { body: [{ name: "v1.2.0", message: "api abc", commit: { sha: "abc" } }] },
    ]);
    expect(await client.listTags("acme", "group")).toHaveLength(1);
    expect(calls[0]?.url.slice(ORIGIN.length)).toBe("/api/v1/repos/acme/group/tags");
  });

  it("reads commit statuses, runs, jobs, a rerun and logs", async () => {
    const { client, calls } = fake([
      // Gitea sends a status's state under `status` (the owner's Git tab,
      // 2026-09-17: read as `state`, an approved release said "Checking").
      { body: [{ context: "mate/deploy/stage/api", status: "success" }] },
      { body: { workflow_runs: [{ id: 7 }] } },
      { body: { jobs: [{ id: 9, run_id: 7 }] } },
      { status: 200, body: {} },
      { text: "step 1\nstep 2\n" },
    ]);
    expect(await client.listCommitStatuses("acme", "api", "abc")).toEqual([
      { context: "mate/deploy/stage/api", state: "success" },
    ]);
    expect(await client.listActionRuns("acme", "api", { branch: "main", limit: 5 })).toEqual([
      { id: 7 },
    ]);
    expect(await client.listActionJobs("acme", "api", 7)).toEqual([{ id: 9, run_id: 7 }]);
    await client.rerunActionJob("acme", "api", 9);
    expect(await client.actionJobLogs("acme", "api", 9)).toBe("step 1\nstep 2\n");

    expect(calls.map((call) => `${call.method} ${call.url.slice(ORIGIN.length)}`)).toEqual([
      "GET /api/v1/repos/acme/api/commits/abc/statuses",
      "GET /api/v1/repos/acme/api/actions/runs?branch=main&limit=5",
      "GET /api/v1/repos/acme/api/actions/runs/7/jobs",
      "POST /api/v1/repos/acme/api/actions/jobs/9/rerun",
      "GET /api/v1/repos/acme/api/actions/jobs/9/logs",
    ]);
  });
});
