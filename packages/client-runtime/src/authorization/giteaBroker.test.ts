import { describe, expect, it } from "vite-plus/test";

import { completeGiteaSignIn, MateCredentialError, requestMateCredential } from "./giteaBroker.ts";
import type { ZeropsThrowawayPlatform } from "./zeropsThrowaway.ts";

const VALUE = "THE-THROWAWAY-VALUE";
const ANSWER = {
  url: "https://web-926-3000.prg1.zerops.app",
  org: "acme",
  bot: "mate-proj-1",
  generation: 2,
  minted: true,
  token: "THE-BOT-TOKEN",
};

function fakePlatform(): { platform: ZeropsThrowawayPlatform; calls: Array<string> } {
  const calls: Array<string> = [];
  return {
    calls,
    platform: {
      mint: (input) => {
        calls.push(`mint:${input.name}`);
        return Promise.resolve({ id: "tok-1", token: VALUE });
      },
      remove: (input) => {
        calls.push(`remove:${input.tokenId}`);
        return Promise.resolve();
      },
    },
  };
}

function recordingFetch(respond: (request: Request) => Response) {
  const seen: Array<{ url: string; authorization: string | null; body: string }> = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return respond(new Request("https://broker.example/mate/credential"));
  };
  return { fetch: fetchImpl, seen };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const BASE = {
  brokerUrl: "https://broker-926-8080.prg1.zerops.app/",
  giteaUrl: "https://web-926-3000.prg1.zerops.app",
  clientId: "org-1",
  projectId: "proj-1",
  mode: "ensure" as const,
  nonce: "n1",
};

describe("requestMateCredential", () => {
  it("asks the broker as the person, with a throwaway named for that Gitea", async () => {
    const { platform, calls } = fakePlatform();
    const { fetch, seen } = recordingFetch(() => json(200, ANSWER));

    await expect(requestMateCredential({ ...BASE, platform, fetch })).resolves.toEqual(ANSWER);

    expect(seen).toEqual([
      {
        url: "https://broker-926-8080.prg1.zerops.app/mate/credential",
        authorization: `Bearer ${VALUE}`,
        body: JSON.stringify({ project: "proj-1", mode: "ensure" }),
      },
    ]);
    // The throwaway is gone before the answer is used for anything.
    expect(calls).toEqual(["mint:gitea-signin:web-926-3000.prg1.zerops.app:n1", "remove:tok-1"]);
  });

  it("takes the throwaway back when the broker refuses", async () => {
    const { platform, calls } = fakePlatform();
    const { fetch } = recordingFetch(() =>
      json(403, { error: "not_owner", message: "Only its owner opens this Mate." }),
    );

    await expect(requestMateCredential({ ...BASE, platform, fetch })).rejects.toMatchObject({
      code: "not_owner",
      status: 403,
      message: "Only its owner opens this Mate.",
    });
    expect(calls).toEqual(["mint:gitea-signin:web-926-3000.prg1.zerops.app:n1", "remove:tok-1"]);
  });

  it("takes the throwaway back when the broker never answers", async () => {
    const { platform, calls } = fakePlatform();
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.reject(new TypeError("Failed to fetch"));

    await expect(requestMateCredential({ ...BASE, platform, fetch: fetchImpl })).rejects.toThrow(
      "Failed to fetch",
    );
    expect(calls).toEqual(["mint:gitea-signin:web-926-3000.prg1.zerops.app:n1", "remove:tok-1"]);
  });

  it("carries the mode the caller chose", async () => {
    const { platform } = fakePlatform();
    const { fetch, seen } = recordingFetch(() => json(200, { ...ANSWER, generation: 3 }));
    await requestMateCredential({ ...BASE, mode: "rotate", platform, fetch });
    expect(seen[0]?.body).toBe(JSON.stringify({ project: "proj-1", mode: "rotate" }));
  });

  it("reads an ensure that minted nothing", async () => {
    const { platform } = fakePlatform();
    const { fetch } = recordingFetch(() =>
      json(200, { url: ANSWER.url, org: "acme", bot: "mate-proj-1", generation: 1, minted: false }),
    );
    await expect(requestMateCredential({ ...BASE, platform, fetch })).resolves.toEqual({
      url: ANSWER.url,
      org: "acme",
      bot: "mate-proj-1",
      generation: 1,
      minted: false,
    });
  });

  const refused: ReadonlyArray<{ readonly name: string; readonly body: unknown }> = [
    { name: "an answer that is not an object", body: "ok" },
    { name: "an answer missing the Gitea URL", body: { ...ANSWER, url: undefined } },
    { name: "an answer whose generation is not a number", body: { ...ANSWER, generation: "2" } },
    // A broker that says it minted one without sending it has handed over
    // nothing usable, and writing the key would replace a working token.
    { name: "a mint with no token in it", body: { ...ANSWER, token: undefined } },
  ];

  it.each(refused.map((row) => [row.name, row.body] as const))(
    "refuses %s",
    async (_name, body) => {
      const { platform } = fakePlatform();
      const { fetch } = recordingFetch(() => json(200, body));
      await expect(requestMateCredential({ ...BASE, platform, fetch })).rejects.toBeInstanceOf(
        MateCredentialError,
      );
    },
  );

  it("never returns the throwaway's own value", async () => {
    const { platform } = fakePlatform();
    const { fetch } = recordingFetch(() => json(200, ANSWER));
    const answer = await requestMateCredential({ ...BASE, platform, fetch });
    expect(JSON.stringify(answer)).not.toContain(VALUE);
  });
});

describe("completeGiteaSignIn", () => {
  const BROKER = "https://broker-1234-8080.prg1.zerops.app";
  const GITEA = "https://web-1234-3000.prg1.zerops.app";

  function recording(options: { readonly failRemove?: boolean } = {}) {
    const minted: Array<string> = [];
    const removed: Array<string> = [];
    const platform: ZeropsThrowawayPlatform = {
      mint: async (input) => {
        minted.push(input.name);
        return { id: "token-1", token: "the-throwaway" };
      },
      remove: async (input) => {
        if (options.failRemove) throw new Error("could not take it back");
        removed.push(input.tokenId);
      },
    };
    return { platform, minted, removed } as const;
  }

  const call = (
    fetchFn: typeof globalThis.fetch,
    platform: ZeropsThrowawayPlatform,
    onOrphanedThrowaway?: (cause: unknown) => void,
  ) =>
    completeGiteaSignIn({
      brokerUrl: BROKER,
      giteaUrl: GITEA,
      clientId: "org-1",
      rid: "r1",
      nonce: "n1",
      platform,
      fetch: fetchFn,
      ...(onOrphanedThrowaway === undefined ? {} : { onOrphanedThrowaway }),
    });

  it("posts the request id with the throwaway as the bearer, and follows the answer", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const { platform, minted, removed } = recording();
    const answer = await call(
      (async (url, init = {}) => {
        seen.push({ url: String(url), init });
        return Response.json({ redirect: `${GITEA}/user/oauth2/zerops/callback?code=c&state=s` });
      }) as typeof globalThis.fetch,
      platform,
    );

    expect(answer.redirect).toBe(`${GITEA}/user/oauth2/zerops/callback?code=c&state=s`);
    expect(seen[0]?.url).toBe(`${BROKER}/oidc/complete`);
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ rid: "r1" });
    const headers = seen[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer the-throwaway");
    // Named for the Gitea it is for, which is the broker's fourth check.
    expect(minted).toEqual([`gitea-signin:web-1234-3000.prg1.zerops.app:n1`]);
    expect(removed).toEqual(["token-1"]);
  });

  // The deletion runs on every path: a throwaway that outlives its call is a
  // row in the account's token list that blocks removing its owner.
  for (const [name, fetchFn] of [
    [
      "the broker refused",
      (async () =>
        Response.json(
          { error: "throwaway_invalid", message: "stale" },
          { status: 403 },
        )) as typeof globalThis.fetch,
    ],
    [
      "the broker answered nothing usable",
      (async () => Response.json({})) as typeof globalThis.fetch,
    ],
    [
      "the network never answered",
      (async () => {
        throw new Error("Failed to fetch");
      }) as typeof globalThis.fetch,
    ],
  ] as const) {
    it(`takes the throwaway back when ${name}`, async () => {
      const { platform, removed } = recording();
      await call(fetchFn, platform).catch(() => undefined);
      expect(removed).toEqual(["token-1"]);
    });
  }

  it("surfaces the broker's own refusal code", async () => {
    const { platform } = recording();
    await expect(
      call(
        (async () =>
          Response.json(
            { error: "throwaway_invalid", message: "That sign-in has expired." },
            { status: 403 },
          )) as typeof globalThis.fetch,
        platform,
      ),
    ).rejects.toMatchObject({ code: "throwaway_invalid", status: 403 });
  });

  it("reports a deletion that failed without losing a sign-in over it", async () => {
    const { platform } = recording({ failRemove: true });
    const orphaned: Array<unknown> = [];
    const answer = await call(
      (async () => Response.json({ redirect: `${GITEA}/callback` })) as typeof globalThis.fetch,
      platform,
      (cause) => orphaned.push(cause),
    );

    expect(answer.redirect).toBe(`${GITEA}/callback`);
    expect(orphaned).toHaveLength(1);
  });
});
