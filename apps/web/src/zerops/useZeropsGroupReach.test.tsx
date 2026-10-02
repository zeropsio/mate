import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";

import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type ManagedZeropsDataRuntime,
  type TokensCellRequest,
  type ZeropsIntegrationTokenGrantMetadata,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsGroupReachGroup } from "@t3tools/client-runtime/zerops";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import { FakeCells } from "./__fixtures__/cells";
import { integrationTokensFromGrantMetadata, useZeropsGroupReach } from "./useZeropsGroupReach";
import { ZeropsDataContext, type ZeropsDataContextValue } from "./zeropsDataContext";

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

const account = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account-1"),
};
const scope = { account, epoch: AccountEpoch.make(1) };
const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};

// A Mate token as the platform minted it: ADMIN on its own project and
// nothing else — a group of two calls for one write that both lowers it to
// BASIC_USER (guide 0.2) and gives it READ_ONLY on the sibling.
const NARROW_GRANTS: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
  {
    tokenId: "token-a",
    name: "zcp-a",
    grants: [{ projectId: "project-a", roleCode: "ADMIN" }],
  },
];
const GROUP: ZeropsGroupReachGroup = {
  projectIds: ["project-a", "project-b"],
  mateProjectIds: ["project-a"],
};

/** The grants as the read with `ordinal` settled them. */
const knownGrants = (
  value: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>,
  ordinal: number,
): Shown<ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>> => ({
  state: "known",
  value,
  asOf: { ordinal, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "settled" },
});

type GrantsBroker = FakeCells<TokensCellRequest>;

interface Written {
  readonly tokenId: string;
  readonly projects: ZeropsIntegrationTokenGrantMetadata["grants"];
}

/** What the reach owes `GROUP` over `NARROW_GRANTS`: its own project lowered, its sibling read. */
const REACHING_GRANTS: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
  {
    tokenId: "token-a",
    name: "zcp-a",
    grants: [
      { projectId: "project-a", roleCode: "BASIC_USER" },
      { projectId: "project-b", roleCode: "READ_ONLY" },
    ],
  },
];

function contextFor(
  broker: GrantsBroker,
  options: {
    /** Holds each write until it resolves; by default a write answers at once. */
    readonly gate?: (input: Written) => Promise<void>;
  } = {},
) {
  const writes: Array<Written> = [];
  const runtime = {
    scope,
    cells: { known: broker.known },
    commands: {
      // The account's one command lane is for writes: a token list read through it queued
      // behind every write in the tab and filled the lane (measured live 2026-10-02).
      listIntegrationTokenGrants: () => {
        throw new Error("useZeropsGroupReach must never read the token list through a command");
      },
      setIntegrationTokenProjects: (input: Written) =>
        Effect.promise(async () => {
          writes.push(input);
          await options.gate?.(input);
          return { attempt: {} as never, value: undefined };
        }),
      // A birth's one restart, and its delegation drop, both run in
      // `provisioning.ts`'s `hardening` phase (`ZeropsApiClient.hardenMate`)
      // — gated on a READ proof and before anyone is admitted, never from a
      // background reconcile a person may already be inside. If this hook
      // ever called any of these again, the command would throw and fail
      // the test.
      isolateProjectEnv: () => {
        throw new Error("useZeropsGroupReach must never restart a project");
      },
      listTokenDelegations: () => {
        throw new Error("useZeropsGroupReach must never read a token's delegations");
      },
      deleteTokenDelegation: () => {
        throw new Error("useZeropsGroupReach must never delete a token's delegations");
      },
    },
  } as unknown as ManagedZeropsDataRuntime;
  const context = {
    runtime,
    signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
    organizationRef: () => organization,
    projectRef: (_organizationId: string, projectId: string) =>
      ({ kind: "project", organization, projectId }) as never,
  } satisfies ZeropsDataContextValue;
  return { context, writes };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("integrationTokensFromGrantMetadata", () => {
  it("restores the planner input from credential-free grant metadata", () => {
    expect(integrationTokensFromGrantMetadata(NARROW_GRANTS)).toEqual([
      { id: "token-a", name: "zcp-a", projects: [{ projectId: "project-a", roleCode: "ADMIN" }] },
    ]);
  });

  it("keeps the token's own org role and its minting time", () => {
    expect(
      integrationTokensFromGrantMetadata([
        {
          tokenId: "token-b",
          name: "broker",
          grants: [],
          roleCode: "READ_ONLY",
          created: "2026-10-01T09:00:00Z",
        },
      ]),
    ).toEqual([
      {
        id: "token-b",
        name: "broker",
        projects: [],
        roleCode: "READ_ONLY",
        created: "2026-10-01T09:00:00Z",
      },
    ]);
  });
});

describe("useZeropsGroupReach", () => {
  /**
   * Renders the reconcile over `context`; every render hands it new arrays of the same groups,
   * as the projects screen does on every inventory push and every minute's tick.
   */
  async function mounted(
    context: ZeropsDataContextValue,
    groups: () => ReadonlyArray<ZeropsGroupReachGroup> = () => [structuredClone(GROUP)],
    enabled = true,
  ) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: groups(), enabled });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = async () => {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();
    };
    await render();
    return { render, unmount: () => act(() => root.unmount()) };
  }

  const publish = async (broker: GrantsBroker, shown: Parameters<GrantsBroker["publish"]>[0]) => {
    await act(async () => {
      await broker.publish(shown);
    });
    await flushEffects();
  };

  it("writes what a group owes once, reading the shared list and never a command", async () => {
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker);
    const view = await mounted(context);
    try {
      await publish(broker, knownGrants(NARROW_GRANTS, 1));
      expect(writes).toEqual([
        { organization, tokenId: "token-a", name: "zcp-a", projects: REACHING_GRANTS[0]!.grants },
      ]);

      // Re-renders with new arrays, our own write's refresh of the list still showing the old
      // grants, then showing the new ones: none of it plans a write.
      for (let tick = 0; tick < 10; tick += 1) await view.render();
      await publish(broker, knownGrants(structuredClone(NARROW_GRANTS), 2));
      await publish(broker, knownGrants(REACHING_GRANTS, 3));
      for (let tick = 0; tick < 10; tick += 1) await view.render();
      expect(writes).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  it("holds one demand on the shared list across re-renders", async () => {
    const broker = new FakeCells<TokensCellRequest>();
    const { context } = contextFor(broker);
    const view = await mounted(context);
    try {
      await publish(broker, knownGrants(REACHING_GRANTS, 1));
      for (let tick = 0; tick < 10; tick += 1) await view.render();
      expect(broker.acquisitions).toBe(1);
    } finally {
      await view.unmount();
    }
  });

  it("does not write again what this tab wrote when the screen is opened again", async () => {
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker);
    const first = await mounted(context);
    await publish(broker, knownGrants(NARROW_GRANTS, 1));
    await first.unmount();
    expect(writes).toHaveLength(1);

    // Back on the projects screen before the list was read again: it still shows the old grants.
    const again = await mounted(context);
    try {
      expect(writes).toHaveLength(1);
    } finally {
      await again.unmount();
    }
  });

  it("plans nothing while the group listing is not a complete read", async () => {
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker);
    const view = await mounted(context, undefined, false);
    try {
      await publish(broker, knownGrants(NARROW_GRANTS, 1));
      expect(writes).toEqual([]);
    } finally {
      await view.unmount();
    }
  });

  it("plans from retained grants only once a read confirms them", async () => {
    const broker = new FakeCells<TokensCellRequest>();
    // A remount inside the retention window shows the retained grants while they are read again.
    broker.current = {
      state: "known",
      value: NARROW_GRANTS,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "revalidating", sinceMs: 0 },
    };
    const { context, writes } = contextFor(broker);
    const view = await mounted(context);
    try {
      expect(writes).toEqual([]);
      await publish(broker, knownGrants(NARROW_GRANTS, 2));
      expect(writes).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  it("plans again when a token appears, even though the group shape did not move", async () => {
    // Live measurement 2026-09-22: a Mate came up hardened before its token was
    // listed; a plan keyed on the group shape alone never ran for it.
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker);
    const view = await mounted(context);
    try {
      await publish(broker, knownGrants([], 1));
      expect(writes).toEqual([]);
      await publish(broker, knownGrants(NARROW_GRANTS, 2));
      expect(writes.map(({ tokenId }) => tokenId)).toEqual(["token-a"]);
    } finally {
      await view.unmount();
    }
  });

  it("never restarts a project, nor reads or drops a token's delegations", async () => {
    // The birth owns both (`provisioning.ts`'s `hardening` phase, spec-mate §3
    // B-1/B-2/B-3, guide 0.4). `contextFor`'s commands throw if this hook ever
    // calls one, so the write landing is the assertion.
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker);
    const view = await mounted(context);
    try {
      await publish(broker, knownGrants(NARROW_GRANTS, 1));
      expect(writes).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  });

  it.each<{
    readonly name: string;
    readonly groups: ReadonlyArray<ZeropsGroupReachGroup>;
    readonly grants: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>;
    readonly written: ReadonlyArray<Written["projects"]>;
  }>([
    {
      name: "lowers a solo Mate, which has no sibling to reach but a token to secure",
      groups: [{ projectIds: ["project-a"], mateProjectIds: ["project-a"] }],
      grants: NARROW_GRANTS,
      written: [[{ projectId: "project-a", roleCode: "BASIC_USER" }]],
    },
    {
      name: "does not write a token that already reaches exactly its group",
      groups: [GROUP],
      grants: REACHING_GRANTS,
      written: [],
    },
  ])("$name", async ({ groups, grants, written }) => {
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker);
    const view = await mounted(context, () => structuredClone(groups));
    try {
      await publish(broker, knownGrants(grants, 1));
      expect(writes.map(({ projects }) => projects)).toEqual(written);
    } finally {
      await view.unmount();
    }
  });

  it("writes nothing more once unmounted mid-run", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const broker = new FakeCells<TokensCellRequest>();
    const { context, writes } = contextFor(broker, {
      gate: (input) => (input.tokenId === "token-a" ? firstGate : Promise.resolve()),
    });
    // Two groups, each with its own Mate token: two writes, "token-a" first.
    const groups: ReadonlyArray<ZeropsGroupReachGroup> = [
      GROUP,
      { projectIds: ["project-c", "project-d"], mateProjectIds: ["project-c"] },
    ];
    const view = await mounted(context, () => structuredClone(groups));
    await publish(
      broker,
      knownGrants(
        [
          ...NARROW_GRANTS,
          {
            tokenId: "token-c",
            name: "zcp-c",
            grants: [{ projectId: "project-c", roleCode: "ADMIN" }],
          },
        ],
        1,
      ),
    );
    expect(writes.map(({ tokenId }) => tokenId)).toEqual(["token-a"]);

    await view.unmount();
    releaseFirst();
    await flushEffects();
    expect(writes.map(({ tokenId }) => tokenId)).toEqual(["token-a"]);
  });
});
