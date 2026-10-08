/**
 * A flow's verbs are the account's operations, which the organization's HQ executes: on their way
 * from the press until HQ's records show their end, answered in HQ's words when refused, and never
 * sent twice.
 */
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Release } from "@t3tools/shared/hqRelease";

import { openAccountLifetime, closeAccountLifetime } from "./accountLifetime";
import { holdHqWrites } from "./hqWrites";
import { useFlowVerbs, VERB_ALREADY_RUNNING, type FlowVerbs } from "./flowVerbs";
import type { ZeropsProjectFlow } from "./projectFlows";

const ORG = "org";
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const DEPLOYS = { jobs: [], note: "Deploying to production." };

/** The account's store, one per test registry, as its data mount builds it. */
const account = vi.hoisted(() => ({
  stores: new WeakMap<object, unknown>(),
  storeOf: undefined as unknown as (registry: object) => {
    readonly data: unknown;
    readonly dispatch: (input: unknown) => void;
  },
}));
vi.mock("./accountOperations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./accountOperations")>();
  const { RegistryContext } = await import("@effect/atom-react");
  const { makeAccountStore } = await import("@t3tools/client-runtime/data");
  const { useContext } = await import("react");
  // The session's client is one object for the account's whole life.
  const client = {};
  account.storeOf = (registry) => {
    let store = account.stores.get(registry) as ReturnType<typeof makeAccountStore> | undefined;
    if (store === undefined) {
      store = makeAccountStore(registry as never);
      account.stores.set(registry, store);
    }
    return store as never;
  };
  return {
    ...actual,
    useAccountOperations: () => {
      const registry = useContext(RegistryContext);
      return actual.accountOperations(
        account.storeOf(registry) as never,
        registry,
        client as never,
        () => () => {},
        () => {},
        async () => false,
      );
    },
  };
});
vi.mock("./ZeropsAccountData", async () => {
  const { RegistryContext } = await import("@effect/atom-react");
  const { useContext } = await import("react");
  return {
    useAccountDataOptional: () => ({
      orgId: ORG,
      data: account.storeOf(useContext(RegistryContext)).data,
    }),
  };
});

const release = (tag: string): Release => ({
  tag,
  sha: SHA,
  entries: [{ service: "api", sha: SHA }],
  by: "ada",
  at: "2026-10-06T00:00:00Z",
  state: "approved",
  reason: null,
  rollbackOf: null,
});

/** HQ listing the application's releases, as its app-detail scope would. */
async function listed(releases: ReadonlyArray<Release>) {
  await act(async () => {
    store().dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope: `hq:${ORG}:hq-app-detail:shop`, generation: 0 }],
      reset: false,
      rows: [
        {
          family: "hqAppDetail",
          id: "shop/releases",
          revision: { kind: "hq", incarnation: "i", revision: (revision += 1) },
          value: { kind: "releases", value: releases },
        },
      ],
      removals: [],
    });
  });
}
let revision = 0;
let registryOfTest: object | undefined;
const store = () => account.storeOf(registryOfTest!);

const FLOW = {
  groupId: "shop",
  environmentInputs: [],
  repos: [{ name: "recipe", mainHead: HEAD, updatedAt: "2026-10-06T00:00:00Z" }],
  release: {
    gate: { allowed: true },
    suggestion: "v1.0.1",
    groupHead: HEAD,
    entries: [{ service: "api", commit: SHA }],
  },
} as unknown as ZeropsProjectFlow;

const hq = {
  release: vi.fn(),
  merge: vi.fn(),
};

let tree: ReactTestRenderer | undefined;
let verbs: FlowVerbs;
function Probe() {
  const shown = useFlowVerbs();
  useLayoutEffect(() => {
    verbs = shown;
  }, [shown]);
  return null;
}
let letGo: () => void = () => {};

beforeEach(async () => {
  openAccountLifetime("ada");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hq.release.mockReset();
  hq.merge.mockReset();
  letGo = holdHqWrites(ORG, {
    release: hq.release,
    mergeChange: hq.merge,
  } as never);
  const { RegistryContext } = await import("@effect/atom-react");
  const { AtomRegistry } = await import("effect/reactivity");
  const registry = AtomRegistry.make();
  registryOfTest = registry;
  await act(async () => {
    tree = create(
      <RegistryContext value={registry}>
        <Probe />
      </RegistryContext>,
    );
  });
});
afterEach(() => {
  closeAccountLifetime();
  letGo();
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("useFlowVerbs", () => {
  it("releases what the offer shows, on its way until HQ's releases list the tag it made", async () => {
    await listed([release("v1.0.0")]);
    hq.release.mockResolvedValue({ made: release("v1.0.1"), deploys: DEPLOYS });
    let outcome: unknown;
    await act(async () => {
      outcome = await verbs.release(FLOW);
    });
    expect(hq.release).toHaveBeenCalledWith("shop", {
      tag: "v1.0.1",
      groupHead: HEAD,
      entries: [{ service: "api", sha: SHA }],
    });
    expect(outcome).toEqual({ ok: true, tag: "v1.0.1", deploys: DEPLOYS });
    expect(verbs.pending.has("release shop")).toBe(true);

    // A second press while it is on its way sends nothing.
    let again: unknown;
    await act(async () => {
      again = await verbs.release(FLOW);
    });
    expect(again).toEqual({ ok: false, reason: VERB_ALREADY_RUNNING });
    expect(hq.release).toHaveBeenCalledTimes(1);

    await listed([release("v1.0.1"), release("v1.0.0")]);
    expect(verbs.pending.has("release shop")).toBe(false);
  });

  it("says HQ's refusal in its words where the verbs are, and holds nothing", async () => {
    const { HqError } = await import("@t3tools/client-runtime/zerops/hq");
    hq.release.mockRejectedValue(
      new HqError({ kind: "refused", code: "conflict", message: "That name is taken." }),
    );
    let outcome: unknown;
    await act(async () => {
      outcome = await verbs.release(FLOW, "v1.0.0");
    });
    expect(outcome).toEqual({ ok: false, reason: "That name is taken." });
    expect(verbs.trouble).toBe("That name is taken.");
    expect(verbs.pending.size).toBe(0);
  });

  it.each([
    {
      name: "a release its offer refuses",
      press: () =>
        verbs.release({
          ...FLOW,
          release: { ...FLOW.release, gate: { allowed: false, reason: "Only a developer may." } },
        }),
      reason: "Only a developer may.",
    },
    {
      name: "a merge of a head nobody was shown",
      press: () => verbs.merge("shop", { repository: "web", number: 7 }, undefined),
      reason: undefined,
    },
  ])("asks HQ nothing for $name", async ({ press, reason }) => {
    let outcome: { readonly ok: boolean; readonly reason?: string } | undefined;
    await act(async () => {
      outcome = (await press()) as typeof outcome;
    });
    expect(outcome?.ok).toBe(false);
    if (reason !== undefined) expect(outcome?.reason).toBe(reason);
    expect(hq.release).not.toHaveBeenCalled();
    expect(hq.merge).not.toHaveBeenCalled();
  });
});
