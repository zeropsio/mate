import { ConnectionBlockedError } from "../connection/model.ts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import type { ZeropsThrowawayPlatform } from "../authorization/zeropsThrowaway.ts";
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
    );

    expect(result).toEqual({
      _tag: "Failure",
      error: "Sign in to Zerops again to connect this container.",
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
    );
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/mate`);

    seenBaseUrl = null;
    await exchangeZeropsContainerIdentity(
      { throwaway: throwaway(platform), connect },
      CONTAINER_ORIGIN,
      { servedApp: { origin: CONTAINER_ORIGIN, basePath: "/preview/mate" } },
    );
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/preview/mate`);

    seenBaseUrl = null;
    await exchangeZeropsContainerIdentity(
      { throwaway: throwaway(platform), connect },
      CONTAINER_ORIGIN,
      {
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
    );

    expect(result).toEqual({ _tag: "Success", environmentId });
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
                minimumServerVersion: "0.7.0",
              }),
            ),
          ),
      },
      CONTAINER_ORIGIN,
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      upgradeRequired: true,
      serverVersion: "0.2.9",
    });
  });
});
