import type { ZeropsThrowawayPlatform } from "@t3tools/client-runtime/authorization";
import { describe, expect, it } from "vite-plus/test";

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
 * of the tab, which is the behaviour, not a test artefact.
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
