import { ConnectionBlockedError } from "../connection/model.ts";
import { RemoteEnvironmentAuthFetchError, RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
import { ZeropsApiError } from "./api.ts";
import { mateDiagnostics } from "./diagnostics.ts";
import { exchangeZeropsContainerIdentity, type ZeropsDoorThrowaway } from "./identityExchange.ts";

const CONTAINER_ORIGIN = "https://zcp-demo-8080.prg1.zerops.app";
const CLIENT_ID = "an-org";
const PROJECT_ID = "a-project";
const MINTED = "the-throwaway-value";

interface MintCall {
  readonly clientId: string;
  readonly name: string;
}

/** Records what was minted and what was taken back, and never a value. */
function recordingPlatform(
  options: { readonly failMint?: boolean; readonly failRemove?: boolean } = {},
) {
  const minted: Array<MintCall> = [];
  const removed: Array<string> = [];
  const platform: ZeropsThrowawayPlatform = {
    mint: async (input) => {
      if (options.failMint) throw new Error("The organization refused a token.");
      minted.push(input);
      return { id: "token-1", token: MINTED };
    },
    remove: async (input) => {
      if (options.failRemove) throw new Error("The token could not be taken back.");
      removed.push(input.tokenId);
    },
  };
  return { platform, minted, removed } as const;
}

const throwaway = (platform: ZeropsThrowawayPlatform): ZeropsDoorThrowaway => ({
  platform,
  clientId: CLIENT_ID,
  projectId: PROJECT_ID,
  nonce: "a1b2c3",
});

describe("exchangeZeropsContainerIdentity", () => {
  it("refuses the exchange when there is nothing to mint a throwaway with", async () => {
    let connected = false;
    const result = await exchangeZeropsContainerIdentity(
      {
        throwaway: null,
        connect: async () => {
          connected = true;
          return AsyncResult.success("environment-1" as EnvironmentId);
        },
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    expect(result).toEqual({
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
      retryable: false,
    });
    expect(connected).toBe(false);
  });

  it("mints a token with no rights, named for this one Mate", async () => {
    const { platform, minted } = recordingPlatform();
    await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () => AsyncResult.success("environment-1" as EnvironmentId),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    expect(minted).toEqual([{ clientId: CLIENT_ID, name: `mate-door:${PROJECT_ID}:a1b2c3` }]);
  });

  it("hands the door the throwaway, never the account's own token", async () => {
    const { platform } = recordingPlatform();
    let seenToken: string | null = null;
    await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async (input) => {
          seenToken = input.doorToken;
          return AsyncResult.success("environment-1" as EnvironmentId);
        },
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    expect(seenToken).toBe(MINTED);
  });

  // The deletion runs on every path. A throwaway that outlives its call is a
  // row in the account's token list, and Zerops refuses to remove a member who
  // still holds tokens.
  for (const [name, connect] of [
    ["admitted", async () => AsyncResult.success("environment-1" as EnvironmentId)],
    [
      "refused",
      async () =>
        AsyncResult.failure(
          Cause.fail(new ConnectionBlockedError({ reason: "permission", detail: "no" })),
        ),
    ],
    [
      "the network never answered",
      async () => {
        throw new Error("Failed to fetch");
      },
    ],
  ] as const) {
    it(`takes the throwaway back after the door ${name}`, async () => {
      const { platform, removed } = recordingPlatform();
      await exchangeZeropsContainerIdentity(
        { throwaway: throwaway(platform), connect: connect as never },
        CONTAINER_ORIGIN,
        { reason: "user" },
      ).catch(() => undefined);

      expect(removed).toEqual(["token-1"]);
    });
  }

  it("reports a deletion that failed without turning a good connect into a failure", async () => {
    const { platform } = recordingPlatform({ failRemove: true });
    const orphaned: Array<unknown> = [];
    const result = await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () => AsyncResult.success("environment-1" as EnvironmentId),
        onOrphanedThrowaway: (cause) => orphaned.push(cause),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    expect(result).toMatchObject({ _tag: "Success" });
    expect(orphaned).toHaveLength(1);
  });

  it("never reaches the door when the mint itself failed", async () => {
    const { platform } = recordingPlatform({ failMint: true });
    let connected = false;
    const result = await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () => {
          connected = true;
          return AsyncResult.success("environment-1" as EnvironmentId);
        },
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    expect(connected).toBe(false);
    expect(result).toMatchObject({ _tag: "Failure" });
  });

  it("identity exchange passes the served-app origin only when given", async () => {
    const { platform } = recordingPlatform();
    let seenBaseUrl: string | null = null;
    const connect = async (input: { readonly httpBaseUrl: string; readonly doorToken: string }) => {
      seenBaseUrl = input.httpBaseUrl;
      return AsyncResult.success("environment-1" as EnvironmentId);
    };

    await exchangeZeropsContainerIdentity(
      { throwaway: throwaway(platform), connect },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/mate`);

    seenBaseUrl = null;
    await exchangeZeropsContainerIdentity(
      { throwaway: throwaway(platform), connect },
      CONTAINER_ORIGIN,
      { reason: "user", servedApp: { origin: CONTAINER_ORIGIN, basePath: "/preview/mate" } },
    );
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/preview/mate`);

    seenBaseUrl = null;
    await exchangeZeropsContainerIdentity(
      { throwaway: throwaway(platform), connect },
      CONTAINER_ORIGIN,
      {
        reason: "user",
        servedApp: { origin: "https://zcp-other-8080.prg1.zerops.app", basePath: "/preview/mate" },
      },
    );
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/mate`);
  });

  it("returns the authenticated environment", async () => {
    const { platform } = recordingPlatform();
    const environmentId = "environment-1" as EnvironmentId;
    const result = await exchangeZeropsContainerIdentity(
      { throwaway: throwaway(platform), connect: async () => AsyncResult.success(environmentId) },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    expect(result).toEqual({ _tag: "Success", environmentId });
  });

  it.each([
    ["network", false],
    ["expired-session", false],
    ["forbidden", false],
    ["uncertain", true],
  ] as const)("marks a door-mint failure of kind %s as retryable: %s", async (kind, retryable) => {
    const platform: ZeropsThrowawayPlatform = {
      mint: async () => {
        throw new ZeropsApiError("Something went wrong.", kind);
      },
      remove: async () => undefined,
    };
    const result = await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () => AsyncResult.success("e" as EnvironmentId),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );
    expect(result).toMatchObject({ _tag: "Failure", retryable });
  });

  it.each([
    [
      "the descriptor read timed out",
      new RemoteEnvironmentAuthTimeoutError("https://example/env", 10_000),
      true,
    ],
    [
      "the fetch itself never reached the network",
      new RemoteEnvironmentAuthFetchError({
        message: "Failed to fetch",
        cause: new Error("network"),
      }),
      true,
    ],
    [
      "the environment answered its own internal error",
      { _tag: "EnvironmentInternalError", reason: "unexpected" },
      true,
    ],
    [
      "the door refused on permission",
      new ConnectionBlockedError({ reason: "permission", detail: "no" }),
      false,
    ],
    [
      "the door refused as read-only",
      new ConnectionBlockedError({ reason: "read-only", detail: "no" }),
      false,
    ],
    [
      "the door refused on authentication",
      new ConnectionBlockedError({ reason: "authentication", detail: "no" }),
      false,
    ],
    [
      "the door said the server is too old",
      new ConnectionBlockedError({ reason: "unsupported", detail: "no" }),
      false,
    ],
    ["an ordinary error, with no tag at all", new Error("boom"), false],
  ] as const)("marks a door failure retryable when %s: %s", async (_case, cause, retryable) => {
    const { platform } = recordingPlatform();
    const result = await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () => AsyncResult.failure(Cause.fail(cause)),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );
    expect(result).toMatchObject({ _tag: "Failure", retryable });
  });

  it("carries a typed upgrade action instead of asking the UI to parse the message", async () => {
    const { platform } = recordingPlatform();
    const result = await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () =>
          AsyncResult.failure(
            Cause.fail(
              new ConnectionBlockedError({
                reason: "unsupported",
                detail: "Upgrade needed",
                serverVersion: "0.2.9",
                minimumServerVersion: "0.11.0",
              }),
            ),
          ),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      upgradeRequired: true,
      serverVersion: "0.2.9",
    });
  });
});

describe("the exchange's diagnostics", () => {
  it.each(["restore", "auto-connect", "repair", "user"] as const)(
    "names why the exchange was attempted: %s",
    async (reason) => {
      mateDiagnostics.enable();
      mateDiagnostics.clear();
      const { platform } = recordingPlatform();
      await exchangeZeropsContainerIdentity(
        {
          throwaway: throwaway(platform),
          connect: async () => AsyncResult.success("environment-1" as EnvironmentId),
        },
        CONTAINER_ORIGIN,
        { reason },
      );

      expect(
        mateDiagnostics
          .snapshot()
          .filter((entry) => entry.kind === "identity-exchange")
          .map((entry) => (entry.kind === "identity-exchange" ? [entry.phase, entry.reason] : [])),
      ).toEqual([
        ["start", reason],
        ["end", reason],
      ]);
    },
  );

  it("records each exchange's outcome and failure code, never the throwaway's value", async () => {
    mateDiagnostics.enable();
    mateDiagnostics.clear();
    const { platform } = recordingPlatform();
    await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () => AsyncResult.success("environment-1" as EnvironmentId),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );
    await exchangeZeropsContainerIdentity(
      {
        throwaway: throwaway(platform),
        connect: async () =>
          AsyncResult.failure(
            Cause.fail(new ConnectionBlockedError({ reason: "authentication", detail: "no" })),
          ),
      },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );
    await exchangeZeropsContainerIdentity(
      { throwaway: null, connect: async () => AsyncResult.success("e" as EnvironmentId) },
      CONTAINER_ORIGIN,
      { reason: "user" },
    );

    const ends = mateDiagnostics
      .snapshot()
      .filter((entry) => entry.kind === "identity-exchange" && entry.phase === "end")
      .map(({ t: _t, durationMs: _durationMs, ...event }) => event);
    expect(ends).toEqual([
      {
        kind: "identity-exchange",
        phase: "end",
        origin: CONTAINER_ORIGIN,
        reason: "user",
        outcome: "success",
      },
      {
        kind: "identity-exchange",
        phase: "end",
        origin: CONTAINER_ORIGIN,
        reason: "user",
        outcome: "failure",
        retryable: false,
        code: "ConnectionBlockedError:authentication",
      },
      {
        kind: "identity-exchange",
        phase: "end",
        origin: CONTAINER_ORIGIN,
        reason: "user",
        outcome: "failure",
        retryable: false,
        code: "signed-out",
      },
    ]);
    expect(JSON.stringify(mateDiagnostics.snapshot())).not.toContain(MINTED);
  });
});
