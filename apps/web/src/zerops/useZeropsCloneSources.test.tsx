import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";

import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type ManagedZeropsDataRuntime,
  type ProjectCloneSourceRecipeResourceRequest,
} from "@t3tools/client-runtime/zerops/data";
import type { ExportedRecipe } from "@t3tools/client-runtime/zerops";

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
const organization = {
  kind: "organization" as const,
  account,
  organizationId: ZeropsOrganizationId.make("org-1"),
};

const recipe = (services: ReadonlyArray<string>): ExportedRecipe => ({
  servicesYaml: "services: []",
  services,
  droppedContainers: [],
  builtFromGit: [],
  scrubbedBlocks: 0,
});

/** A plain (non-Effect) deferred so this file needs no manual Effect runner. */
function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeFakeCloneBroker() {
  const released: string[] = [];
  const acquired: string[] = [];
  // Keyed by (epoch, projectId): two acquisitions for the same project under
  // different account epochs must resolve independently, never collide.
  const pending = new Map<string, (value: ExportedRecipe | undefined) => void>();
  const acquire = (request: ProjectCloneSourceRecipeResourceRequest) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const projectId = request.project.projectId;
        acquired.push(projectId);
        const { promise, resolve } = deferred<ExportedRecipe | undefined>();
        pending.set(`${request.account.epoch}:${projectId}`, resolve);
        return {
          key: projectId as never,
          request,
          snapshot: undefined as never,
          changes: undefined as never,
          awaitSettled: Effect.promise(() =>
            promise.then((value) =>
              value === undefined
                ? ({ status: "failure" } as never)
                : ({ status: "success", attempt: 1, value } as never),
            ),
          ),
          retry: undefined as never,
          release: Effect.void,
        };
      }),
      () =>
        Effect.sync(() => {
          released.push(request.project.projectId);
        }),
    );
  return {
    acquire,
    released,
    acquired,
    settle: (epoch: number, projectId: string, value: ExportedRecipe | undefined) => {
      pending.get(`${epoch}:${projectId}`)?.(value);
    },
  };
}

function contextFor(
  epoch: number,
  acquire: ReturnType<typeof makeFakeCloneBroker>["acquire"],
): ZeropsDataContextValue {
  const scope = { account, epoch: AccountEpoch.make(epoch) };
  const runtime = { scope, resources: { acquire } } as unknown as ManagedZeropsDataRuntime;
  return {
    runtime,
    organizationRef: () => organization,
    projectRef: (_organizationId, projectId) => ({
      kind: "project",
      organization,
      projectId: ZeropsProjectId.make(projectId),
    }),
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useZeropsCloneSources", () => {
  it("releases every acquired lease on unmount before its read has settled", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useZeropsCloneSources } = await import("./useZeropsCloneSources");
    const broker = makeFakeCloneBroker();
    const onResult = vi.fn();

    function Probe() {
      const result = useZeropsCloneSources("org-1", [
        { projectId: "sibling-a", name: "A", agentName: undefined },
      ]);
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(() => {
      root.render(
        <ZeropsDataContext value={contextFor(1, broker.acquire)}>
          <Probe />
        </ZeropsDataContext>,
      );
    });
    await flushEffects();
    expect(broker.acquired).toEqual(["sibling-a"]);
    expect(broker.released).toEqual([]);

    await act(() => root.unmount());
    expect(broker.released).toEqual(["sibling-a"]);
    // The read never got to settle, so it never published a stale success.
    expect(onResult.mock.calls.every(([value]) => value.sources.length === 0)).toBe(true);
  });

  it("does not publish a late answer for a set of siblings that is no longer current", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useZeropsCloneSources } = await import("./useZeropsCloneSources");
    const broker = makeFakeCloneBroker();
    const onResult = vi.fn();

    function Probe({ siblingId }: { readonly siblingId: string }) {
      const result = useZeropsCloneSources("org-1", [
        { projectId: siblingId, name: siblingId, agentName: undefined },
      ]);
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const context = contextFor(1, broker.acquire);
    await act(() => {
      root.render(
        <ZeropsDataContext value={context}>
          <Probe siblingId="sibling-a" />
        </ZeropsDataContext>,
      );
    });
    await flushEffects();

    // Move on to a different sibling set before "sibling-a" answers.
    await act(() => {
      root.render(
        <ZeropsDataContext value={context}>
          <Probe siblingId="sibling-b" />
        </ZeropsDataContext>,
      );
    });
    await flushEffects();

    // The stale read for "sibling-a" finally settles — it must not surface.
    await act(async () => {
      broker.settle(1, "sibling-a", recipe(["db"]));
      await Promise.resolve();
    });
    expect(onResult.mock.calls.every(([value]) => value.sources.length === 0)).toBe(true);

    // The current read (for "sibling-b") still answers normally.
    await act(async () => {
      broker.settle(1, "sibling-b", recipe(["web"]));
      await Promise.resolve();
    });
    expect(onResult.mock.calls.at(-1)?.[0].sources).toEqual([
      { projectId: "sibling-b", name: "sibling-b", agentName: undefined, recipe: recipe(["web"]) },
    ]);

    await act(() => root.unmount());
  });

  it("keys its answer by account epoch: a stale epoch's late answer is not published either", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useZeropsCloneSources } = await import("./useZeropsCloneSources");
    const broker = makeFakeCloneBroker();
    const onResult = vi.fn();

    function Probe() {
      const result = useZeropsCloneSources("org-1", [
        { projectId: "sibling-a", name: "A", agentName: undefined },
      ]);
      useEffect(() => onResult(result), [result]);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(() => {
      root.render(
        <ZeropsDataContext value={contextFor(1, broker.acquire)}>
          <Probe />
        </ZeropsDataContext>,
      );
    });
    await flushEffects();

    // The account epoch advances (e.g. a sign-out/sign-in) with the same
    // organization/siblings identifiers — a different key even though the
    // request shape looks the same.
    await act(() => {
      root.render(
        <ZeropsDataContext value={contextFor(2, broker.acquire)}>
          <Probe />
        </ZeropsDataContext>,
      );
    });
    await flushEffects();

    await act(async () => {
      broker.settle(1, "sibling-a", recipe(["stale-epoch"]));
      await Promise.resolve();
    });
    expect(onResult.mock.calls.every(([value]) => value.sources.length === 0)).toBe(true);

    await act(() => root.unmount());
  });
});
