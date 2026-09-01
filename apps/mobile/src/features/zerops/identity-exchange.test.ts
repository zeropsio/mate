import { expect, it } from "@effect/vitest";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { exchangeZeropsContainerIdentity } from "./identity-exchange";

it("refuses identity exchange without a current Zerops token", async () => {
  let connected = false;
  const result = await exchangeZeropsContainerIdentity({
    containerOrigin: "https://zcp-demo-8080.prg1.zerops.app",
    zeropsToken: null,
    connect: async () => {
      connected = true;
      return AsyncResult.success("environment-1" as EnvironmentId);
    },
  });

  expect(result).toEqual({
    _tag: "Failure",
    error: "Sign in to Zerops again to connect this container.",
  });
  expect(connected).toBe(false);
});

it("registers the container through its /z3 identity door", async () => {
  let input: { readonly httpBaseUrl: string; readonly zeropsToken: string } | null = null;
  const result = await exchangeZeropsContainerIdentity({
    containerOrigin: "https://zcp-demo-8080.prg1.zerops.app/",
    zeropsToken: "zerops-token",
    connect: async (value) => {
      input = value;
      return AsyncResult.success("environment-1" as EnvironmentId);
    },
  });

  expect(input).toEqual({
    httpBaseUrl: "https://zcp-demo-8080.prg1.zerops.app/z3",
    zeropsToken: "zerops-token",
  });
  expect(result).toEqual({ _tag: "Success", environmentId: "environment-1" });
});
