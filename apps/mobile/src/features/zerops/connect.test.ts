import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { ConnectOutcome } from "@t3tools/client-runtime/zerops/environments";

import { connectMate } from "./connect";

const KEY = "project-a:service-a";
const ENVIRONMENT_ID = EnvironmentId.make("environment-a");

/** The account's environments, answering every Connect with `outcome`. */
const answering = (outcome: ConnectOutcome) => {
  const asked: Array<readonly [string, string]> = [];
  const environments: Pick<AccountEnvironments, "connect"> = {
    connect: async (key, reason) => {
      asked.push([key, reason]);
      return outcome;
    },
  };
  return { environments, asked };
};

describe("connectMate", () => {
  it("Connect runs driver.connect", async () => {
    const { environments, asked } = answering({
      _tag: "Connected",
      environmentId: ENVIRONMENT_ID,
    });

    expect(await connectMate(environments, KEY)).toEqual({
      _tag: "Connected",
      environmentId: ENVIRONMENT_ID,
    });
    // The person's tap is the exchange driver's Connect on the row's target: a user retry.
    expect(asked).toEqual([[KEY, "user"]]);
  });

  it.each<{ readonly name: string; readonly outcome: ConnectOutcome; readonly error: string }>([
    {
      name: "the Mate's verdict, in the reachability copy",
      outcome: {
        _tag: "NotConnected",
        reachability: { kind: "refused-role" },
        descriptor: null,
      },
      error:
        "Could not connect to this container. You can see this project in Zerops but can't operate its Mate.",
    },
    {
      name: "the account closing under it",
      outcome: { _tag: "Closed" },
      error: "This account session has ended.",
    },
  ])("a Connect that did not connect says why: $name", async ({ outcome, error }) => {
    const { environments } = answering(outcome);

    expect(await connectMate(environments, KEY)).toEqual({ _tag: "Failed", error });
  });
});
