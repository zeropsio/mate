import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  base64Decode,
  base64Encode,
  createGiteaClient,
  GiteaApiError,
  GITEA_REQUEST_DEADLINE_MS,
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

  it("reads one commit on Gitea's own route, with its files and stats", async () => {
    // `/repos/{o}/{r}/commits/{sha}` is GitHub's; Gitea answers 404 there and
    // carries the single commit under `git/commits` (measured on 1.27.2,
    // 2026-09-20).
    const { client, calls } = fake([
      {
        body: {
          sha: "dc8aabc",
          commit: { message: "Add the page\n\nbody" },
          files: [{ filename: "index.html", status: "added" }],
          stats: { additions: 12, deletions: 0 },
        },
      },
    ]);
    const detail = await client.commitDetail("harbor", "appdev", "dc8aabc");
    expect(calls[0]?.url).toBe(
      `${ORIGIN}/api/v1/repos/harbor/appdev/git/commits/dc8aabc?stat=true&files=true`,
    );
    expect(detail?.subject).toBe("Add the page");
    expect(detail?.files).toEqual([{ filename: "index.html", status: "added" }]);
    expect(detail?.additions).toBe(12);
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

  it("a 404 on a contents read is not re-requested and aborted", async () => {
    // A browser logs a cancelled body as its own aborted request of the same URL.
    let cancelled = false;
    let drained = false;
    const signals: Array<AbortSignal | undefined> = [];
    const client = createGiteaClient({
      origin: ORIGIN,
      token: "t-1",
      fetch: (_input, init) => {
        signals.push(init?.signal ?? undefined);
        const chunks = [new TextEncoder().encode('{"message":"Not found"}')];
        const body = new ReadableStream<Uint8Array>({
          pull: (controller) => {
            const chunk = chunks.shift();
            if (chunk === undefined) {
              drained = true;
              controller.close();
            } else controller.enqueue(chunk);
          },
          cancel: () => {
            cancelled = true;
          },
        });
        return Promise.resolve(new Response(body, { status: 404 }));
      },
    });

    await expect(
      client.readFile("acme", "group", "3 — Stage/import.yaml", "main"),
    ).resolves.toBeUndefined();

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    expect(cancelled).toBe(false);
    expect(drained).toBe(true);
  });

  it("throws Gitea's own status and message on anything else", async () => {
    const { client } = fake([{ status: 403, body: { message: "user does not have push access" } }]);
    const failure = await client.listBranches("acme", "group").catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GiteaApiError);
    expect((failure as GiteaApiError).status).toBe(403);
    expect((failure as GiteaApiError).detail).toBe("user does not have push access");
    // And in the message itself: a surface that shows only `message` — the
    // conversation, a toast — would otherwise say "Gitea refused to …" and
    // nothing a person could act on (the owner, 2026-09-18).
    expect((failure as GiteaApiError).message).toBe(
      "Gitea refused to list the branches. user does not have push access",
    );
  });

  it("says only what it refused where Gitea sent no words", async () => {
    const { client } = fake([{ status: 500, body: {} }]);
    const failure = await client.listBranches("acme", "group").catch((cause: unknown) => cause);
    expect((failure as GiteaApiError).message).toBe("Gitea refused to list the branches.");
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

  it("merge sends the shown head and squash, so `main` is one commit per task", async () => {
    const { client, calls } = fake([{ body: {} }]);
    await client.mergePullRequest("acme", "appdev", 3, "c0ffee");
    expect(calls[0]?.body).toEqual({ Do: "squash", head_commit_id: "c0ffee" });
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
    await client.mergePullRequest("acme", "group", pull.number, "c0ffee");
    expect(calls[0]?.body).toEqual({
      head: "mate-app/env-stage",
      base: "main",
      title: "Add the stage environment",
    });
    expect(calls[1]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/pulls/12/merge`);
    expect(calls[1]?.body).toEqual({ Do: "squash", head_commit_id: "c0ffee" });
  });

  it("reads when an annotated tag was made from its tagger", async () => {
    const { client, calls } = fake([
      { body: { tag: "v0.1.1", tagger: { date: "2026-09-24T10:00:00Z" } } },
    ]);
    expect(await client.tagDate("acme", "group", "t-sha")).toBe("2026-09-24T10:00:00Z");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/git/tags/t-sha`);
  });

  it("lists open pull requests by default", async () => {
    const { client, calls } = fake([{ body: [] }]);
    await client.listPullRequests("acme", "group");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/pulls?state=open`);
  });

  it("lists an org's repositories page by page, until a page comes back short", async () => {
    const full = Array.from({ length: 50 }, (_, index) => ({ id: index, name: `r${index}` }));
    const { client, calls } = fake([{ body: full }, { body: [{ id: 50, name: "r50" }] }]);
    const repositories = await client.listOrganizationRepositories("acme");
    expect(repositories).toHaveLength(51);
    expect(calls.map((call) => call.url)).toEqual([
      `${ORIGIN}/api/v1/orgs/acme/repos?limit=50&page=1`,
      `${ORIGIN}/api/v1/orgs/acme/repos?limit=50&page=2`,
    ]);
  });

  it("lists the repositories this person has access to", async () => {
    const { client, calls } = fake([{ body: [] }]);
    expect(await client.listUserRepositories()).toEqual([]);
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/user/repos?limit=50&page=1`);
  });

  it("searches the open pull requests across everything the person can see", async () => {
    const { client, calls } = fake([{ body: [] }, { body: [] }]);
    await client.searchPullRequests();
    await client.searchPullRequests({ owner: "acme", state: "all" });
    expect(calls[0]?.url).toBe(
      `${ORIGIN}/api/v1/repos/issues/search?type=pulls&state=open&limit=50&page=1`,
    );
    expect(calls[1]?.url).toBe(
      `${ORIGIN}/api/v1/repos/issues/search?type=pulls&state=all&owner=acme&limit=50&page=1`,
    );
  });

  it("creates a tag on a commit", async () => {
    const { client, calls } = fake([{ status: 201, body: {} }]);
    await client.createTag("acme", "group", { tag: "v1.2.0", target: "abc", message: "api abc" });
    expect(calls[0]?.body).toEqual({ tag_name: "v1.2.0", target: "abc", message: "api abc" });
  });

  it("lists one page of a repository's tags, message and all", async () => {
    const { client, calls } = fake([
      { body: [{ name: "v1.2.0", message: "api abc", commit: { sha: "abc" } }] },
    ]);
    expect(await client.listTags("acme", "group")).toHaveLength(1);
    expect(calls.map((call) => call.url.slice(ORIGIN.length))).toEqual([
      "/api/v1/repos/acme/group/tags",
    ]);
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

describe("GiteaClient deadlines (DESIGN §2.D D3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A Gitea that never answers; a request ends only when its signal does. */
  function silent(signal?: AbortSignal): GiteaClient {
    return createGiteaClient({
      origin: ORIGIN,
      token: "t-1",
      ...(signal === undefined ? {} : { signal }),
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });
  }

  it.each([
    { what: "a read", read: (client: GiteaClient) => client.listTags("acme", "group") },
    { what: "a job's log", read: (client: GiteaClient) => client.actionJobLogs("acme", "app", 7) },
  ])("$what Gitea has not answered in 15 s ends as a timeout", async ({ read: send }) => {
    vi.useFakeTimers();
    const read = send(silent());
    const outcome = read.then(
      () => "answered",
      (cause: unknown) => (cause instanceof DOMException ? cause.name : "other"),
    );
    await vi.advanceTimersByTimeAsync(GITEA_REQUEST_DEADLINE_MS - 1);
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("TimeoutError");
  });

  it("a write has no deadline: a merge Gitea is slow to answer may still land", async () => {
    vi.useFakeTimers();
    const merge = silent().mergePullRequest("acme", "app", 4, "c0ffee");
    let settled = false;
    void merge.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(GITEA_REQUEST_DEADLINE_MS * 4);
    expect(settled).toBe(false);
  });

  /** A job's log whose chunks arrive `gapMs` apart, and that stops after `chunks` of them. */
  function trickling(gapMs: number, chunks: number, close: boolean): GiteaClient {
    return createGiteaClient({
      origin: ORIGIN,
      token: "t-1",
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              init?.signal?.addEventListener("abort", () => stream.error(init.signal?.reason));
              for (let chunk = 1; chunk <= chunks; chunk += 1) {
                // @effect-diagnostics-next-line globalTimers:off -- the log's body, late on vitest's fake clock.
                setTimeout(() => {
                  if (init?.signal?.aborted === true) return;
                  stream.enqueue(new TextEncoder().encode(`step ${String(chunk)} done\n`));
                  if (chunk === chunks && close) stream.close();
                }, gapMs * chunk);
              }
            },
          }),
        ),
    });
  }

  const outcomeOf = (logs: Promise<string>) =>
    logs.then(
      (text) => text,
      (cause: unknown) => (cause instanceof DOMException ? cause.name : "other"),
    );

  it("a job's log Gitea keeps sending may take longer than 15 s to arrive", async () => {
    vi.useFakeTimers();
    const gap = GITEA_REQUEST_DEADLINE_MS - 1_000;
    const outcome = outcomeOf(trickling(gap, 4, true).actionJobLogs("acme", "app", 7));
    await vi.advanceTimersByTimeAsync(gap * 4);
    expect(await outcome).toBe("step 1 done\nstep 2 done\nstep 3 done\nstep 4 done\n");
  });

  it("a job's log that stops arriving for 15 s ends as a timeout", async () => {
    vi.useFakeTimers();
    const outcome = outcomeOf(trickling(1_000, 2, false).actionJobLogs("acme", "app", 7));
    await vi.advanceTimersByTimeAsync(2_000 + GITEA_REQUEST_DEADLINE_MS);
    expect(await outcome).toBe("TimeoutError");
  });

  it("the caller's signal still ends a request before its deadline", async () => {
    const controller = new AbortController();
    const read = silent(controller.signal).listTags("acme", "group");
    controller.abort(new DOMException("The account closed.", "AbortError"));
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("GiteaClient pull request shas (DESIGN A7)", () => {
  it("a pull request carries its head and base shas and the commit it merged as", async () => {
    const { client } = fake([
      {
        body: {
          number: 4,
          title: "Add a due date",
          state: "closed",
          merged: true,
          mergeable: null,
          head: { ref: "mate/x", sha: "head-sha" },
          base: { ref: "main", sha: "base-sha" },
          merge_commit_sha: "merge-sha",
        },
      },
    ]);
    const pull = await client.getPullRequest("acme", "app", 4);
    expect(pull?.head?.sha).toBe("head-sha");
    expect(pull?.base?.sha).toBe("base-sha");
    expect(pull?.merge_commit_sha).toBe("merge-sha");
    expect(pull?.mergeable).toBeNull();
  });

  it("reads one page of pull requests as long as it is asked for", async () => {
    const { client, calls } = fake([{ body: [] }]);
    await client.listPullRequests("acme", "app", { state: "closed", limit: 20 });
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/app/pulls?state=closed&limit=20`);
  });

  it("lists every tag, page by page, until a page comes back short", async () => {
    const full = Array.from({ length: 50 }, (_, index) => ({ name: `v0.0.${index}` }));
    const { client, calls } = fake([{ body: full }, { body: [{ name: "v0.1.0" }] }]);
    expect(await client.listAllTags("acme", "group")).toHaveLength(51);
    expect(calls.map((call) => call.url.slice(ORIGIN.length))).toEqual([
      "/api/v1/repos/acme/group/tags?limit=50&page=1",
      "/api/v1/repos/acme/group/tags?limit=50&page=2",
    ]);
  });
});
