import type { ZeropsThrowawayPlatform } from "@t3tools/client-runtime/authorization";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  ensureGiteaSession,
  forgetGiteaSession,
  giteaClientFor,
  giteaSessionLogin,
  GiteaSignInError,
  hasGiteaSession,
  subscribeGiteaSessions,
} from "./giteaSession";

/**
 * A distinct Gitea per case: the session store is module memory for the life
 * of the account, and these cases open none, so nothing clears it between them.
 */
let counter = 0;
function origins(): { readonly giteaOrigin: string; readonly brokerOrigin: string } {
  counter += 1;
  return {
    giteaOrigin: `https://web-${counter}-3000.prg1.zerops.app`,
    brokerOrigin: `https://broker-${counter}-8080.prg1.zerops.app`,
  };
}

function recording() {
  const minted: Array<string> = [];
  const removed: Array<string> = [];
  const platform: ZeropsThrowawayPlatform = {
    mint: async (input) => {
      minted.push(input.name);
      return { id: `token-${minted.length}`, token: "the-throwaway" };
    },
    remove: async (input) => {
      removed.push(input.tokenId);
    },
  };
  return { platform, minted, removed } as const;
}

function answering(
  response: { readonly status: number; readonly body?: unknown },
  seen: Array<{ url: string; init: RequestInit }> = [],
): { readonly fetch: typeof globalThis.fetch; readonly seen: typeof seen } {
  const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(response.body ?? null), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, seen };
}

describe("ensureGiteaSession", () => {
  it("acquires a token from the broker by throwaway, once, and keeps it for the tab", async () => {
    const where = origins();
    const { platform, minted, removed } = recording();
    const { fetch, seen } = answering({
      status: 200,
      body: { token: "gitea-token", login: "u-abc", expiresIn: 43200 },
    });

    const changes: Array<boolean> = [];
    const stop = subscribeGiteaSessions(() => changes.push(hasGiteaSession(where.giteaOrigin)));

    // Two surfaces ask in the same tick: one acquisition, both wait for it.
    await Promise.all([
      ensureGiteaSession({ ...where, clientId: "org-1", platform, fetch }),
      ensureGiteaSession({ ...where, clientId: "org-1", platform, fetch }),
    ]);
    stop();

    expect(seen.map((call) => call.url)).toEqual([`${where.brokerOrigin}/person/token`]);
    const headers = seen[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer the-throwaway");
    // Named for the Gitea it is for, once, whatever the nonce.
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatch(
      new RegExp(`^gitea-signin:web-${counter}-3000\\.prg1\\.zerops\\.app:`, "u"),
    );
    expect(removed).toEqual(["token-1"]);
    expect(hasGiteaSession(where.giteaOrigin)).toBe(true);
    expect(giteaSessionLogin(where.giteaOrigin)).toBe("u-abc");
    expect(changes).toEqual([true]);

    // A third ask costs nothing.
    await ensureGiteaSession({ ...where, clientId: "org-1", platform, fetch });
    expect(seen).toHaveLength(1);
  });

  it("says the Gitea is still setting up when the broker cannot reach it, and is worth asking again", async () => {
    const where = origins();
    const { platform, removed } = recording();
    const { fetch } = answering({
      status: 502,
      body: { error: "gitea", message: "Gitea could not be reached" },
    });

    const failure = await ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch,
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GiteaSignInError);
    expect((failure as GiteaSignInError).pending).toBe(true);
    expect((failure as GiteaSignInError).message).toBe("Gitea is still setting up.");
    // The throwaway was taken back whatever the broker answered, and nothing is held.
    expect(removed).toEqual(["token-1"]);
    expect(hasGiteaSession(where.giteaOrigin)).toBe(false);
  });

  it("says what Gitea refused, in Gitea's words, and does not retry it", async () => {
    // 424 from the broker: Gitea said no (the owner's run of 2026-09-17, a
    // login source that had not been added). A 502 would have been the
    // platform's edge page and read as "still setting up".
    const where = origins();
    const { platform } = recording();
    const { fetch } = answering({
      status: 424,
      body: {
        error: "gitea_refused",
        message: "Gitea refused: login source does not exist [id: 1]",
      },
    });
    const failure = await ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch,
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GiteaSignInError);
    expect((failure as GiteaSignInError).pending).toBe(false);
    expect((failure as GiteaSignInError).message).toBe(
      "Gitea refused: login source does not exist [id: 1]",
    );
  });

  it("names a refusal in the person's terms and does not retry it by itself", async () => {
    const where = origins();
    const { platform } = recording();
    const { fetch } = answering({
      status: 403,
      body: { error: "not_a_member", message: "that account is not an active member" },
    });
    const failure = await ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch,
    }).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GiteaSignInError);
    expect((failure as GiteaSignInError).pending).toBe(false);
    expect((failure as GiteaSignInError).message).toContain("not a member");
  });

  it("forgets the session on the first 401 Gitea answers, so the surface acquires again", async () => {
    const where = origins();
    const { platform } = recording();
    const { fetch } = answering({ status: 200, body: { token: "t1", login: "u-abc" } });
    await ensureGiteaSession({ ...where, clientId: "org-1", platform, fetch });

    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "token does not exist" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof globalThis.fetch;
    try {
      const client = giteaClientFor(where.giteaOrigin);
      expect(client).not.toBeNull();
      await client?.listTags("acme", "group").catch(() => undefined);
    } finally {
      globalThis.fetch = original;
    }
    expect(hasGiteaSession(where.giteaOrigin)).toBe(false);
    expect(giteaClientFor(where.giteaOrigin)).toBeNull();
  });

  it("forgets on request", async () => {
    const where = origins();
    const { platform } = recording();
    const { fetch } = answering({ status: 200, body: { token: "t1", login: "u-abc" } });
    await ensureGiteaSession({ ...where, clientId: "org-1", platform, fetch });
    forgetGiteaSession(where.giteaOrigin);
    expect(hasGiteaSession(where.giteaOrigin)).toBe(false);
  });
});

/** A broker that holds its answer until the test releases it. */
function held(body: { readonly token: string; readonly login: string }) {
  let calls = 0;
  let release: () => void = () => undefined;
  const fetchFn = (async () => {
    calls += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, calls: () => calls, answer: () => release() } as const;
}

/** Answers every Gitea read with an empty list and records the bearer it carried. */
async function readTagsAs(giteaOrigin: string): Promise<ReadonlyArray<string> | null> {
  const client = giteaClientFor(giteaOrigin);
  if (client === null) return null;
  const bearers: Array<string> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string> | undefined;
    bearers.push(headers?.authorization ?? "");
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  try {
    await client.listTags("acme", "group");
  } finally {
    globalThis.fetch = original;
  }
  return bearers;
}

describe("Gitea sessions belong to one account", () => {
  afterEach(() => {
    closeAccountLifetime();
  });

  it("sign-out, another person signs in on the same tab: no Gitea request carries the first person's token", async () => {
    const where = origins();
    const { platform } = recording();
    openAccountLifetime("person-a");
    await ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch: answering({ status: 200, body: { token: "token-of-a", login: "u-a" } }).fetch,
    });
    expect(await readTagsAs(where.giteaOrigin)).toEqual(["Bearer token-of-a"]);

    closeAccountLifetime();
    openAccountLifetime("person-b");

    // Nothing of A's is left to read with: B's surface has to acquire its own.
    expect(hasGiteaSession(where.giteaOrigin)).toBe(false);
    expect(await readTagsAs(where.giteaOrigin)).toBeNull();

    const b = answering({ status: 200, body: { token: "token-of-b", login: "u-b" } });
    await ensureGiteaSession({ ...where, clientId: "org-1", platform, fetch: b.fetch });
    expect(b.seen).toHaveLength(1);
    expect(giteaSessionLogin(where.giteaOrigin)).toBe("u-b");
    expect(await readTagsAs(where.giteaOrigin)).toEqual(["Bearer token-of-b"]);
  });

  it("an acquisition in flight at sign-out never lands in the next account", async () => {
    const where = origins();
    const { platform } = recording();
    const brokerOfA = held({ token: "token-of-a", login: "u-a" });
    const brokerOfB = held({ token: "token-of-b", login: "u-b" });

    openAccountLifetime("person-a");
    const acquisitionOfA = ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch: brokerOfA.fetch,
    }).catch((cause: unknown) => cause);
    await vi.waitFor(() => expect(brokerOfA.calls()).toBe(1));

    closeAccountLifetime();
    openAccountLifetime("person-b");

    // B does not wait on A's request: it asks the broker itself.
    const acquisitionOfB = ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch: brokerOfB.fetch,
    });
    await vi.waitFor(() => expect(brokerOfB.calls()).toBe(1));

    brokerOfA.answer();
    const outcomeOfA = await acquisitionOfA;
    expect(hasGiteaSession(where.giteaOrigin)).toBe(false);
    // Whoever awaited A's sign-in hears it did not go through.
    expect(outcomeOfA).toBeInstanceOf(GiteaSignInError);

    // A settling late does not unseat B's acquisition: another ask joins it.
    const brokerAskedAgain = held({ token: "token-of-b2", login: "u-b" });
    const joined = ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch: brokerAskedAgain.fetch,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(brokerAskedAgain.calls()).toBe(0);

    brokerOfB.answer();
    await Promise.all([acquisitionOfB, joined]);
    expect(giteaSessionLogin(where.giteaOrigin)).toBe("u-b");
    expect(await readTagsAs(where.giteaOrigin)).toEqual(["Bearer token-of-b"]);
  });

  it("account close notifies subscribers", async () => {
    const where = origins();
    const { platform } = recording();
    openAccountLifetime("person-a");
    await ensureGiteaSession({
      ...where,
      clientId: "org-1",
      platform,
      fetch: answering({ status: 200, body: { token: "token-of-a", login: "u-a" } }).fetch,
    });

    const seen: Array<boolean> = [];
    const stop = subscribeGiteaSessions(() => seen.push(hasGiteaSession(where.giteaOrigin)));
    closeAccountLifetime();
    stop();

    expect(seen).toEqual([false]);
  });
});
