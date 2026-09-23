import { describe, expect, it } from "vite-plus/test";

import type { Instant } from "../data/access/grant.ts";
import {
  GiteaApiError,
  type GiteaClient,
  type GiteaPullRequest,
  type GiteaRepository,
} from "../giteaClient.ts";
import {
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
      listTags: (owner: string, repo: string) => at(`tags ${owner}/${repo}`),
      readFile: (owner: string, repo: string, path: string) => at(`file ${owner}/${repo} ${path}`),
      listCommitStatuses: (owner: string, repo: string, sha: string) =>
        at(`statuses ${owner}/${repo}@${sha}`),
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
});
