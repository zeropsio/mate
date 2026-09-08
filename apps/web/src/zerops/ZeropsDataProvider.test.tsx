import { act, Children, isValidElement, StrictMode, useContext, useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime } from "./accountLifetime";
import { makeFakeRuntimeFactory } from "./__fixtures__/dataRuntimeFactory";
import { ZeropsDataContext } from "./zeropsDataContext";
import { ZeropsDataProvider, ZeropsDataStartupFailure } from "./ZeropsDataProvider";

const session = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSession: () => session.current }));
vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: () => null,
}));

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

  createTextNode(_text: string) {
    return new TestNode("#text", this, 3);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  removeAttribute() {}
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

function sessionFor(userId: string) {
  return {
    client: { baseUrl: "https://api.example.test" },
    signOut: vi.fn(async () => undefined),
    status: "signed-in" as const,
    user: { id: userId },
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ZeropsDataStartupFailure", () => {
  it("offers finite recovery when account runtime creation fails", () => {
    const retry = vi.fn();
    const signOut = vi.fn();
    const failure = ZeropsDataStartupFailure({ message: "runtime unavailable", retry, signOut });
    const buttons = Children.toArray(failure.props.children).filter(
      (child) => isValidElement<{ readonly onClick: () => void }>(child) && child.type === "button",
    );

    expect(failure.props.role).toBe("alert");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      if (isValidElement<{ readonly onClick: () => void }>(button)) button.props.onClick();
    }
    expect(retry).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("ZeropsDataProvider ownership (M8)", () => {
  it("creates exactly one runtime for a signed-in account and provides it to consumers", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { factory, handles } = makeFakeRuntimeFactory();
    session.current = sessionFor("account-1");
    let seenAccountId: string | undefined;
    function Consumer() {
      const value = useContext(ZeropsDataContext);
      useEffect(() => {
        seenAccountId = value?.runtime.scope.account.accountId;
      });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <ZeropsDataProvider makeRuntime={factory}>
            <Consumer />
          </ZeropsDataProvider>,
        );
      });
      await flushEffects();
      expect(handles).toHaveLength(1);
      expect(handles[0]?.scope.account.accountId).toBe("account-1");
      expect(seenAccountId).toBe("account-1");
    } finally {
      await act(() => root.unmount());
      closeAccountLifetime();
    }
  });

  it("shuts down the runtime for `logout` when the account lifetime closes", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { factory, handles } = makeFakeRuntimeFactory();
    session.current = sessionFor("account-1");
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => {
        root.render(<ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>);
      });
      await flushEffects();
      expect(handles).toHaveLength(1);

      await act(async () => {
        closeAccountLifetime();
        await Promise.resolve();
      });
      expect(handles[0]?.shutdownReasons).toEqual(["logout"]);
    } finally {
      await act(() => root.unmount());
    }
  });

  it("shuts down the previous runtime as `account-replaced` when the signed-in account changes", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { factory, handles } = makeFakeRuntimeFactory();
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      session.current = sessionFor("account-1");
      await act(async () => {
        root.render(<ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>);
      });
      await flushEffects();
      expect(handles).toHaveLength(1);

      session.current = sessionFor("account-2");
      await act(async () => {
        root.render(<ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>);
      });
      await flushEffects();

      expect(handles).toHaveLength(2);
      expect(handles[0]?.shutdownReasons).toEqual(["account-replaced"]);
      expect(handles[1]?.scope.account.accountId).toBe("account-2");
      expect(handles[1]?.shutdownReasons).toEqual([]);
    } finally {
      await act(() => root.unmount());
      closeAccountLifetime();
    }
  });

  it("recovers from a startup failure: a fresh attempt gets its own runtime, and the failed one is never shut down", async () => {
    // `ZeropsDataStartupFailure`'s retry/sign-out button wiring is unit-tested
    // above directly on the returned element (this harness's fake DOM has no
    // real event dispatch to click through). What the ownership contract
    // must additionally hold: a rejected attempt never became `current`, so
    // there is nothing to shut down for it, and the next attempt (whether
    // triggered by the retry button bumping `startupAttempt`, or — as here —
    // a fresh mount) gets its own independent runtime.
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { factory, handles } = makeFakeRuntimeFactory({ resolveMode: "manual" });
    session.current = sessionFor("account-1");
    const firstRoot = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      firstRoot.render(<ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>);
    });
    await flushEffects();
    expect(handles).toHaveLength(1);

    await act(async () => {
      handles[0]?.reject?.(new Error("network unreachable"));
      await Promise.resolve();
    });
    await act(() => firstRoot.unmount());
    // A failed attempt never held a runtime, so unmounting it triggers no shutdown.
    expect(handles[0]?.shutdownReasons).toEqual([]);

    const secondRoot = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => {
        secondRoot.render(<ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>);
        handles[1]?.resolve?.();
        await Promise.resolve();
      });
      expect(handles).toHaveLength(2);
      expect(handles[1]?.scope.account.accountId).toBe("account-1");
      expect(handles[1]?.shutdownReasons).toEqual([]);
    } finally {
      await act(() => secondRoot.unmount());
      closeAccountLifetime();
    }
  });

  it("aborts a startup that never settles once the provider unmounts (H4)", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { factory, handles } = makeFakeRuntimeFactory({ resolveMode: "manual" });
    session.current = sessionFor("account-1");
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(<ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>);
    });
    await flushEffects();
    expect(handles).toHaveLength(1);
    expect(handles[0]?.signal.aborted).toBe(false);

    await act(() => root.unmount());
    expect(handles[0]?.signal.aborted).toBe(true);
    closeAccountLifetime();
  });

  it("under StrictMode double mount, shuts down the first attempt once it resolves after cancellation", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { factory, handles } = makeFakeRuntimeFactory({ resolveMode: "manual" });
    session.current = sessionFor("account-1");
    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <ZeropsDataProvider makeRuntime={factory}>{null}</ZeropsDataProvider>
          </StrictMode>,
        );
      });
      await flushEffects();
      // StrictMode's mount→cleanup→mount runs the effect twice; the first
      // attempt's cleanup fires before either settles.
      expect(handles).toHaveLength(2);
      expect(handles[0]?.signal.aborted).toBe(true);
      expect(handles[1]?.signal.aborted).toBe(false);

      // The first attempt's factory ignores the abort and resolves anyway —
      // the ownership contract still shuts it down instead of leaking it.
      await act(async () => {
        handles[0]?.resolve?.();
        await Promise.resolve();
      });
      expect(handles[0]?.shutdownReasons).toEqual(["account-replaced"]);

      await act(async () => {
        handles[1]?.resolve?.();
        await Promise.resolve();
      });
      expect(handles[1]?.shutdownReasons).toEqual([]);
    } finally {
      await act(() => root.unmount());
      closeAccountLifetime();
    }
  });
});
