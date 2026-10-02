import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
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
        // An empty text is no body at all, which is what a `204` must carry.
        return Promise.resolve(
          new Response(answer.text === "" ? null : answer.text, { status: answer.status ?? 200 }),
        );
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

describe("GiteaClient request shapes", () => {
  it("bearers the token on every call, under /api/v1", async () => {
    const { client, calls } = fake([{ body: [] }]);
    await client.listTags("acme", "group");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/tags`);
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
        return Promise.resolve(new Response("[]", { status: 200 }));
      },
    });
    await client.listTags("acme", "group");
    token = "second";
    await client.listTags("acme", "group");
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
      what: "a branch that is not there",
      call: (c: GiteaClient) => c.getBranch("acme", "group", "main"),
    },
  ])("answers undefined for $what rather than throwing", async ({ call }) => {
    const { client } = fake([{ status: 404, body: { message: "Not found" } }]);
    await expect(call(client)).resolves.toBeUndefined();
  });

  it("a 404 is read to its end, not re-requested and aborted", async () => {
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

    await expect(client.getBranch("acme", "group", "main")).resolves.toBeUndefined();

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    expect(cancelled).toBe(false);
    expect(drained).toBe(true);
  });

  it("throws Gitea's own status and message on anything else", async () => {
    const { client } = fake([{ status: 403, body: { message: "user does not have push access" } }]);
    const failure = await client.listTags("acme", "group").catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GiteaApiError);
    expect((failure as GiteaApiError).status).toBe(403);
    expect((failure as GiteaApiError).detail).toBe("user does not have push access");
    // And in the message itself: a surface that shows only `message` — the
    // conversation, a toast — would otherwise say "Gitea refused to …" and
    // nothing a person could act on (the owner, 2026-09-18).
    expect((failure as GiteaApiError).message).toBe(
      "Gitea refused to list the tags. user does not have push access",
    );
  });

  it("says only what it refused where Gitea sent no words", async () => {
    const { client } = fake([{ status: 500, body: {} }]);
    const failure = await client.listTags("acme", "group").catch((cause: unknown) => cause);
    expect((failure as GiteaApiError).message).toBe("Gitea refused to list the tags.");
  });

  it("reads when an annotated tag was made from its tagger", async () => {
    const { client, calls } = fake([
      { body: { tag: "v0.1.1", tagger: { date: "2026-09-24T10:00:00Z" } } },
    ]);
    expect(await client.tagDate("acme", "group", "t-sha")).toBe("2026-09-24T10:00:00Z");
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/repos/acme/group/git/tags/t-sha`);
  });

  it("lists the repositories this person has access to page by page, until a page comes back short", async () => {
    const full = Array.from({ length: 50 }, (_, index) => ({ id: index, name: `r${index}` }));
    const { client, calls } = fake([{ body: full }, { body: [{ id: 50, name: "r50" }] }]);
    const repositories = await client.listUserRepositories();
    expect(repositories).toHaveLength(51);
    expect(calls.map((call) => call.url)).toEqual([
      `${ORIGIN}/api/v1/user/repos?limit=50&page=1`,
      `${ORIGIN}/api/v1/user/repos?limit=50&page=2`,
    ]);
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

  it("reads a commit's statuses", async () => {
    const { client, calls } = fake([
      // Gitea sends a status's state under `status` (the owner's Git tab,
      // 2026-09-17: read as `state`, an approved release said "Checking").
      { body: [{ context: "mate/release/v1.0.0", status: "success" }] },
    ]);
    expect(await client.listCommitStatuses("acme", "group", "abc")).toEqual([
      { context: "mate/release/v1.0.0", state: "success" },
    ]);
    expect(calls.map((call) => `${call.method} ${call.url.slice(ORIGIN.length)}`)).toEqual([
      "GET /api/v1/repos/acme/group/commits/abc/statuses",
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

  it("a read Gitea has not answered in 15 s ends as a timeout", async () => {
    vi.useFakeTimers();
    const read = silent().listTags("acme", "group");
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

  it("a write has no deadline: a tag Gitea is slow to answer may still land", async () => {
    vi.useFakeTimers();
    const tagging = silent().createTag("acme", "group", { tag: "v1.0.0", target: "c0ffee" });
    let settled = false;
    void tagging.then(
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

  it("the caller's signal still ends a request before its deadline", async () => {
    const controller = new AbortController();
    const read = silent(controller.signal).listTags("acme", "group");
    controller.abort(new DOMException("The account closed.", "AbortError"));
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("GiteaClient pages", () => {
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
