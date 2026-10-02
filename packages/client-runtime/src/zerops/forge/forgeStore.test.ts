import { describe, expect, it } from "vite-plus/test";

import type { Instant } from "../data/access/grant.ts";
import {
  GiteaApiError,
  type GiteaClient,
  type GiteaRepository,
  type GiteaTag,
} from "../giteaClient.ts";
import {
  FORGE_COMMITS_READ,
  FORGE_HOST_CONCURRENCY,
  FORGE_LIST_BACKSTOP_MS,
  FORGE_WAKE_REVALIDATE_MS,
  makeForgeStore,
  type ForgeFact,
} from "./forgeStore.ts";
import type { GiteaSessions } from "./giteaSession.ts";
import { GITEA_SIGNED_OUT, type GiteaSessionView } from "./giteaSessionMachine.ts";

const ORIGIN = "https://gitea.example";

/** Answers settle across a few promise hops; this lets every one of them land. */
const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

/** Wall and monotonic time moving together; timers fire in order, each followed by a flush. */
function manualClock() {
  let mono = 0;
  const wallOffset = 1_800_000_000_000;
  let nextId = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  return {
    now: (): Instant => ({ wall: mono + wallOffset, mono }),
    random: () => 0.5,
    setTimer: (delayMs: number, fire: () => void) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: mono + Math.max(0, delayMs), fire });
      return () => {
        timers.delete(id);
      };
    },
    advance: async (ms: number) => {
      await flush();
      const end = mono + ms;
      for (;;) {
        let due: [number, { readonly at: number; readonly fire: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
        }
        if (due === undefined) break;
        timers.delete(due[0]);
        mono = Math.max(mono, due[1].at);
        due[1].fire();
        await flush();
      }
      mono = end;
      await flush();
    },
  };
}

/** One request the store sent, held until the test answers it. */
interface HeldRead {
  readonly route: string;
  readonly signal: AbortSignal | undefined;
  readonly answer: (value: unknown) => Promise<void>;
  readonly fail: (cause: unknown) => Promise<void>;
  /** Gitea's 401 that no token recovered, as the session reports it to the reader. */
  readonly unauthorized: () => Promise<void>;
  settled: boolean;
}

/** A Gitea whose every read waits for the test, reached through a readable session. */
function rig() {
  const clock = manualClock();
  const reads: Array<HeldRead> = [];
  const hold =
    (route: string, signal: AbortSignal | undefined, onUnauthorized: () => void) =>
    (): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const held: HeldRead = {
          route,
          signal,
          answer: async (value) => {
            held.settled = true;
            resolve(value);
            await flush();
          },
          fail: async (cause) => {
            held.settled = true;
            reject(cause);
            await flush();
          },
          unauthorized: async () => {
            held.settled = true;
            onUnauthorized();
            reject(new GiteaApiError("You are not signed in to Gitea.", 401));
            await flush();
          },
          settled: false,
        };
        reads.push(held);
      });
  const clientWith = (signal: AbortSignal | undefined, onUnauthorized: () => void): GiteaClient => {
    const at = (route: string) => hold(route, signal, onUnauthorized)();
    return {
      origin: ORIGIN,
      listAllTags: (owner: string, repo: string) => at(`tags ${owner}/${repo}`),
      listCommits: (owner: string, repo: string, options?: { readonly limit?: number }) =>
        at(`commits ${owner}/${repo} ${String(options?.limit)}`),
      getRepository: (owner: string, repo: string) => at(`repository ${owner}/${repo}`),
      listUserRepositories: () => at("user repos"),
      getOrganization: (slug: string) => at(`org ${slug}`),
    } as unknown as GiteaClient;
  };
  let view: GiteaSessionView = { ...GITEA_SIGNED_OUT, signedIn: true, readable: true };
  const listeners = new Set<() => void>();
  const sessions: Pick<GiteaSessions, "view" | "subscribe" | "clientFor"> = {
    view: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clientFor: (_origin, onUnauthorized = () => undefined, signal) =>
      view.readable ? clientWith(signal, onUnauthorized) : null,
  };
  const store = makeForgeStore({
    now: clock.now,
    random: clock.random,
    setTimer: clock.setTimer,
    sessions,
  });
  return {
    clock,
    store,
    reads,
    /** The reads of `route` sent so far. */
    sent: (route: string) => reads.filter((read) => read.route === route),
    /** The one read of `route` still waiting for an answer. */
    pending: (route: string) => {
      const waiting = reads.filter((read) => read.route === route && !read.settled);
      expect(waiting).toHaveLength(1);
      return waiting[0]!;
    },
    setView: (next: GiteaSessionView) => {
      view = next;
      for (const listener of listeners) listener();
    },
  };
}

const repo = (name: string): GiteaRepository => ({
  id: name.length,
  name,
  full_name: `shop/${name}`,
  default_branch: "main",
});

const tag = (name: string): GiteaTag => ({ name, message: "" });

/** A repository's tags: the list every scheduling case below reads. */
const tags = (owner: string, repoName: string): ForgeFact => ({
  kind: "tags",
  origin: ORIGIN,
  owner,
  repo: repoName,
});

describe("forge store (DESIGN §4.7 scheduling, M3)", () => {
  it("a tick never aborts a read in flight", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = tags("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    const first = pending("tags shop/app");

    // Several backstop ticks pass while the read has not answered.
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 3);
    expect(first.signal?.aborted).toBe(false);
    expect(sent("tags shop/app")).toHaveLength(1);

    await first.answer([tag("v4")]);
    const shown = store.read(fact);
    expect(shown.state).toBe("known");
    if (shown.state === "known") expect(shown.value).toEqual([tag("v4")]);
  });

  it("one request per resource at a time", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = tags("shop", "app");
    store.demand(fact);
    store.demand(fact, "route");
    await clock.advance(0);
    const first = pending("tags shop/app");

    // Everything that asks for the list again while it is being read.
    for (let asked = 0; asked < 3; asked += 1) {
      store.invalidate({ topic: "forge-repo", origin: ORIGIN, owner: "shop", repo: "app" });
    }
    store.wake();
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("tags shop/app")).toHaveLength(1);
    expect(first.signal?.aborted).toBe(false);

    // The read that was invalidated owes exactly one more (M3).
    await first.answer([tag("v4")]);
    const again = pending("tags shop/app");
    const stale = store.read(fact);
    expect(stale.state === "known" && stale.freshness.kind).toBe("revalidating");
    await again.answer([tag("v4"), tag("v5")]);
    await clock.advance(FORGE_LIST_BACKSTOP_MS - 1);
    expect(sent("tags shop/app")).toHaveLength(2);
    const shown = store.read(fact);
    expect(shown.state === "known" && shown.value).toEqual([tag("v4"), tag("v5")]);
  });

  it("at most four reads go to one Gitea at once, the route's first", async () => {
    const { clock, store, reads } = rig();
    for (const name of ["a", "b", "c", "d", "e"]) store.demand(tags("shop", name));
    store.demand(tags("shop", "route"), "route");
    await clock.advance(0);
    expect(reads.map((read) => read.route)).toEqual([
      "tags shop/route",
      "tags shop/a",
      "tags shop/b",
      "tags shop/c",
    ]);
    expect(FORGE_HOST_CONCURRENCY).toBe(4);
    await reads[0]!.answer([]);
    expect(reads.map((read) => read.route).slice(4)).toEqual(["tags shop/d"]);
  });
});

/** What one group's flow demands: each of its repositories' tags, and its group repo's commits. */
function demandGroup(
  store: ReturnType<typeof rig>["store"],
  org: string,
  repositories: ReadonlyArray<string>,
): () => void {
  const releases = [
    ...repositories.map((name) => store.demand(tags(org, name))),
    store.demand({ kind: "commits", origin: ORIGIN, owner: org, repo: "group" }),
  ];
  return () => {
    for (const release of releases) release();
  };
}

const groupCommits = (org: string) => `commits ${org}/group ${String(FORGE_COMMITS_READ)}`;

describe("forge store retention (DESIGN §4.7, M4, M9)", () => {
  it("flow retention across re-key", async () => {
    const { clock, store, sent, pending } = rig();
    const release = demandGroup(store, "shop", ["app"]);
    await clock.advance(0);
    await pending("tags shop/app").answer([tag("v4")]);
    await pending(groupCommits("shop")).answer([{ sha: "c1", subject: "Start" }]);
    const before = store.read(tags("shop", "app"));
    expect(before.state).toBe("known");

    // The group's repositories change: the view lets go of the old key set and demands the new.
    release();
    demandGroup(store, "shop", ["app", "api"]);
    await clock.advance(0);
    expect(store.read(tags("shop", "app"))).toBe(before);
    expect(sent("tags shop/app")).toHaveLength(1);
    const commits = store.read({ kind: "commits", origin: ORIGIN, owner: "shop", repo: "group" });
    expect(commits.state === "known" && commits.value).toEqual([{ sha: "c1", subject: "Start" }]);

    // Only the new repository is read.
    await pending("tags shop/api").answer([]);
    expect(store.read(tags("shop", "app"))).toBe(before);
    const api = store.read(tags("shop", "api"));
    expect(api.state === "known" && api.coverage).toBe("complete");
  });

  it("switching org does not blank the other org's flow", async () => {
    const { clock, store, sent, pending } = rig();
    const shop = demandGroup(store, "shop", ["app"]);
    await clock.advance(0);
    await pending("tags shop/app").answer([tag("v4")]);
    await pending(groupCommits("shop")).answer([]);
    const shopTags = store.read(tags("shop", "app"));

    await clock.advance(FORGE_LIST_BACKSTOP_MS / 2);
    shop();
    const cafe = demandGroup(store, "cafe", ["menu"]);
    await clock.advance(0);
    // The other org is being read; the first one's flow stands as it was read.
    expect(store.read(tags("shop", "app"))).toBe(shopTags);
    await pending("tags cafe/menu").answer([tag("v9")]);
    await pending(groupCommits("cafe")).answer([]);
    expect(store.read(tags("shop", "app"))).toBe(shopTags);

    // Back to the first org, after its backstop: its flow shows at once and revalidates in place.
    await clock.advance(FORGE_LIST_BACKSTOP_MS / 2);
    cafe();
    demandGroup(store, "shop", ["app"]);
    await clock.advance(0);
    const back = store.read(tags("shop", "app"));
    expect(back.state === "known" && back.value).toEqual([tag("v4")]);
    expect(back.state === "known" && back.freshness.kind).toBe("revalidating");
    expect(sent("tags shop/app")).toHaveLength(2);
    const cafeTags = store.read(tags("cafe", "menu"));
    expect(cafeTags.state === "known" && cafeTags.value).toEqual([tag("v9")]);
  });
});

describe("forge store failures and the session (DESIGN §4.6, §6.4)", () => {
  it("a failed revalidation keeps the value and retries on the backoff ladder", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = tags("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    await pending("tags shop/app").answer([tag("v4")]);
    store.invalidate({ topic: "forge-repo", origin: ORIGIN, owner: "shop", repo: "app" });
    await clock.advance(0);
    await pending("tags shop/app").fail(new GiteaApiError("Gitea refused.", 503));
    const failed = store.read(fact);
    expect(failed.state === "known" && failed.value).toEqual([tag("v4")]);
    expect(failed.state === "known" && failed.freshness).toMatchObject({
      kind: "stale",
      reason: { kind: "revalidation-failed", failure: { kind: "server", status: 503 } },
    });
    await clock.advance(1_999);
    expect(sent("tags shop/app")).toHaveLength(2);
    await clock.advance(1);
    expect(sent("tags shop/app")).toHaveLength(3);
  });

  it("a read that meets a 401 no token recovered reads again once the session is readable", async () => {
    const { clock, store, sent, pending, setView } = rig();
    const fact = tags("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    setView({ ...GITEA_SIGNED_OUT, signedIn: true, readable: false });
    await pending("tags shop/app").unauthorized();
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("tags shop/app")).toHaveLength(1);

    setView({ ...GITEA_SIGNED_OUT, signedIn: true, readable: true });
    await clock.advance(0);
    await pending("tags shop/app").answer([]);
    const shown = store.read(fact);
    expect(shown.state === "known" && shown.value).toEqual([]);
  });

  it("a fact waits for the Gitea session without failing", async () => {
    const { clock, store, reads, setView } = rig();
    setView(GITEA_SIGNED_OUT);
    const fact = tags("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    expect(store.read(fact)).toEqual({ state: "unread", waitingFor: "gitea-session" });
    expect(reads).toHaveLength(0);
  });

  it("nothing starts while hidden; a visible wake reads what is older than 30 s", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand(tags("shop", "app"));
    await clock.advance(0);
    await pending("tags shop/app").answer([]);
    store.setVisible(false);
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 5);
    expect(sent("tags shop/app")).toHaveLength(1);

    store.wake();
    await clock.advance(0);
    expect(sent("tags shop/app")).toHaveLength(2);
    await pending("tags shop/app").answer([]);
    store.wake();
    await clock.advance(FORGE_WAKE_REVALIDATE_MS - 1);
    expect(sent("tags shop/app")).toHaveLength(2);
  });

  it("the store's end aborts the reads in flight and publishes nothing after", async () => {
    const { clock, store, pending } = rig();
    const fact = tags("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    const read = pending("tags shop/app");
    const told: Array<ForgeFact> = [];
    store.subscribe((changed) => told.push(changed));
    store.dispose();
    expect(read.signal?.aborted).toBe(true);
    await read.answer([tag("v4")]);
    expect(told).toEqual([]);
  });
});

describe("forge store invalidations (DESIGN §6.2)", () => {
  it("shows an invalidation only while a view demands a fact under its key", async () => {
    const { clock, store, pending } = rig();
    const release = store.demand(tags("shop", "app"));
    await clock.advance(0);
    await pending("tags shop/app").answer([tag("v4")]);
    const app = { topic: "forge-repo", origin: ORIGIN, owner: "shop", repo: "app" } as const;

    expect(store.shows(app)).toBe(true);
    expect(store.shows({ ...app, repo: "web" })).toBe(false);
    expect(store.shows({ topic: "forge-org", origin: ORIGIN, org: "shop" })).toBe(false);

    release();
    expect(store.shows(app)).toBe(false);
  });
});

describe("forge store facts the flow's surfaces read (DESIGN §2.D D3)", () => {
  it("a repository's recent commits are unread until read, known after, and read again at the list backstop", async () => {
    const { clock, store, sent, pending } = rig();
    const fact: ForgeFact = { kind: "commits", origin: ORIGIN, owner: "shop", repo: "app" };
    expect(store.read(fact)).toEqual({ state: "unread", waitingFor: null });
    store.demand(fact);
    await clock.advance(0);
    const commits = [{ sha: "c2", subject: "Add cart" }];
    await pending(`commits shop/app ${String(FORGE_COMMITS_READ)}`).answer(commits);
    expect(store.read(fact)).toMatchObject({
      state: "known",
      value: commits,
      coverage: "complete",
    });
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent(`commits shop/app ${String(FORGE_COMMITS_READ)}`)).toHaveLength(2);
  });

  it("a repository with the person's permissions is unread until read, known after, and one the broker has not made yet is pending on the ladder until it is made", async () => {
    const { clock, store, sent, pending } = rig();
    const app: ForgeFact = { kind: "repository", origin: ORIGIN, owner: "shop", repo: "app" };
    const web: ForgeFact = { kind: "repository", origin: ORIGIN, owner: "shop", repo: "web" };
    expect(store.read(app)).toEqual({ state: "unread", waitingFor: null });
    store.demand(app);
    store.demand(web);
    await clock.advance(0);
    const permitted = { ...repo("app"), permissions: { admin: false, push: true, pull: true } };
    await pending("repository shop/app").answer(permitted);
    await pending("repository shop/web").answer(undefined);
    expect(store.read(app)).toMatchObject({
      state: "known",
      value: { kind: "made", repository: permitted },
    });
    expect(store.read(web)).toMatchObject({ state: "known", value: { kind: "pending" } });

    // A group seconds old: the broker makes its repositories shortly, so it is asked again at
    // 2 s, then 4 s after that.
    await clock.advance(1_999);
    expect(sent("repository shop/web")).toHaveLength(1);
    await clock.advance(1);
    await pending("repository shop/web").answer(undefined);
    await clock.advance(3_999);
    expect(sent("repository shop/web")).toHaveLength(2);
    await clock.advance(1);
    await pending("repository shop/web").answer(repo("web"));
    expect(store.read(web)).toMatchObject({
      state: "known",
      value: { kind: "made", repository: repo("web") },
    });

    // A made repository's permissions can change: it is read again at the list backstop.
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("repository shop/app")).toHaveLength(2);
    expect(sent("repository shop/web")).toHaveLength(4);
  });

  it("the person's repositories are unread until read, known after, and read again at the list backstop", async () => {
    const { clock, store, sent, pending } = rig();
    const repositories: ForgeFact = { kind: "user-repos", origin: ORIGIN };
    expect(store.read(repositories)).toEqual({ state: "unread", waitingFor: null });
    store.demand(repositories);
    await clock.advance(0);
    await pending("user repos").answer([repo("app")]);
    expect(store.read(repositories)).toMatchObject({ state: "known", value: [repo("app")] });
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("user repos")).toHaveLength(2);
  });

  it("an organization the broker has not made yet is pending, never missing, and asked about on the ladder until it is made", async () => {
    const { clock, store, sent, pending } = rig();
    const fact: ForgeFact = { kind: "organization", origin: ORIGIN, org: "shop" };
    expect(store.read(fact)).toEqual({ state: "unread", waitingFor: null });
    store.demand(fact);
    await clock.advance(0);
    await pending("org shop").answer(undefined);
    expect(store.read(fact)).toMatchObject({ state: "known", value: { kind: "pending" } });

    // The broker takes about eighty seconds: asked again at 2 s, then 4 s after that.
    await clock.advance(1_999);
    expect(sent("org shop")).toHaveLength(1);
    await clock.advance(1);
    await pending("org shop").answer(undefined);
    await clock.advance(3_999);
    expect(sent("org shop")).toHaveLength(2);
    await clock.advance(1);
    const made = { id: 7, username: "shop" };
    await pending("org shop").answer(made);
    expect(store.read(fact)).toMatchObject({
      state: "known",
      value: { kind: "made", organization: made },
    });

    // Made is final: nothing but an invalidation asks again.
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 5);
    store.wake();
    await clock.advance(0);
    expect(sent("org shop")).toHaveLength(3);
  });
});
