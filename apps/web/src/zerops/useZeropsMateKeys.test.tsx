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
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";

import { FakeCells } from "./__fixtures__/cells";
import { integrationTokensFromGrantMetadata, useZeropsMateKeys } from "./useZeropsMateKeys";
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

// A Mate's key as the platform minted it: ADMIN on its own project and nothing else — one write
// lowers it to BASIC_USER (guide 0.2), and none gives it anything beside (ADR 0003).
const NARROW_GRANTS: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
  {
    tokenId: "token-a",
    name: "zcp-a",
    grants: [{ projectId: "project-a", roleCode: "ADMIN" }],
  },
];
/** The account's one Mate, in project-a; project-b is another project of its application. */
const MATES: ReadonlyArray<string> = ["project-a"];

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

function contextFor(
  broker: GrantsBroker,
  setIntegrationTokenProjects: (input: unknown) => void,
  options: {
    /** What a live read answers; by default what the test published last in the shared cell. */
    readonly platform?: () => ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>;
    /** The platform refuses every project list write. */
    readonly refuseWrites?: boolean;
  } = {},
) {
  const runtime = {
    scope,
    cells: { known: broker.known },
    commands: {
      listIntegrationTokenGrants: () =>
        Effect.sync(() => ({
          attempt: {} as never,
          value:
            options.platform?.() ?? (broker.current.state === "known" ? broker.current.value : []),
        })),
      setIntegrationTokenProjects: (input: unknown) => {
        setIntegrationTokenProjects(input);
        return options.refuseWrites === true
          ? Effect.fail({ _tag: "ZeropsDataAdapterError", kind: "rejected", message: "refused" })
          : Effect.succeed({ attempt: {} as never, value: undefined });
      },
      // A birth's one restart, and its delegation drop, both run in the
      // press's close-off (`ZeropsApiClient.hardenMate`, `matePress.ts`)
      // — gated on a READ proof and before anyone is admitted, never from a
      // background reconcile a person may already be inside. If this hook
      // ever called any of these again, the command would throw and fail
      // the test.
      isolateProjectEnv: () => {
        throw new Error("useZeropsMateKeys must never restart a project");
      },
      listTokenDelegations: () => {
        throw new Error("useZeropsMateKeys must never read a token's delegations");
      },
      deleteTokenDelegation: () => {
        throw new Error("useZeropsMateKeys must never delete a token's delegations");
      },
    },
  } as unknown as ManagedZeropsDataRuntime;
  return {
    runtime,
    signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
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

describe("useZeropsMateKeys", () => {
  /** Renders the reconcile for `MATES` over `context`, and answers its root. */
  async function mounted(context: ZeropsDataContextValue) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    function Probe() {
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
    return root;
  }

  it("plans from the live list, not the shared one: nothing to write for a key already lowered", async () => {
    const broker = new FakeCells<TokensCellRequest>();
    const writes: unknown[] = [];
    // The shared list is older: on the platform, the key is already lowered.
    const reached: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
      {
        tokenId: "token-a",
        name: "zcp-a",
        grants: [
          { projectId: "project-a", roleCode: "BASIC_USER" },
          { projectId: "project-b", roleCode: "READ_ONLY" },
        ],
      },
    ];
    const root = await mounted(
      contextFor(broker, (input) => writes.push(input), { platform: () => reached }),
    );
    try {
      await act(async () => {
        await broker.publish(knownGrants(NARROW_GRANTS, 1));
      });
      await flushEffects();
      expect(writes).toEqual([]);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("backs off a write the platform keeps refusing: 30 s, then 2 min, never on every re-read", async () => {
    vi.useFakeTimers();
    const broker = new FakeCells<TokensCellRequest>();
    const writes: unknown[] = [];
    const root = await mounted(
      contextFor(broker, (input) => writes.push(input), { refuseWrites: true }),
    );
    // Each refused write makes the shared list read again: the same grants, a new read.
    let ordinal = 0;
    const reread = async () => {
      await act(async () => {
        await broker.publish(
          knownGrants(
            NARROW_GRANTS.map((grant) => ({ ...grant })),
            ++ordinal,
          ),
        );
      });
      await flushEffects();
    };
    try {
      await reread();
      expect(writes).toHaveLength(1);
      await reread();
      await reread();
      expect(writes).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await flushEffects();
      expect(writes).toHaveLength(2);
      await reread();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(119_000);
      });
      await flushEffects();
      expect(writes).toHaveLength(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await flushEffects();
      expect(writes).toHaveLength(3);
    } finally {
      await act(() => root.unmount());
      vi.useRealTimers();
    }
  });

  it("issues exactly one PUT for a key the platform minted with ADMIN, and none once it is lowered", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));

    function Probe() {
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
        await broker.publish(knownGrants(NARROW_GRANTS, 1));
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

  it("plans from retained grants only once a read confirms them", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
    // A remount inside the retention window shows the retained grants while they are read again.
    broker.current = {
      state: "known",
      value: NARROW_GRANTS,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "revalidating", sinceMs: 0 },
    };
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));

    function Probe() {
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
      expect(writes).toEqual([]);

      await act(async () => {
        await broker.publish(knownGrants(NARROW_GRANTS, 2));
      });
      await flushEffects();
      expect(writes).toHaveLength(1);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("never reads or drops a token's delegations — the birth owns that now", async () => {
    // The one-time mint (guide 0.4) is dropped once, at birth
    // (`ZeropsApiClient.hardenMate`, the press's close-off),
    // never re-read from a background reconcile. `contextFor`'s
    // `listTokenDelegations`/`deleteTokenDelegation` throw if this hook ever
    // calls either, so this test's pass is itself the assertion.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
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
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
        await broker.publish(knownGrants(settled, 1));
      });
      await flushEffects();
    } finally {
      await act(() => root.unmount());
    }
  });

  it("a key that appears is lowered, though the Mates did not change", async () => {
    // Live measurement 2026-09-22: a Mate came up hardened through
    // `hardenMate`, but its token had not existed yet the last time this
    // hook's key was built, so `lastKey` (group shape alone) never changed
    // and the reconcile never re-ran for it.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));

    function Probe() {
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
        await broker.publish(knownGrants([], 1));
      });
      await flushEffects();
      expect(writes).toEqual([]);

      // The key now exists, freshly minted with ADMIN — the Mates (`MATES`) have not changed
      // at all.
      await act(async () => {
        await broker.publish(knownGrants(NARROW_GRANTS, 2));
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

  it("the reconcile never restarts a project", async () => {
    // The birth's one restart runs before anyone is admitted
    // (the press's close-off, spec-mate §3 B-1/B-2/B-3); a
    // background reconcile that runs on every read of the projects screen,
    // possibly with the person already inside a conversation, must not carry
    // it along. `contextFor`'s `isolateProjectEnv` throws if this hook ever
    // calls it, so this test's pass is itself the assertion.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
    const context = contextFor(broker, () => {});

    function Probe() {
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
        await broker.publish(knownGrants(NARROW_GRANTS, 1));
      });
      await flushEffects();
    } finally {
      await act(() => root.unmount());
    }
  });

  // ADR 0003: a grant a key already holds on another project is neither widened nor taken away
  // here; a separate step removes it.
  it("lowers a key and leaves a sibling grant it already holds, adding none", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
    const writes: unknown[] = [];
    const context = contextFor(broker, (input) => writes.push(input));
    const withSibling: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
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
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
        await broker.publish(knownGrants(withSibling, 1));
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

  it("does not write for a key already lowered, whatever else it holds", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
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
      useZeropsMateKeys({ clientId: "org-1", mateProjectIds: MATES, enabled: true });
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
        await broker.publish(knownGrants(alreadyWide, 1));
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
    const broker = new FakeCells<TokensCellRequest>();
    const writes: Array<{ readonly tokenId: string }> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = {
      scope,
      cells: { known: broker.known },
      commands: {
        listIntegrationTokenGrants: () =>
          Effect.sync(() => ({
            attempt: {} as never,
            value: broker.current.state === "known" ? broker.current.value : [],
          })),
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
      signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
      organizationRef: () => organization,
      projectRef: () => {
        throw new Error("not used");
      },
    };

    // Two Mates, each with its own key, so the reconcile plans two sequential writes: "token-a"
    // first, "token-c" second.
    const grants: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
      ...NARROW_GRANTS,
      {
        tokenId: "token-c",
        name: "zcp-c",
        grants: [{ projectId: "project-c", roleCode: "ADMIN" }],
      },
    ];

    function Probe() {
      useZeropsMateKeys({
        clientId: "org-1",
        mateProjectIds: ["project-a", "project-c"],
        enabled: true,
      });
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
      await broker.publish(knownGrants(grants, 1));
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

  it("plans again after a read of the same tokens cut its run short", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const broker = new FakeCells<TokensCellRequest>();
    const writes: Array<{
      readonly tokenId: string;
      readonly projects: ZeropsIntegrationTokenGrantMetadata["grants"];
    }> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtime = {
      scope,
      cells: { known: broker.known },
      commands: {
        // The platform: what the test published, with every write that landed applied.
        listIntegrationTokenGrants: () =>
          Effect.sync(() => ({
            attempt: {} as never,
            value: (broker.current.state === "known" ? broker.current.value : []).map((token) => {
              const landed = writes.findLast((write) => write.tokenId === token.tokenId);
              return landed === undefined ? token : { ...token, grants: landed.projects };
            }),
          })),
        setIntegrationTokenProjects: (input: {
          readonly tokenId: string;
          readonly projects: ZeropsIntegrationTokenGrantMetadata["grants"];
        }) =>
          Effect.promise(async () => {
            if (input.tokenId === "token-a" && writes.length === 0) await firstGate;
            writes.push(input);
            return { attempt: {} as never, value: undefined };
          }),
      },
    } as unknown as ManagedZeropsDataRuntime;
    const context: ZeropsDataContextValue = {
      runtime,
      signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
      organizationRef: () => organization,
      projectRef: () => {
        throw new Error("not used");
      },
    };

    // Two Mates, each with its own key, so the reconcile plans two sequential writes: "token-a"
    // first, "token-c" second.
    const grants: ReadonlyArray<ZeropsIntegrationTokenGrantMetadata> = [
      ...NARROW_GRANTS,
      {
        tokenId: "token-c",
        name: "zcp-c",
        grants: [{ projectId: "project-c", roleCode: "ADMIN" }],
      },
    ];

    function Probe() {
      useZeropsMateKeys({
        clientId: "org-1",
        mateProjectIds: ["project-a", "project-c"],
        enabled: true,
      });
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
      await broker.publish(knownGrants(grants, 1));
    });
    await flushEffects();
    // The first write ("token-a") is in flight, blocked on `firstGate`.
    expect(writes).toEqual([]);

    // The shared list is read again and says the same: the run in flight is cut short.
    await act(async () => {
      await broker.publish(
        knownGrants(
          grants.map((grant) => ({ ...grant })),
          2,
        ),
      );
    });
    await flushEffects();
    await act(async () => {
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flushEffects();
    // The lowering still owed is planned again: token-c is written too.
    expect(writes.map(({ tokenId }) => tokenId)).toContain("token-c");
    await act(() => root.unmount());
  });
});
