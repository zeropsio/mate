import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
import { ZeropsApiError, type ZeropsApiClient } from "./api.ts";
import { mateDiagnostics } from "./diagnostics.ts";
import {
  connectThroughThrowaway,
  planThrowawaySweep,
  THROWAWAY_SWEEP_AGE_MS,
  zeropsThrowawayPlatform,
} from "./doorThrowaway.ts";

const NOW = Date.parse("2026-09-16T10:00:00.000Z");
const at = (msAgo: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - msAgo));

describe("planThrowawaySweep", () => {
  // Only ours, only stale. Everything else on the account's token list is
  // somebody's working credential.
  for (const [name, token, swept] of [
    [
      "a door throwaway older than five minutes",
      { id: "a", name: "mate-door:p1:n", created: at(THROWAWAY_SWEEP_AGE_MS + 1_000) },
      true,
    ],
    [
      "a Gitea sign-in throwaway older than five minutes",
      { id: "b", name: "gitea-signin:git.example.com:n", created: at(600_000) },
      true,
    ],
    [
      "a throwaway another tab may still be mid-flight with",
      { id: "c", name: "mate-door:p1:n", created: at(30_000) },
      false,
    ],
    [
      "a Mate's own key, whatever its age",
      { id: "d", name: "zcp-acme", created: at(90 * 24 * 60 * 60 * 1000) },
      false,
    ],
    [
      "something merely named like one",
      { id: "e", name: "mate-doorstop", created: at(600_000) },
      false,
    ],
    ["a token with no name at all", { id: "f", created: at(600_000) }, false],
    // A token nobody can date is a token nobody can call stale.
    [
      "a throwaway whose created stamp does not parse",
      { id: "g", name: "mate-door:p1:n", created: "recently" },
      false,
    ],
    ["a throwaway with no created stamp", { id: "h", name: "mate-door:p1:n" }, false],
  ] as const) {
    it(`${swept ? "sweeps" : "leaves"} ${name}`, () => {
      expect(planThrowawaySweep({ tokens: [token], nowEpochMs: NOW })).toEqual(
        swept ? [token.id] : [],
      );
    });
  }

  it("sweeps every stale throwaway in one pass", () => {
    const stale = planThrowawaySweep({
      tokens: [
        { id: "a", name: "mate-door:p1:n", created: at(600_000) },
        { id: "b", name: "zcp-acme", created: at(600_000) },
        { id: "c", name: "gitea-signin:git.example.com:n", created: at(600_000) },
      ],
      nowEpochMs: NOW,
    });
    expect(stale).toEqual(["a", "c"]);
  });
});

describe("connectThroughThrowaway", () => {
  const platform = (calls: Array<string>): ZeropsThrowawayPlatform => ({
    mint: async (input) => {
      calls.push(`mint ${input.name}`);
      return { id: "token-1", token: "a-value" };
    },
    remove: async (input) => {
      calls.push(`remove ${input.tokenId}`);
    },
  });

  it("mints, connects and deletes, in that order", async () => {
    const calls: Array<string> = [];
    const answer = await connectThroughThrowaway({
      platform: platform(calls),
      clientId: "org",
      projectId: "p1",
      nonce: "n1",
      connect: async (token) => {
        calls.push("connect");
        return token;
      },
    });

    expect(answer).toBe("a-value");
    expect(calls).toEqual(["mint mate-door:p1:n1", "connect", "remove token-1"]);
  });

  it("deletes even when the connect threw, and re-throws what threw", async () => {
    const calls: Array<string> = [];
    await expect(
      connectThroughThrowaway({
        platform: platform(calls),
        clientId: "org",
        projectId: "p1",
        nonce: "n1",
        connect: async () => {
          throw new Error("the network went away");
        },
      }),
    ).rejects.toThrow("the network went away");

    expect(calls).toEqual(["mint mate-door:p1:n1", "remove token-1"]);
  });
});

describe("zeropsThrowawayPlatform's diagnostics", () => {
  it("tells door and Gitea mints apart and pairs each delete with its mint", async () => {
    const client = {
      mintIntegrationToken: async (input: { readonly name: string }) =>
        input.name.startsWith("gitea-signin:")
          ? { id: "gitea-token", token: "a-value" }
          : { id: "door-token", token: "a-value" },
      deleteIntegrationToken: async (input: { readonly tokenId: string }) => {
        if (input.tokenId === "gitea-token") throw new ZeropsApiError("gone", "not-found", 404);
      },
    } as unknown as ZeropsApiClient;
    const throwaways = zeropsThrowawayPlatform(client);
    mateDiagnostics.enable();
    mateDiagnostics.clear();

    const door = await throwaways.mint({ clientId: "org", name: "mate-door:p1:n1" });
    await throwaways.remove({ clientId: "org", tokenId: door.id });
    const gitea = await throwaways.mint({ clientId: "org", name: "gitea-signin:git.example:n2" });
    await expect(throwaways.remove({ clientId: "org", tokenId: gitea.id })).rejects.toThrow("gone");

    expect(mateDiagnostics.snapshot().map(({ t: _t, ...event }) => event)).toEqual([
      {
        kind: "throwaway",
        action: "mint",
        purpose: "door",
        clientId: "org",
        outcome: "ok",
        tokenId: "door-token",
      },
      {
        kind: "throwaway",
        action: "delete",
        clientId: "org",
        tokenId: "door-token",
        outcome: "ok",
      },
      {
        kind: "throwaway",
        action: "mint",
        purpose: "gitea",
        clientId: "org",
        outcome: "ok",
        tokenId: "gitea-token",
      },
      {
        kind: "throwaway",
        action: "delete",
        clientId: "org",
        tokenId: "gitea-token",
        outcome: "failed",
        code: "ZeropsApiError:not-found",
        status: 404,
      },
    ]);
    expect(JSON.stringify(mateDiagnostics.snapshot())).not.toContain("a-value");
  });
});
