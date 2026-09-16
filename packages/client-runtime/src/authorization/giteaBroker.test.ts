import { describe, expect, it } from "vite-plus/test";

import { MateCredentialError, requestMateCredential } from "./giteaBroker.ts";
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
