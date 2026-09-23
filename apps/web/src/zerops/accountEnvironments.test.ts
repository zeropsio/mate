import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { connectResult } from "./accountEnvironments";

const ENV = "env-1" as EnvironmentId;

describe("connectResult: the user's Connect as the projects page reads it", () => {
  const descriptor = {
    environmentId: ENV,
    serverVersion: "0.10.4",
    update: null,
    identity: "ok" as const,
    identityCheckedAt: null,
  };

  it.each([
    {
      name: "installed",
      outcome: { _tag: "Connected", environmentId: ENV } as const,
      result: { _tag: "Success", environmentId: ENV },
    },
    {
      name: "the role is refused: not worth trying again",
      outcome: {
        _tag: "NotConnected",
        reachability: { kind: "refused-role" },
        descriptor: null,
      } as const,
      result: {
        _tag: "Failure",
        error:
          "Could not connect to this container. You can see this project in Zerops but can't operate its Mate.",
        retryable: false,
      },
    },
    {
      name: "below the floor: the upgrade path, with the server's version",
      outcome: {
        _tag: "NotConnected",
        reachability: { kind: "update-unavailable" },
        descriptor,
      } as const,
      result: {
        _tag: "Failure",
        retryable: false,
        upgradeRequired: true,
        serverVersion: "0.10.4",
      },
    },
    {
      name: "backing off: the machine retries, and so may the page",
      outcome: {
        _tag: "NotConnected",
        reachability: {
          kind: "retrying",
          retryAtMs: Date.now() + 4_000,
          last: { kind: "server", status: 500 },
          restart: false,
        },
        descriptor: null,
      } as const,
      result: { _tag: "Failure", retryable: true },
    },
    {
      name: "the account closed",
      outcome: { _tag: "Closed" } as const,
      result: { _tag: "Failure", retryable: false },
    },
  ])("$name", ({ outcome, result }) => {
    expect(connectResult(outcome)).toMatchObject(result);
  });
});
