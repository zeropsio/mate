import { expect, it } from "@effect/vitest";
import type { ZeropsThrowawayPlatform } from "@t3tools/client-runtime/authorization";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { exchangeZeropsContainerIdentity } from "./identity-exchange";

const platform: ZeropsThrowawayPlatform = {
  mint: async () => ({ id: "token-1", token: "a-throwaway-value" }),
  remove: async () => undefined,
};

const throwaway = {
  platform,
  clientId: "an-org",
  projectId: "a-project",
  nonce: "n1",
};

it("refuses identity exchange when there is nothing to mint a throwaway with", async () => {
  let connected = false;
  const result = await exchangeZeropsContainerIdentity({
    containerOrigin: "https://zcp-demo-8080.prg1.zerops.app",
    throwaway: null,
    connect: async () => {
      connected = true;
      return AsyncResult.success("environment-1" as EnvironmentId);
    },
  });

  expect(result).toEqual({
    _tag: "Failure",
    error: "Sign in to Zerops again to connect this container.",
    retryable: false,
  });
  expect(connected).toBe(false);
});

it("registers the container through its /mate door, with a throwaway", async () => {
  let input: { readonly httpBaseUrl: string; readonly doorToken: string } | null = null;
  const result = await exchangeZeropsContainerIdentity({
    containerOrigin: "https://zcp-demo-8080.prg1.zerops.app/",
    throwaway,
    connect: async (value) => {
      input = value;
      return AsyncResult.success("environment-1" as EnvironmentId);
    },
  });

  expect(input).toEqual({
    httpBaseUrl: "https://zcp-demo-8080.prg1.zerops.app/mate",
    doorToken: "a-throwaway-value",
  });
  expect(result).toEqual({ _tag: "Success", environmentId: "environment-1" });
});
