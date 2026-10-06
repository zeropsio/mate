/**
 * *Add stage* and *Add production* through HQ (SPEC §3.2b, main D14): the project attached to its
 * application as its stage or production — HQ records the environment with it, and its
 * navigation says so — then, where HQ holds no key that works, the environment's deploy key minted
 * by the person's client and handed to HQ. Each step reports rather than throws.
 */
import { describe, expect, it } from "vite-plus/test";

import type { AccountOperations } from "./accountOperations";
import { addGroupEnvironment } from "./addGroupEnvironment";

const HQ = { projectId: "hq-project", address: "https://hq.test" };

/** The account's operations as a test stands them in: each write recorded, each answered. */
function operationsOf(options: {
  readonly recorded?: { readonly name: string; readonly keyed: boolean } | Error;
  readonly refuse?: Readonly<Record<string, string>>;
}) {
  const ran: Array<unknown> = [];
  const operations: Pick<AccountOperations, "run" | "untilEnvironment"> = {
    run: (async (intent: { readonly kind: string }) => {
      ran.push(intent);
      const refusal = options.refuse?.[intent.kind];
      if (refusal !== undefined) throw new Error(refusal);
      return undefined;
    }) as AccountOperations["run"],
    untilEnvironment: async (orgId, appId, projectId) => {
      ran.push(`environment ${orgId} ${appId} ${projectId}`);
      const recorded = options.recorded ?? { name: "acme-stage", keyed: false };
      if (recorded instanceof Error) throw recorded;
      return recorded;
    },
  };
  return { operations, ran };
}

const add = (operations: Pick<AccountOperations, "run" | "untilEnvironment">) =>
  addGroupEnvironment({
    operations,
    orgId: "org-1",
    hq: HQ,
    groupId: "g-1",
    environment: { tier: "stage", project: "p-stage" },
  });

describe("addGroupEnvironment", () => {
  it("attaches the project as its tier, then keeps the key under the name HQ gave it", async () => {
    const { operations, ran } = operationsOf({});
    expect(await add(operations)).toEqual({
      done: ["registry", "deploy-token"],
      failed: undefined,
    });
    expect(ran).toEqual([
      // Made for HQ to deploy: its services get their subdomain on their first deploy (audit R1).
      {
        kind: "attach-project",
        orgId: "org-1",
        hq: HQ,
        appId: "g-1",
        attach: { projectId: "p-stage", kind: "stage", created: true },
      },
      "environment org-1 g-1 p-stage",
      {
        kind: "keep-deploy-key",
        orgId: "org-1",
        hq: HQ,
        appId: "g-1",
        projectId: "p-stage",
        environmentName: "acme-stage",
      },
    ]);
  });

  it("keeps no key for an environment whose key HQ holds and finds working", async () => {
    const { operations, ran } = operationsOf({ recorded: { name: "acme-stage", keyed: true } });
    expect(await add(operations)).toEqual({
      done: ["registry", "deploy-token"],
      failed: undefined,
    });
    expect(ran).toHaveLength(2);
  });

  it("stops at the registry with HQ's refusal, keeping no key", async () => {
    const { operations, ran } = operationsOf({
      refuse: { "attach-project": "You need Admin access to this Zerops project." },
    });
    expect(await add(operations)).toEqual({
      done: [],
      failed: { step: "registry", reason: "You need Admin access to this Zerops project." },
    });
    expect(ran).toHaveLength(1);
  });

  it("stops at the key where HQ's navigation cannot say what it recorded", async () => {
    const { operations } = operationsOf({ recorded: new Error("HQ isn't answering.") });
    expect(await add(operations)).toEqual({
      done: ["registry"],
      failed: { step: "deploy-token", reason: "HQ isn't answering." },
    });
  });

  it("stops at the key with what stopped its keeping", async () => {
    const { operations } = operationsOf({
      refuse: { "keep-deploy-key": "Zerops did not accept this deploy key." },
    });
    expect(await add(operations)).toEqual({
      done: ["registry"],
      failed: { step: "deploy-token", reason: "Zerops did not accept this deploy key." },
    });
  });
});
