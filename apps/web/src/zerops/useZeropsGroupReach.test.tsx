import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";

import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  type ManagedZeropsDataRuntime,
  type OrganizationIntegrationTokenGrantsResourceRequest,
  type ZeropsIntegrationTokenGrantMetadata,
} from "@t3tools/client-runtime/zerops/data";
import type { ZeropsGroupReachGroup } from "@t3tools/client-runtime/zerops";

import { FakeResourceBroker } from "./__fixtures__/resourceBroker";
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

type GrantsBroker = FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>;

function contextFor(broker: GrantsBroker, setIntegrationTokenProjects: (input: unknown) => void) {
  const runtime = {
    scope,
    resources: { acquire: broker.acquire },
    commands: {
      setIntegrationTokenProjects: (input: unknown) => {
        setIntegrationTokenProjects(input);
        return Effect.succeed({ attempt: {} as never, value: undefined });
      },
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
  return {
    runtime,
    organizationRef: () => organization,
    projectRef: (_organizationId: string, projectId: string) =>
      ({ kind: "project", organization, projectId }) as never,
  } satisfies ZeropsDataContextValue;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
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
});

describe("useZeropsGroupReach", () => {
  it("issues exactly one PUT for a group whose token does not yet reach it, and none once it does", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [GROUP], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();

      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: NARROW_GRANTS });
      });
      await flushEffects();

      expect(writes).toEqual([
        {
          organization,
          tokenId: "token-a",
          name: "zcp-a",
          projects: [
            { projectId: "project-a", roleCode: "BASIC_USER" },
            { projectId: "project-b", roleCode: "READ_ONLY" },
          ],
        },
      ]);

      // Same key, same underlying grants object: no repeat write.
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();
      expect(writes).toHaveLength(1);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("never reads or drops a token's delegations — the birth owns that now", async () => {
    // The one-time mint (guide 0.4) is dropped once, at birth
    // (`ZeropsApiClient.hardenMate`, `provisioning.ts`'s `hardening` phase),
    // never re-read from a background reconcile. `contextFor`'s
    // `listTokenDelegations`/`deleteTokenDelegation` throw if this hook ever
    // calls either, so this test's pass is itself the assertion.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const context = contextFor(broker, () => {});
    const settled: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
      {
        tokenId: "token-a",
        name: "zcp-a",
        grants: [
          { projectId: "project-a", roleCode: "BASIC_USER" },
          { projectId: "project-b", roleCode: "READ_ONLY" },
        ],
      },
    ];

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [GROUP], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();

      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: settled });
      });
      await flushEffects();
    } finally {
      await act(() => root.unmount());
    }
  });

  it("a reach re-runs when a token appears, even though the group shape did not move", async () => {
    // Live measurement 2026-09-22: a Mate came up hardened through
    // `hardenMate`, but its token had not existed yet the last time this
    // hook's key was built, so `lastKey` (group shape alone) never changed
    // and the reconcile never re-ran for it.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [GROUP], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();

      // No token for this Mate yet — nothing to plan.
      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: [] });
      });
      await flushEffects();
      expect(writes).toEqual([]);

      // The token now exists, freshly minted with ADMIN — the group's shape
      // (`GROUP`) has not changed at all.
      await act(async () => {
        await broker.publish({ status: "success", attempt: 2, value: NARROW_GRANTS });
      });
      await flushEffects();

      expect(writes).toEqual([
        {
          organization,
          tokenId: "token-a",
          name: "zcp-a",
          projects: [
            { projectId: "project-a", roleCode: "BASIC_USER" },
            { projectId: "project-b", roleCode: "READ_ONLY" },
          ],
        },
      ]);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("a reach reconcile never restarts a project", async () => {
    // The birth's one restart runs before anyone is admitted
    // (`provisioning.ts`'s `hardening` phase, spec-mate §3 B-1/B-2/B-3); a
    // background reconcile that runs on every read of the projects screen,
    // possibly with the person already inside a conversation, must not carry
    // it along. `contextFor`'s `isolateProjectEnv` throws if this hook ever
    // calls it, so this test's pass is itself the assertion.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const context = contextFor(broker, () => {});

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [GROUP], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();

      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: NARROW_GRANTS });
      });
      await flushEffects();
    } finally {
      await act(() => root.unmount());
    }
  });

  it("lowers a solo Mate, which has no sibling to reach but a token to secure", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));
    const solo: ZeropsGroupReachGroup = {
      projectIds: ["project-a"],
      mateProjectIds: ["project-a"],
    };

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [solo], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();

      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: NARROW_GRANTS });
      });
      await flushEffects();

      expect(writes).toEqual([
        {
          organization,
          tokenId: "token-a",
          name: "zcp-a",
          projects: [{ projectId: "project-a", roleCode: "BASIC_USER" }],
        },
      ]);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("does not write when the token already reaches exactly its group", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));
    const alreadyWide: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
      {
        tokenId: "token-a",
        name: "zcp-a",
        grants: [
          { projectId: "project-a", roleCode: "BASIC_USER" },
          { projectId: "project-b", roleCode: "READ_ONLY" },
        ],
      },
    ];

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [GROUP], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(() => {
        root.render(
          <ZeropsDataContext value={context}>
            <Probe />
          </ZeropsDataContext>,
        );
      });
      await flushEffects();
      await act(async () => {
        await broker.publish({ status: "success", attempt: 1, value: alreadyWide });
      });
      await flushEffects();

      expect(writes).toHaveLength(0);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("cancels the remaining planned writes when unmounted mid-loop", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeResourceBroker<OrganizationIntegrationTokenGrantsResourceRequest>();
    const writes: Array<{ readonly tokenId: string }> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = {
      scope,
      resources: { acquire: broker.acquire },
      commands: {
        setIntegrationTokenProjects: (input: { readonly tokenId: string }) =>
          Effect.promise(async () => {
            if (input.tokenId === "token-a") await firstGate;
            writes.push(input);
            return { attempt: {} as never, value: undefined };
          }),
      },
    } as unknown as ManagedZeropsDataRuntime;
    const context: ZeropsDataContextValue = {
      runtime,
      organizationRef: () => organization,
      projectRef: () => {
        throw new Error("not used");
      },
    };

    // Two groups, each with its own Mate token, so the reconcile plans two
    // sequential writes: "token-a" first, "token-c" second.
    const groupA: ZeropsGroupReachGroup = {
      projectIds: ["project-a", "project-b"],
      mateProjectIds: ["project-a"],
    };
    const groupC: ZeropsGroupReachGroup = {
      projectIds: ["project-c", "project-d"],
      mateProjectIds: ["project-c"],
    };
    const grants: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
      ...NARROW_GRANTS,
      {
        tokenId: "token-c",
        name: "zcp-c",
        grants: [{ projectId: "project-c", roleCode: "ADMIN" }],
      },
    ];

    function Probe() {
      useZeropsGroupReach({ clientId: "org-1", groups: [groupA, groupC], enabled: true });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(() => {
      root.render(
        <ZeropsDataContext value={context}>
          <Probe />
        </ZeropsDataContext>,
      );
    });
    await flushEffects();
    await act(async () => {
      await broker.publish({ status: "success", attempt: 1, value: grants });
    });
    await flushEffects();
    // The first write ("token-a") is in flight, blocked on `firstGate`.
    expect(writes).toEqual([]);

    await act(() => root.unmount());
    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });
    // The in-flight first write may still complete server-side, but the loop
    // must not go on to issue the second write for an unmounted consumer.
    expect(writes.map(({ tokenId }) => tokenId)).toEqual(["token-a"]);
  });
});
