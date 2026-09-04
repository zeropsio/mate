import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { exchangeZeropsContainerIdentity } from "./identityExchange.ts";

const CONTAINER_ORIGIN = "https://zcp-demo-8080.prg1.zerops.app";

describe("exchangeZeropsContainerIdentity", () => {
  it("refuses the exchange without a current Zerops token", async () => {
    let connected = false;
    const result = await exchangeZeropsContainerIdentity(
      {
        zeropsToken: null,
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

  it("identity exchange passes the served-app origin only when given", async () => {
    let seenBaseUrl: string | null = null;
    const connect = async (input: {
      readonly httpBaseUrl: string;
      readonly zeropsToken: string;
    }) => {
      seenBaseUrl = input.httpBaseUrl;
      return AsyncResult.success("environment-1" as EnvironmentId);
    };

    await exchangeZeropsContainerIdentity({ zeropsToken: "token", connect }, CONTAINER_ORIGIN);
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/mate`);

    seenBaseUrl = null;
    await exchangeZeropsContainerIdentity({ zeropsToken: "token", connect }, CONTAINER_ORIGIN, {
      servedApp: { origin: CONTAINER_ORIGIN, basePath: "/preview/mate" },
    });
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/preview/mate`);

    seenBaseUrl = null;
    await exchangeZeropsContainerIdentity({ zeropsToken: "token", connect }, CONTAINER_ORIGIN, {
      servedApp: { origin: "https://zcp-other-8080.prg1.zerops.app", basePath: "/preview/mate" },
    });
    expect(seenBaseUrl).toBe(`${CONTAINER_ORIGIN}/mate`);
  });

  it("returns the authenticated environment", async () => {
    const environmentId = "environment-1" as EnvironmentId;
    const result = await exchangeZeropsContainerIdentity(
      { zeropsToken: "token", connect: async () => AsyncResult.success(environmentId) },
      CONTAINER_ORIGIN,
    );

    expect(result).toEqual({ _tag: "Success", environmentId });
  });
});
