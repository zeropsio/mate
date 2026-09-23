import { describe, expect, it } from "vite-plus/test";

import type { Instant } from "../data/access/grant.ts";
import {
  GiteaApiError,
  type GiteaClient,
  type GiteaPullRequest,
  type GiteaRepository,
} from "../giteaClient.ts";
import {
  FORGE_COMMITS_READ,
  FORGE_DECLARATIONS_BACKSTOP_MS,
  FORGE_HOST_CONCURRENCY,
  FORGE_LIST_BACKSTOP_MS,
  FORGE_PENDING_STATUS_LIMIT_MS,
  FORGE_PENDING_STATUS_MS,
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
      listOrganizationRepositories: (org: string) => at(`repos ${org}`),
      listPullRequests: (owner: string, repo: string, options?: { readonly state?: string }) =>
        at(`pulls ${owner}/${repo} ${options?.state ?? "open"}`),
      getPullRequest: (owner: string, repo: string, number: number) =>
        at(`pull ${owner}/${repo}#${String(number)}`),
      listAllTags: (owner: string, repo: string) => at(`tags ${owner}/${repo}`),
      getBranch: (owner: string, repo: string, branch: string) =>
        at(`branch ${owner}/${repo} ${branch}`),
      readFile: (owner: string, repo: string, path: string, ref?: string) =>
        at(`file ${owner}/${repo} ${path}${ref === undefined ? "" : `@${ref}`}`),
      listCommitStatuses: (owner: string, repo: string, sha: string) =>
        at(`statuses ${owner}/${repo}@${sha}`),
      listCommits: (owner: string, repo: string, options?: { readonly limit?: number }) =>
        at(`commits ${owner}/${repo} ${String(options?.limit)}`),
      getRepository: (owner: string, repo: string) => at(`repository ${owner}/${repo}`),
      listUserRepositories: () => at("user repos"),
      searchPullRequests: () => at("pull search"),
      getOrganization: (slug: string) => at(`org ${slug}`),
      compareCommits: (owner: string, repo: string, base: string, head: string) =>
        at(`compare ${owner}/${repo} ${base}...${head}`),
      commitDetail: (owner: string, repo: string, sha: string) =>
        at(`commit ${owner}/${repo}@${sha}`),
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

const pull = (number: number, over: Partial<GiteaPullRequest> = {}): GiteaPullRequest => ({
  number,
  title: `change ${String(number)}`,
  state: "open",
  mergeable: true,
  head: { ref: `mate/x${String(number)}`, sha: `h${String(number)}` },
  base: { ref: "main", sha: "b1" },
  ...over,
});

const openPulls = (owner: string, repoName: string): ForgeFact => ({
  kind: "open-pulls",
  origin: ORIGIN,
  owner,
  repo: repoName,
});

describe("forge store (DESIGN §4.7 scheduling, M3)", () => {
  it("a tick never aborts a read in flight", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = openPulls("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    const first = pending("pulls shop/app open");

    // Several backstop ticks pass while the read has not answered.
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 3);
    expect(first.signal?.aborted).toBe(false);
    expect(sent("pulls shop/app open")).toHaveLength(1);

    await first.answer([pull(4)]);
    const shown = store.read(fact);
    expect(shown.state).toBe("known");
    if (shown.state === "known") expect(shown.value).toEqual([4]);
  });

  it("one request per resource at a time", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = openPulls("shop", "app");
    store.demand(fact);
    store.demand(fact, "route");
    await clock.advance(0);
    const first = pending("pulls shop/app open");

    // Everything that asks for the list again while it is being read.
    for (let asked = 0; asked < 3; asked += 1) {
      store.invalidate({ topic: "forge-repo", origin: ORIGIN, owner: "shop", repo: "app" });
    }
    store.wake();
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("pulls shop/app open")).toHaveLength(1);
    expect(first.signal?.aborted).toBe(false);

    // The read that was invalidated owes exactly one more (M3).
    await first.answer([pull(4)]);
    const again = pending("pulls shop/app open");
    const stale = store.read(fact);
    expect(stale.state === "known" && stale.freshness.kind).toBe("revalidating");
    await again.answer([pull(4), pull(5)]);
    await clock.advance(FORGE_LIST_BACKSTOP_MS - 1);
    expect(sent("pulls shop/app open")).toHaveLength(2);
    const shown = store.read(fact);
    expect(shown.state === "known" && shown.value).toEqual([4, 5]);
  });

  it("at most four reads go to one Gitea at once, the route's first", async () => {
    const { clock, store, reads } = rig();
    for (const name of ["a", "b", "c", "d", "e"]) store.demand(openPulls("shop", name));
    store.demand(openPulls("shop", "route"), "route");
    await clock.advance(0);
    expect(reads.map((read) => read.route)).toEqual([
      "pulls shop/route open",
      "pulls shop/a open",
      "pulls shop/b open",
      "pulls shop/c open",
    ]);
    expect(FORGE_HOST_CONCURRENCY).toBe(4);
    await reads[0]!.answer([]);
    expect(reads.map((read) => read.route).slice(4)).toEqual(["pulls shop/d open"]);
  });
});

/** What one group's flow demands: its org's repositories, each one's open pull requests, its tags. */
function demandGroup(
  store: ReturnType<typeof rig>["store"],
  org: string,
  repositories: ReadonlyArray<string>,
): () => void {
  const releases = [
    store.demand({ kind: "repos", origin: ORIGIN, org }),
    ...repositories.map((name) => store.demand(openPulls(org, name))),
    store.demand({ kind: "tags", origin: ORIGIN, owner: org, repo: "group" }),
  ];
  return () => {
    for (const release of releases) release();
  };
}

describe("forge store retention (DESIGN §4.7, M4, M9)", () => {
  it("flow retention across re-key", async () => {
    const { clock, store, sent, pending } = rig();
    const release = demandGroup(store, "shop", ["app"]);
    await clock.advance(0);
    await pending("repos shop").answer([repo("app"), repo("group")]);
    await pending("pulls shop/app open").answer([pull(4)]);
    await pending("tags shop/group").answer([{ name: "v1.0.0" }]);
    const before = store.read(openPulls("shop", "app"));
    expect(before.state).toBe("known");

    // The group's repositories change: the view lets go of the old key set and demands the new.
    store.invalidate({ topic: "forge-org", origin: ORIGIN, org: "shop" });
    release();
    demandGroup(store, "shop", ["app", "api"]);
    await clock.advance(0);
    expect(store.read(openPulls("shop", "app"))).toBe(before);
    expect(sent("pulls shop/app open")).toHaveLength(1);
    const tags = store.read({ kind: "tags", origin: ORIGIN, owner: "shop", repo: "group" });
    expect(tags.state === "known" && tags.value).toEqual([{ name: "v1.0.0" }]);

    // Only the new repository and the invalidated listing are read.
    await pending("repos shop").answer([repo("app"), repo("api"), repo("group")]);
    await pending("pulls shop/api open").answer([]);
    expect(store.read(openPulls("shop", "app"))).toBe(before);
    const api = store.read(openPulls("shop", "api"));
    expect(api.state === "known" && api.coverage).toBe("complete");
  });

  it("switching org does not blank the other org's flow", async () => {
    const { clock, store, sent, pending } = rig();
    const shop = demandGroup(store, "shop", ["app"]);
    await clock.advance(0);
    await pending("repos shop").answer([repo("app")]);
    await pending("pulls shop/app open").answer([pull(4)]);
    await pending("tags shop/group").answer([]);
    const shopPulls = store.read(openPulls("shop", "app"));

    await clock.advance(FORGE_LIST_BACKSTOP_MS / 2);
    shop();
    const cafe = demandGroup(store, "cafe", ["menu"]);
    await clock.advance(0);
    // The other org is being read; the first one's flow stands as it was read.
    expect(store.read(openPulls("shop", "app"))).toBe(shopPulls);
    await pending("repos cafe").answer([repo("menu")]);
    await pending("pulls cafe/menu open").answer([pull(9)]);
    await pending("tags cafe/group").answer([]);
    expect(store.read(openPulls("shop", "app"))).toBe(shopPulls);

    // Back to the first org, after its backstop: its flow shows at once and revalidates in place.
    await clock.advance(FORGE_LIST_BACKSTOP_MS / 2);
    cafe();
    demandGroup(store, "shop", ["app"]);
    await clock.advance(0);
    const back = store.read(openPulls("shop", "app"));
    expect(back.state === "known" && back.value).toEqual([4]);
    expect(back.state === "known" && back.freshness.kind).toBe("revalidating");
    expect(sent("pulls shop/app open")).toHaveLength(2);
    const cafePulls = store.read(openPulls("cafe", "menu"));
    expect(cafePulls.state === "known" && cafePulls.value).toEqual([9]);
  });
});

const pullKey = (number: number) => ({ origin: ORIGIN, owner: "shop", repo: "app", number });

const mergeability = (shown: ReturnType<ReturnType<typeof rig>["store"]["mergeState"]>) =>
  shown.state === "known" && shown.value.kind === "open" ? shown.value.mergeability.kind : shown;

describe("forge store MergeState (DESIGN §4.7, A7)", () => {
  it("a pull request that is checking is read again at 2, 5 and 10 s while demanded", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand(openPulls("shop", "app"));
    await clock.advance(0);
    await pending("pulls shop/app open").answer([pull(4, { mergeable: false })]);
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("checking");

    await clock.advance(1_999);
    expect(sent("pull shop/app#4")).toHaveLength(0);
    await clock.advance(1);
    await pending("pull shop/app#4").answer(pull(4, { mergeable: false }));
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("checking");

    await clock.advance(3_000);
    await pending("pull shop/app#4").answer(pull(4, { mergeable: false }));
    // Two false reads 5 s apart over the same shas: it needs a rebase.
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("conflicting");
    await clock.advance(20_000);
    expect(sent("pull shop/app#4")).toHaveLength(2);
  });

  it("a new head on the last recheck starts the 2, 5 and 10 s rechecks over", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand({ kind: "pull", ...pullKey(4) });
    await clock.advance(0);
    await pending("pull shop/app#4").answer(pull(4, { mergeable: null }));
    for (const rung of [2_000, 3_000]) {
      await clock.advance(rung);
      await pending("pull shop/app#4").answer(pull(4, { mergeable: null }));
    }
    // The last rung, 10 s in: pushed to meanwhile, Gitea is working the new head out.
    await clock.advance(5_000);
    await pending("pull shop/app#4").answer(
      pull(4, { mergeable: false, head: { ref: "mate/x4", sha: "h2" } }),
    );
    expect(sent("pull shop/app#4")).toHaveLength(4);

    await clock.advance(2_000);
    await pending("pull shop/app#4").answer(
      pull(4, { mergeable: false, head: { ref: "mate/x4", sha: "h2" } }),
    );
    await clock.advance(3_000);
    await pending("pull shop/app#4").answer(
      pull(4, { mergeable: false, head: { ref: "mate/x4", sha: "h2" } }),
    );
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("conflicting");
  });

  it("false then true within 5 s is never conflicting, and nothing is read once it merges", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand(openPulls("shop", "app"));
    await clock.advance(0);
    await pending("pulls shop/app open").answer([pull(4, { mergeable: false })]);
    await clock.advance(2_000);
    await pending("pull shop/app#4").answer(pull(4, { mergeable: true }));
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("mergeable");
    await clock.advance(20_000);
    expect(sent("pull shop/app#4")).toHaveLength(1);
  });

  it("a pull request landing puts the other open ones of its repository back to checking", async () => {
    const { clock, store, pending } = rig();
    store.demand(openPulls("shop", "app"));
    await clock.advance(0);
    await pending("pulls shop/app open").answer([pull(4), pull(5)]);
    expect(mergeability(store.mergeState(pullKey(5)))).toBe("mergeable");

    // The merge verb settles: Gitea is asked about the merged one again.
    store.invalidate({ topic: "forge-pr", origin: ORIGIN, owner: "shop", repo: "app", number: 4 });
    await clock.advance(0);
    await pending("pull shop/app#4").answer(
      pull(4, { state: "closed", merged: true, merge_commit_sha: "m4" }),
    );
    expect(store.mergeState(pullKey(4))).toMatchObject({
      state: "known",
      value: { kind: "merged", sha: "m4" },
    });
    expect(mergeability(store.mergeState(pullKey(5)))).toBe("checking");
    await pending("pull shop/app#5").answer(pull(5, { base: { ref: "main", sha: "b2" } }));
    expect(mergeability(store.mergeState(pullKey(5)))).toBe("mergeable");
  });
});

describe("forge store failures and the session (DESIGN §4.6, §6.4)", () => {
  it("a failed revalidation keeps the value and retries on the backoff ladder", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = openPulls("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    await pending("pulls shop/app open").answer([pull(4)]);
    store.invalidate({ topic: "forge-repo", origin: ORIGIN, owner: "shop", repo: "app" });
    await clock.advance(0);
    await pending("pulls shop/app open").fail(new GiteaApiError("Gitea refused.", 503));
    const failed = store.read(fact);
    expect(failed.state === "known" && failed.value).toEqual([4]);
    expect(failed.state === "known" && failed.freshness).toMatchObject({
      kind: "stale",
      reason: { kind: "revalidation-failed", failure: { kind: "server", status: 503 } },
    });
    await clock.advance(1_999);
    expect(sent("pulls shop/app open")).toHaveLength(2);
    await clock.advance(1);
    expect(sent("pulls shop/app open")).toHaveLength(3);
  });

  it("a read that meets a 401 no token recovered reads again once the session is readable", async () => {
    const { clock, store, sent, pending, setView } = rig();
    const fact = openPulls("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    setView({ ...GITEA_SIGNED_OUT, signedIn: true, readable: false });
    await pending("pulls shop/app open").unauthorized();
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("pulls shop/app open")).toHaveLength(1);

    setView({ ...GITEA_SIGNED_OUT, signedIn: true, readable: true });
    await clock.advance(0);
    await pending("pulls shop/app open").answer([]);
    const shown = store.read(fact);
    expect(shown.state === "known" && shown.value).toEqual([]);
  });

  it("a fact waits for the Gitea session without failing", async () => {
    const { clock, store, reads, setView } = rig();
    setView(GITEA_SIGNED_OUT);
    const fact = openPulls("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    expect(store.read(fact)).toEqual({ state: "unread", waitingFor: "gitea-session" });
    expect(reads).toHaveLength(0);
  });

  it("nothing starts while hidden; a visible wake reads what is older than 30 s", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand(openPulls("shop", "app"));
    await clock.advance(0);
    await pending("pulls shop/app open").answer([]);
    store.setVisible(false);
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 5);
    expect(sent("pulls shop/app open")).toHaveLength(1);

    store.wake();
    await clock.advance(0);
    expect(sent("pulls shop/app open")).toHaveLength(2);
    await pending("pulls shop/app open").answer([]);
    store.wake();
    await clock.advance(FORGE_WAKE_REVALIDATE_MS - 1);
    expect(sent("pulls shop/app open")).toHaveLength(2);
  });

  it("a wake reads nothing that is final: a pull request gone or landed, statuses done", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand({ kind: "pull", ...pullKey(4) });
    store.demand({ kind: "pull", ...pullKey(5) });
    store.demand({ kind: "statuses", origin: ORIGIN, owner: "shop", repo: "app", sha: "h4" });
    await clock.advance(0);
    await pending("pull shop/app#4").answer(undefined);
    await pending("pull shop/app#5").answer(pull(5, { state: "closed", merged: true }));
    await pending("statuses shop/app@h4").answer([{ context: "ci", state: "success" }]);

    await clock.advance(FORGE_WAKE_REVALIDATE_MS * 4);
    store.wake();
    await clock.advance(0);
    expect(sent("pull shop/app#4")).toHaveLength(1);
    expect(sent("pull shop/app#5")).toHaveLength(1);
    expect(sent("statuses shop/app@h4")).toHaveLength(1);
  });

  it("the store's end aborts the reads in flight and publishes nothing after", async () => {
    const { clock, store, pending } = rig();
    const fact = openPulls("shop", "app");
    store.demand(fact);
    await clock.advance(0);
    const read = pending("pulls shop/app open");
    const told: Array<ForgeFact> = [];
    store.subscribe((changed) => told.push(changed));
    store.dispose();
    expect(read.signal?.aborted).toBe(true);
    await read.answer([pull(4)]);
    expect(told).toEqual([]);
  });
});

describe("forge store backstops (DESIGN §6.3)", () => {
  it("a commit's statuses are read every 15 s while one is pending, for at most 20 minutes", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand({ kind: "statuses", origin: ORIGIN, owner: "shop", repo: "app", sha: "h4" });
    await clock.advance(0);
    const running = [{ context: "ci", state: "pending" as const }];
    await pending("statuses shop/app@h4").answer(running);
    for (let read = 0; read < FORGE_PENDING_STATUS_LIMIT_MS / FORGE_PENDING_STATUS_MS; read += 1) {
      await clock.advance(FORGE_PENDING_STATUS_MS);
      await pending("statuses shop/app@h4").answer(running);
    }
    const reads = sent("statuses shop/app@h4").length;
    await clock.advance(FORGE_PENDING_STATUS_LIMIT_MS);
    expect(sent("statuses shop/app@h4")).toHaveLength(reads);
  });

  it("final statuses are not read again", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand({ kind: "statuses", origin: ORIGIN, owner: "shop", repo: "app", sha: "h4" });
    await clock.advance(0);
    await pending("statuses shop/app@h4").answer([{ context: "ci", state: "success" }]);
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 10);
    expect(sent("statuses shop/app@h4")).toHaveLength(1);
  });

  it("a commit CI has posted nothing on yet is read again at the list backstop and on a wake", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand({ kind: "statuses", origin: ORIGIN, owner: "shop", repo: "app", sha: "h4" });
    await clock.advance(0);
    await pending("statuses shop/app@h4").answer([]);
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    await pending("statuses shop/app@h4").answer([]);

    await clock.advance(FORGE_WAKE_REVALIDATE_MS);
    store.wake();
    await clock.advance(0);
    expect(sent("statuses shop/app@h4")).toHaveLength(3);
  });

  it("the group repo's declarations come from environments.yaml, and no file declares none", async () => {
    const { clock, store, sent, pending } = rig();
    const fact: ForgeFact = { kind: "declarations", origin: ORIGIN, owner: "shop", repo: "group" };
    store.demand(fact);
    await clock.advance(0);
    await pending("file shop/group environments.yaml").answer(undefined);
    expect(store.read(fact)).toMatchObject({ state: "known", value: [], coverage: "complete" });
    await clock.advance(FORGE_DECLARATIONS_BACKSTOP_MS - 1);
    expect(sent("file shop/group environments.yaml")).toHaveLength(1);
    await clock.advance(1);
    expect(sent("file shop/group environments.yaml")).toHaveLength(2);
  });

  it("a branch's head is its commit, read at the list backstop, and a missing branch is gone", async () => {
    const { clock, store, sent, pending } = rig();
    const main: ForgeFact = {
      kind: "branch",
      origin: ORIGIN,
      owner: "shop",
      repo: "app",
      branch: "main",
    };
    const next: ForgeFact = {
      kind: "branch",
      origin: ORIGIN,
      owner: "shop",
      repo: "app",
      branch: "next",
    };
    store.demand(main);
    store.demand(next);
    await clock.advance(0);
    await pending("branch shop/app main").answer({ name: "main", commit: { id: "c1" } });
    await pending("branch shop/app next").answer(undefined);

    expect(store.read(main)).toMatchObject({ state: "known", value: "c1" });
    expect(store.read(next)).toMatchObject({ state: "gone", evidence: "direct-not-found" });
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("branch shop/app main")).toHaveLength(2);
  });

  it("shows an invalidation only while a view demands a fact under its key", async () => {
    const { clock, store, pending } = rig();
    const release = store.demand(openPulls("shop", "app"));
    await clock.advance(0);
    await pending("pulls shop/app open").answer([pull(4)]);
    const app = { topic: "forge-repo", origin: ORIGIN, owner: "shop", repo: "app" } as const;

    expect(store.shows(app)).toBe(true);
    // The pull request its demanded list names is shown too.
    expect(
      store.shows({ topic: "forge-pr", origin: ORIGIN, owner: "shop", repo: "app", number: 4 }),
    ).toBe(true);
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

  it("a repository with the person's permissions is unread until read, known after, and gone when Gitea has none", async () => {
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
    expect(store.read(app)).toMatchObject({ state: "known", value: permitted });
    expect(store.read(web)).toMatchObject({ state: "gone", evidence: "direct-not-found" });
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("repository shop/app")).toHaveLength(2);
  });

  it("a head branch's pull requests, whatever their state, are unread until read, known after, each with its MergeState", async () => {
    const { clock, store, sent, pending } = rig();
    const fact: ForgeFact = {
      kind: "branch-pulls",
      origin: ORIGIN,
      owner: "shop",
      repo: "app",
      branch: "mate/ada",
    };
    expect(store.read(fact)).toEqual({ state: "unread", waitingFor: null });
    store.demand(fact);
    await clock.advance(0);
    await pending("pulls shop/app all").answer([
      pull(5, { head: { ref: "mate/bob", sha: "h5" } }),
      pull(4, { head: { ref: "mate/ada", sha: "h4" }, mergeable: false }),
      pull(3, { head: { ref: "mate/ada", sha: "h3" }, state: "closed", merged: true }),
    ]);
    expect(store.read(fact)).toMatchObject({ state: "known", value: [4, 3], coverage: "complete" });
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("checking");
    expect(store.mergeState(pullKey(5))).toEqual({ state: "unread", waitingFor: null });

    // The pull request the demanded list names is rechecked while it is checking.
    await clock.advance(2_000);
    await pending("pull shop/app#4").answer(pull(4, { head: { ref: "mate/ada", sha: "h4" } }));
    expect(mergeability(store.mergeState(pullKey(4)))).toBe("mergeable");
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    expect(sent("pulls shop/app all")).toHaveLength(2);
  });

  it("the person's repositories and the pull request search are unread until read, known after, each on its own", async () => {
    const { clock, store, sent, pending } = rig();
    const repositories: ForgeFact = { kind: "user-repos", origin: ORIGIN };
    const search: ForgeFact = { kind: "pull-search", origin: ORIGIN };
    expect(store.read(repositories)).toEqual({ state: "unread", waitingFor: null });
    store.demand(repositories);
    store.demand(search);
    await clock.advance(0);
    await pending("user repos").answer([repo("app")]);
    await pending("pull search").fail(new GiteaApiError("Gitea refused.", 503));
    expect(store.read(repositories)).toMatchObject({ state: "known", value: [repo("app")] });
    expect(store.read(search)).toMatchObject({ state: "failed" });

    // A pull request landing anywhere on the Gitea changes what the search finds.
    await clock.advance(2_000);
    await pending("pull search").answer([{ number: 4, title: "x", state: "open" }]);
    store.invalidate({ topic: "forge-pr", origin: ORIGIN, owner: "shop", repo: "app", number: 4 });
    await clock.advance(0);
    expect(sent("pull search")).toHaveLength(3);
    expect(sent("user repos")).toHaveLength(1);
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

  it("a file at main is unread until read, known after, and one main does not hold is known as none until it lands", async () => {
    const { clock, store, sent, pending } = rig();
    const stage: ForgeFact = {
      kind: "file",
      origin: ORIGIN,
      owner: "shop",
      repo: "group",
      path: "3 — Stage/import.yaml",
    };
    expect(store.read(stage)).toEqual({ state: "unread", waitingFor: null });
    store.demand(stage);
    await clock.advance(0);
    await pending("file shop/group 3 — Stage/import.yaml@main").answer(undefined);
    expect(store.read(stage)).toMatchObject({ state: "known", value: null, coverage: "complete" });

    // The broker merges the recipe onto main minutes after the Mate is up.
    await clock.advance(FORGE_LIST_BACKSTOP_MS);
    await pending("file shop/group 3 — Stage/import.yaml@main").answer({
      path: "3 — Stage/import.yaml",
      content: "services: []",
      sha: "f1",
    });
    expect(store.read(stage)).toMatchObject({ state: "known", value: "services: []" });
    expect(sent("file shop/group 3 — Stage/import.yaml@main")).toHaveLength(2);
  });

  it("what one commit has over another is unread until read, known after, and never read again", async () => {
    const { clock, store, sent, pending } = rig();
    const fact: ForgeFact = {
      kind: "compare",
      origin: ORIGIN,
      owner: "shop",
      repo: "app",
      base: "b1",
      head: "h2",
    };
    expect(store.read(fact)).toEqual({ state: "unread", waitingFor: null });
    store.demand(fact);
    await clock.advance(0);
    const commits = [{ sha: "h2", subject: "Add cart" }];
    await pending("compare shop/app b1...h2").answer(commits);
    expect(store.read(fact)).toMatchObject({ state: "known", value: commits });

    // Two commits never change what one has over the other.
    await clock.advance(FORGE_LIST_BACKSTOP_MS * 5);
    store.wake();
    await clock.advance(0);
    expect(sent("compare shop/app b1...h2")).toHaveLength(1);
  });

  it("a commit's detail is unread until read, known after, gone when Gitea has none, and never read again", async () => {
    const { clock, store, sent, pending } = rig();
    const fact = (sha: string): ForgeFact => ({
      kind: "commit",
      origin: ORIGIN,
      owner: "shop",
      repo: "app",
      sha,
    });
    expect(store.read(fact("h2"))).toEqual({ state: "unread", waitingFor: null });
    store.demand(fact("h2"));
    store.demand(fact("h9"));
    await clock.advance(0);
    const detail = {
      sha: "h2",
      subject: "Add cart",
      files: [],
      additions: 3,
      deletions: 1,
    };
    await pending("commit shop/app@h2").answer(detail);
    await pending("commit shop/app@h9").answer(undefined);
    expect(store.read(fact("h2"))).toMatchObject({ state: "known", value: detail });
    expect(store.read(fact("h9"))).toMatchObject({ state: "gone", evidence: "direct-not-found" });

    await clock.advance(FORGE_LIST_BACKSTOP_MS * 5);
    store.wake();
    await clock.advance(0);
    expect(sent("commit shop/app@h2")).toHaveLength(1);
  });

  it("a pull request first read as landed long ago puts no open one back to checking", async () => {
    const { clock, store, sent, pending } = rig();
    store.demand(openPulls("shop", "app"));
    store.demand({
      kind: "branch-pulls",
      origin: ORIGIN,
      owner: "shop",
      repo: "app",
      branch: "mate/ada",
    });
    await clock.advance(0);
    await pending("pulls shop/app open").answer([pull(5)]);
    await pending("pulls shop/app all").answer([
      pull(3, { head: { ref: "mate/ada", sha: "h3" }, state: "closed", merged: true }),
    ]);

    expect(mergeability(store.mergeState(pullKey(5)))).toBe("mergeable");
    await clock.advance(0);
    expect(sent("pull shop/app#5")).toHaveLength(0);
  });
});
