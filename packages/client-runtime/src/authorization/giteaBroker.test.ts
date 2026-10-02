import { describe, expect, it } from "vite-plus/test";

import { acquireGiteaPersonToken, MateCredentialError } from "./giteaBroker.ts";
import type { ZeropsThrowawayPlatform } from "./zeropsThrowaway.ts";

describe("acquireGiteaPersonToken", () => {
  const BROKER = "https://broker-1234-8080.prg1.zerops.app";
  const GITEA = "https://web-1234-3000.prg1.zerops.app";

  function recording() {
    const minted: Array<string> = [];
    const removed: Array<string> = [];
    const platform: ZeropsThrowawayPlatform = {
      mint: async (input) => {
        minted.push(input.name);
        return { id: "token-1", token: "the-throwaway" };
      },
      remove: async (input) => {
        removed.push(input.tokenId);
      },
    };
    return { platform, minted, removed } as const;
  }

  const call = (fetchFn: typeof globalThis.fetch, platform: ZeropsThrowawayPlatform) =>
    acquireGiteaPersonToken({
      brokerUrl: `${BROKER}/`,
      giteaUrl: GITEA,
      clientId: "org-1",
      nonce: "n1",
      platform,
      fetch: fetchFn,
    });

  it("asks the broker with the throwaway as the bearer, and keeps what it answers", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const { platform, minted, removed } = recording();
    const answer = await call(
      (async (url, init = {}) => {
        seen.push({ url: String(url), init });
        return Response.json({ token: "gitea-token", login: "u-abc", expiresIn: 43200 });
      }) as typeof globalThis.fetch,
      platform,
    );

    expect(answer).toEqual({ token: "gitea-token", login: "u-abc", expiresInMs: 43_200_000 });
    expect(seen[0]?.url).toBe(`${BROKER}/person/token`);
    expect(seen[0]?.init.method).toBe("POST");
    const headers = seen[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bearer the-throwaway");
    // Named for the Gitea it is for — the broker's fourth check — and taken back.
    expect(minted).toEqual([`gitea-signin:web-1234-3000.prg1.zerops.app:n1`]);
    expect(removed).toEqual(["token-1"]);
  });

  it("carries the broker's refusal by code and status, and still takes the throwaway back", async () => {
    const { platform, removed } = recording();
    const failure = await call(
      (async () =>
        Response.json(
          { error: "not_a_member", message: "not an active member" },
          { status: 403 },
        )) as typeof globalThis.fetch,
      platform,
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(MateCredentialError);
    expect((failure as MateCredentialError).code).toBe("not_a_member");
    expect((failure as MateCredentialError).status).toBe(403);
    expect(removed).toEqual(["token-1"]);
  });

  it("refuses an answer with no token in it rather than keeping nothing", async () => {
    const { platform } = recording();
    await expect(
      call((async () => Response.json({ login: "u-abc" })) as typeof globalThis.fetch, platform),
    ).rejects.toBeInstanceOf(MateCredentialError);
  });
});
