// @effect-diagnostics globalTimers:off -- the sessions answer through fetch promises; these tests let them settle.
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsThrowawayPlatform } from "../../authorization/zeropsThrowaway.ts";
import { ZeropsApiError } from "../api.ts";
import { GiteaApiError } from "../giteaClient.ts";
import {
  fetchAcross,
  HARNESS_BROKER_ORIGIN,
  HARNESS_GITEA_ORIGIN,
  makeAccountHarness,
} from "../testing/accountHarness.ts";
import {
  BROKER_DEADLINE_MS,
  makeGiteaSessions,
  REQUEST_QUEUE_MS,
  type GiteaSessions,
} from "./giteaSession.ts";
import type { GiteaSessionView } from "./giteaSessionMachine.ts";

const S = 1_000;
const MIN = 60 * S;

/** Lets every fetch promise the fakes answer settle. */
const settled = async () => {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Time the test moves by hand; timers fire in order. */
function manualTime() {
  let now = 0;
  const timers: Array<{ readonly at: number; readonly fire: () => void; live: boolean }> = [];
  return {
    now: () => ({ wall: now, mono: now }),
    setTimer: (delayMs: number, fire: () => void) => {
      const timer = { at: now + Math.max(0, delayMs), fire, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance: async (ms: number) => {
      const target = now + ms;
      for (;;) {
        await settled();
        const next = timers
          .filter((timer) => timer.live && timer.at <= target)
          .toSorted((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        next.live = false;
        now = next.at;
        next.fire();
      }
      now = target;
      await settled();
    },
  };
}

function recordingPlatform() {
  const minted: Array<string> = [];
  const removed: Array<string> = [];
  let refuseMint: unknown = null;
  const platform: ZeropsThrowawayPlatform = {
    mint: async (input) => {
      if (refuseMint !== null) throw refuseMint;
      minted.push(input.name);
      return { id: `throwaway-${String(minted.length)}`, token: "the-throwaway" };
    },
    remove: async (input) => {
      removed.push(input.tokenId);
    },
  };
  return {
    platform,
    minted,
    removed,
    refuseMints: (cause: unknown) => {
      refuseMint = cause;
    },
  } as const;
}

type Fetch = typeof globalThis.fetch;

function world(options: { readonly wrapFetch?: (fetch: Fetch) => Fetch } = {}) {
  const harness = makeAccountHarness({ people: [] });
  const time = manualTime();
  const throwaways = recordingPlatform();
  let visible = true;
  const direct = fetchAcross(harness.gitea, harness.broker);
  const sessions = makeGiteaSessions({
    fetch: options.wrapFetch === undefined ? direct : options.wrapFetch(direct),
    now: time.now,
    visible: () => visible,
    random: () => 0.5,
    nonce: () => "nonce",
    setTimer: time.setTimer,
  });
  const demand = () =>
    sessions.demand({
      giteaOrigin: HARNESS_GITEA_ORIGIN,
      brokerOrigin: HARNESS_BROKER_ORIGIN,
      clientId: "org-1",
      platform: throwaways.platform,
    });
  const views: Array<GiteaSessionView> = [];
  sessions.subscribe(() => views.push(sessions.view(HARNESS_GITEA_ORIGIN)));
  return {
    ...harness,
    time,
    throwaways,
    sessions,
    demand,
    views,
    view: () => sessions.view(HARNESS_GITEA_ORIGIN),
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
  };
}

const brokerPosts = (w: ReturnType<typeof world>) =>
  w.broker.requests().filter((request) => request.route === "POST /person/token");
const livenessChecks = (w: ReturnType<typeof world>) =>
  w.broker.requests().filter((request) => request.route === "GET /");

/**
 * The broker's mint, held by the test: `hold` keeps each mint unanswered until `refuse` answers
 * them 502, or until the request is aborted at the broker's deadline.
 */
function brokerGate() {
  let holding = false;
  const held: Array<() => void> = [];
  const wrap =
    (fetch: Fetch): Fetch =>
    async (input, init) => {
      if (holding && String(input).endsWith("/person/token")) {
        return new Promise<Response>((resolve, reject) => {
          held.push(() => resolve(new Response("", { status: 502 })));
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }
      return fetch(input, init);
    };
  return {
    wrap,
    hold: () => {
      holding = true;
    },
    refuse: () => {
      holding = false;
      for (const answer of held.splice(0)) answer();
    },
  } as const;
}

type BrokerGate = ReturnType<typeof brokerGate>;

const readTags = (sessions: GiteaSessions) => {
  const client = sessions.clientFor(HARNESS_GITEA_ORIGIN);
  if (client === null) throw new Error("no Gitea client");
  return client.listTags("acme", "group");
};

describe("the account's Gitea sessions", () => {
  it("acquires a token from the broker by throwaway, once for the account epoch however many surfaces ask", async () => {
    const w = world();
    w.gitea.setTags("acme", "group", ["v1.0.0"]);

    const releaseA = w.demand();
    const releaseB = w.demand();
    await w.time.advance(0);

    expect(w.throwaways.minted).toHaveLength(1);
    expect(w.throwaways.minted[0]).toMatch(/^gitea-signin:gitea-1-3000\.prg1\.zerops\.app:/u);
    expect(w.throwaways.removed).toEqual(["throwaway-1"]);
    expect(brokerPosts(w)).toEqual([
      { route: "POST /person/token", bearer: "the-throwaway", mode: null },
    ]);
    // The first acquisition goes straight to the mint: no liveness check.
    expect(livenessChecks(w)).toEqual([]);
    expect(w.view()).toEqual({ signedIn: true, readable: true, login: "u-person", trouble: null });
    await expect(readTags(w.sessions)).resolves.toEqual([{ name: "v1.0.0" }]);
    expect(w.gitea.requests().map((request) => request.bearer)).toEqual(["gitea-token-1"]);

    // Asked again, and after both surfaces let go, it costs nothing.
    releaseA();
    releaseB();
    w.demand();
    await w.time.advance(10 * MIN);
    expect(brokerPosts(w)).toHaveLength(1);
  });

  it("Gitea down: after 2 failures regions show the cause; at most one mint per rung", async () => {
    const w = world();
    w.broker.answer("unreachable");
    w.demand();
    await w.time.advance(0);

    // The first failure is not said yet.
    expect(w.throwaways.minted).toHaveLength(1);
    expect(w.throwaways.removed).toEqual(["throwaway-1"]);
    expect(w.view()).toEqual({ signedIn: false, readable: false, login: undefined, trouble: null });

    // Every rung checks the broker without credentials first and mints nothing while it is down.
    await w.time.advance(10 * S);
    expect(w.view().trouble).toBe("Gitea isn't answering.");
    await w.time.advance(20 * S + 40 * S + 60 * S);
    expect(w.throwaways.minted).toHaveLength(1);

    // Up again: the next rung's liveness check answers, one mint, and the reads fill.
    w.broker.answer("answering");
    w.gitea.setTags("acme", "group", ["v1.0.0"]);
    await w.time.advance(60 * S);
    expect(w.throwaways.minted).toHaveLength(2);
    expect(livenessChecks(w).map((check) => check.mode)).toEqual(["no-cors"]);
    expect(livenessChecks(w).every((check) => check.bearer === null)).toBe(true);
    expect(w.view()).toEqual({ signedIn: true, readable: true, login: "u-person", trouble: null });
    await expect(readTags(w.sessions)).resolves.toEqual([{ name: "v1.0.0" }]);
  });

  it("Gitea still setting up: each rung checks the broker, then mints once", async () => {
    const w = world();
    w.broker.answer("setting-up");
    w.demand();
    await w.time.advance(0);
    expect(w.view().trouble).toBeNull();

    await w.time.advance(5 * S);
    expect(w.throwaways.minted).toHaveLength(2);
    expect(w.broker.requests().map((request) => request.route)).toEqual([
      "POST /person/token",
      "GET /",
      "POST /person/token",
    ]);
    expect(w.view().trouble).toBe("Gitea is still setting up.");

    w.broker.answer("answering");
    await w.time.advance(10 * S);
    expect(w.view().signedIn).toBe(true);
    expect(w.throwaways.removed).toEqual(["throwaway-1", "throwaway-2", "throwaway-3"]);
  });

  it("asks a refusal again every 5 minutes while the tab is visible, in the refuser's words", async () => {
    const w = world();
    w.broker.answer("not-a-member");
    w.demand();
    await w.time.advance(0);
    expect(w.view().trouble).toBe("You are not a member of this organization's Gitea.");

    w.broker.answer("gitea-refused");
    await w.time.advance(5 * MIN);
    expect(brokerPosts(w)).toHaveLength(2);
    // Gitea said no, in its words — not "still setting up".
    expect(w.view().trouble).toBe("Gitea refused: login source does not exist [id: 1]");

    w.hide();
    await w.time.advance(20 * MIN);
    expect(brokerPosts(w)).toHaveLength(2);

    w.broker.answer("answering");
    w.show();
    w.sessions.wake();
    await w.time.advance(0);
    expect(brokerPosts(w)).toHaveLength(3);
    expect(w.view()).toEqual({ signedIn: true, readable: true, login: "u-person", trouble: null });
  });

  it("shown again after a short hide, a refusal that came due while hidden is asked at once", async () => {
    const w = world();
    w.broker.answer("not-a-member");
    w.demand();
    await w.time.advance(0);
    w.hide();
    await w.time.advance(6 * MIN);
    expect(brokerPosts(w)).toHaveLength(1);

    w.broker.answer("answering");
    w.show();
    w.sessions.resume();
    await w.time.advance(0);
    expect(brokerPosts(w)).toHaveLength(2);
    expect(w.view().signedIn).toBe(true);
  });

  it("a mint that waited out a closed account window asks again soon and says nothing", async () => {
    const w = world();
    w.throwaways.refuseMints(
      new ZeropsApiError(
        "Zerops access is still being checked. Try again in a moment.",
        "access-unverified",
      ),
    );
    w.demand();
    await w.time.advance(0);
    expect(w.view()).toEqual({ signedIn: false, readable: false, login: undefined, trouble: null });
    expect(brokerPosts(w)).toEqual([]);

    w.throwaways.refuseMints(null);
    await w.time.advance(2 * S);
    expect(w.view().signedIn).toBe(true);
  });

  describe("a Gitea 401", () => {
    it("mid-read reacquires, and the read completes with the new token: nothing is blanked", async () => {
      const w = world();
      w.gitea.setTags("acme", "group", ["v1.0.0"]);
      w.demand();
      await w.time.advance(0);
      w.gitea.revoke("gitea-token-1");
      w.views.length = 0;

      await expect(readTags(w.sessions)).resolves.toEqual([{ name: "v1.0.0" }]);

      expect(w.gitea.requests().map((request) => request.bearer)).toEqual([
        "gitea-token-1",
        "gitea-token-2",
      ]);
      expect(w.views.every((view) => view.signedIn)).toBe(true);
      expect(w.throwaways.minted).toHaveLength(2);
    });

    it("keyed to the token that was sent: a late 401 for the old token leaves the new session alone", async () => {
      // The first read of the old token is held at Gitea until the test lets it answer.
      let holdFirst = true;
      let answerHeld: () => void = () => undefined;
      const w = world({
        wrapFetch: (fetch) =>
          (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (holdFirst && url.includes("/tags")) {
              holdFirst = false;
              await new Promise<void>((resolve) => {
                answerHeld = resolve;
              });
            }
            return fetch(input, init);
          }) as Fetch,
      });
      w.gitea.setTags("acme", "group", ["v1.0.0"]);
      w.demand();
      await w.time.advance(0);
      w.gitea.revoke("gitea-token-1");

      const held = readTags(w.sessions);
      await w.time.advance(0);
      await expect(readTags(w.sessions)).resolves.toEqual([{ name: "v1.0.0" }]);
      answerHeld();
      await expect(held).resolves.toEqual([{ name: "v1.0.0" }]);

      // One reacquire for both, and the new token kept.
      expect(w.broker.personTokens()).toBe(2);
      expect(w.view().signedIn).toBe(true);
      await readTags(w.sessions);
      expect(w.gitea.requests().at(-1)?.bearer).toBe("gitea-token-2");
    });

    it("a reacquire the broker does not answer within the queue answers the reader with Gitea's 401", async () => {
      let brokerHangs = false;
      const w = world({
        wrapFetch: (fetch) =>
          (async (input: string | URL | Request, init?: RequestInit) => {
            if (brokerHangs && String(input).endsWith("/person/token")) {
              return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
                  once: true,
                });
              });
            }
            return fetch(input, init);
          }) as Fetch,
      });
      w.demand();
      await w.time.advance(0);
      w.gitea.revoke("gitea-token-1");
      brokerHangs = true;

      const read = readTags(w.sessions).catch((cause: unknown) => cause);
      await w.time.advance(REQUEST_QUEUE_MS);
      const failure = await read;
      expect(failure).toBeInstanceOf(GiteaApiError);
      expect((failure as GiteaApiError).status).toBe(401);
      // The facts still stand while the reacquire runs on.
      expect(w.view().signedIn).toBe(true);

      // The broker's own deadline ends the attempt: unavailable, and the throwaway taken back.
      // One failure: the facts still stand, but nothing is read without a token.
      await w.time.advance(BROKER_DEADLINE_MS);
      expect(w.view()).toEqual({
        signedIn: true,
        readable: false,
        login: "u-person",
        trouble: null,
      });
      expect(w.sessions.clientFor(HARNESS_GITEA_ORIGIN)).toBeNull();
      expect(w.throwaways.removed).toEqual(["throwaway-1", "throwaway-2"]);

      // The next rung's mint is not answered either: the facts still stand, the cause beside them.
      await w.time.advance(BROKER_DEADLINE_MS);
      expect(w.view()).toEqual({
        signedIn: true,
        readable: false,
        login: "u-person",
        trouble: "Gitea isn't answering.",
      });
    });

    it("one the reacquire recovered is not told to the client's reader", async () => {
      const w = world();
      w.gitea.setTags("acme", "group", ["v1.0.0"]);
      w.demand();
      await w.time.advance(0);
      let unauthorized = 0;

      w.gitea.revoke("gitea-token-1");
      const client = w.sessions.clientFor(HARNESS_GITEA_ORIGIN, () => {
        unauthorized += 1;
      });
      await expect(client?.listTags("acme", "group")).resolves.toEqual([{ name: "v1.0.0" }]);
      expect(unauthorized).toBe(0);
    });

    it.each([
      {
        name: "the reacquire outlasts the request's wait",
        // The broker holds the mint past REQUEST_QUEUE_MS; the read answers Gitea's 401.
        read: async (w: ReturnType<typeof world>, gate: BrokerGate, tell: () => void) => {
          w.gitea.revoke("gitea-token-1");
          gate.hold();
          const read = w.sessions
            .clientFor(HARNESS_GITEA_ORIGIN, tell)
            ?.listTags("acme", "group")
            .catch((cause: unknown) => cause);
          await w.time.advance(REQUEST_QUEUE_MS);
          return read;
        },
      },
      {
        name: "no token is there to send: the reacquire it waited on failed",
        // Taken while another read's reacquire runs; the broker then refuses, before this read is sent.
        read: async (w: ReturnType<typeof world>, gate: BrokerGate, tell: () => void) => {
          w.gitea.revoke("gitea-token-1");
          gate.hold();
          void readTags(w.sessions).catch(() => undefined);
          await w.time.advance(0);
          const read = w.sessions
            .clientFor(HARNESS_GITEA_ORIGIN, tell)
            ?.listTags("acme", "group")
            .catch((cause: unknown) => cause);
          gate.refuse();
          await w.time.advance(0);
          return read;
        },
      },
      {
        name: "the recovered token is refused too",
        read: async (w: ReturnType<typeof world>, _gate: BrokerGate, tell: () => void) => {
          w.gitea.revoke("gitea-token-1");
          w.gitea.revoke("gitea-token-2");
          const read = w.sessions
            .clientFor(HARNESS_GITEA_ORIGIN, tell)
            ?.listTags("acme", "group")
            .catch((cause: unknown) => cause);
          await w.time.advance(0);
          return read;
        },
      },
    ])("that no token recovered is told to the client's reader: $name", async ({ read }) => {
      const gate = brokerGate();
      const w = world({ wrapFetch: gate.wrap });
      w.gitea.setTags("acme", "group", ["v1.0.0"]);
      w.demand();
      await w.time.advance(0);
      let unauthorized = 0;

      const failure = await read(w, gate, () => {
        unauthorized += 1;
      });

      expect(failure).toBeInstanceOf(GiteaApiError);
      expect((failure as GiteaApiError).status).toBe(401);
      expect(unauthorized).toBe(1);
    });

    it("whose reacquire fails tells the surfaces when nothing can be read, and when it can again", async () => {
      let brokerDown = false;
      const w = world({
        wrapFetch: (fetch) =>
          (async (input: string | URL | Request, init?: RequestInit) => {
            if (brokerDown && String(input).endsWith("/person/token")) {
              return new Response("", { status: 502 });
            }
            return fetch(input, init);
          }) as Fetch,
      });
      w.demand();
      await w.time.advance(0);
      w.gitea.revoke("gitea-token-1");
      brokerDown = true;
      w.views.length = 0;

      await readTags(w.sessions).catch(() => undefined);
      await w.time.advance(0);
      // The facts stand, and a surface is told that it can read nothing meanwhile.
      expect(w.views.at(-1)).toEqual({
        signedIn: true,
        readable: false,
        login: "u-person",
        trouble: null,
      });

      brokerDown = false;
      w.sessions.online();
      await w.time.advance(0);
      // The token is back: a surface that kept what it read reads again.
      expect(w.views.at(-1)).toEqual({
        signedIn: true,
        readable: true,
        login: "u-person",
        trouble: null,
      });
    });
  });

  it("honours expiresIn: renewed only while demanded, forgotten at expiry otherwise", async () => {
    const w = world();
    w.broker.expiresIn(10 * 60);
    const release = w.demand();
    await w.time.advance(0);

    await w.time.advance(9 * MIN);
    expect(w.broker.personTokens()).toBe(2);
    expect(w.view().signedIn).toBe(true);

    release();
    await w.time.advance(10 * MIN);
    expect(w.broker.personTokens()).toBe(2);
    expect(w.view().signedIn).toBe(false);
    expect(w.sessions.clientFor(HARNESS_GITEA_ORIGIN)).toBeNull();
  });

  describe("closing the account's sessions", () => {
    it("forgets every token: no client, no request carries it", async () => {
      const w = world();
      w.demand();
      await w.time.advance(0);
      const client = w.sessions.clientFor(HARNESS_GITEA_ORIGIN);
      w.views.length = 0;

      w.sessions.close();

      expect(w.views).toEqual([
        { signedIn: false, readable: false, login: undefined, trouble: null },
      ]);
      expect(w.view().signedIn).toBe(false);
      expect(w.sessions.clientFor(HARNESS_GITEA_ORIGIN)).toBeNull();
      await expect(client?.listTags("acme", "group")).rejects.toBeInstanceOf(GiteaApiError);
      expect(w.gitea.requests()).toEqual([]);
    });

    it("an acquisition in flight lands nowhere, silently, and its throwaway is still taken back", async () => {
      let answerBroker: () => void = () => undefined;
      const w = world({
        wrapFetch: (fetch) =>
          (async (input: string | URL | Request, init?: RequestInit) => {
            if (String(input).endsWith("/person/token")) {
              await new Promise<void>((resolve) => {
                answerBroker = resolve;
              });
            }
            return fetch(input, init);
          }) as Fetch,
      });
      w.demand();
      await w.time.advance(0);

      w.sessions.close();
      w.views.length = 0;
      answerBroker();
      await w.time.advance(0);

      expect(w.views).toEqual([]);
      expect(w.view()).toEqual({
        signedIn: false,
        readable: false,
        login: undefined,
        trouble: null,
      });
      expect(w.throwaways.removed).toEqual(["throwaway-1"]);
      // Nothing starts after close.
      w.demand();
      await w.time.advance(10 * MIN);
      expect(w.throwaways.minted).toHaveLength(1);
    });

    it("a throwaway minted after close is never sent to the broker, and is still taken back", async () => {
      const w = world();
      let finishMint: () => void = () => undefined;
      w.sessions.demand({
        giteaOrigin: HARNESS_GITEA_ORIGIN,
        brokerOrigin: HARNESS_BROKER_ORIGIN,
        clientId: "org-1",
        platform: {
          mint: async (input) => {
            await new Promise<void>((resolve) => {
              finishMint = resolve;
            });
            return w.throwaways.platform.mint(input);
          },
          remove: w.throwaways.platform.remove,
        },
      });
      await w.time.advance(0);

      w.sessions.close();
      finishMint();
      await w.time.advance(0);

      expect(w.throwaways.minted).toHaveLength(1);
      expect(brokerPosts(w)).toEqual([]);
      expect(w.throwaways.removed).toEqual(["throwaway-1"]);
      expect(w.view()).toEqual({
        signedIn: false,
        readable: false,
        login: undefined,
        trouble: null,
      });
    });
  });
});
