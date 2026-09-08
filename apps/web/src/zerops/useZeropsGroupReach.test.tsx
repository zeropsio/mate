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

// A Mate token that reaches only its own project — a group of two calls for
// one write (ADMIN on itself, READ_ONLY on the sibling).
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
    },
  } as unknown as ManagedZeropsDataRuntime;
  return {
    runtime,
    organizationRef: () => organization,
    projectRef: () => {
      throw new Error("not used");
    },
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
            { projectId: "project-a", roleCode: "ADMIN" },
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
          { projectId: "project-a", roleCode: "ADMIN" },
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
