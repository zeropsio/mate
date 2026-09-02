import { describe, expect, it, vi } from "vite-plus/test";

import type { DesktopBridge } from "@t3tools/contracts";
import { readZeropsHandover } from "@t3tools/client-runtime/zerops/handover";

import {
  readZeropsNativeSignInBridge,
  runZeropsNativeSignIn,
  type ZeropsNativeSignInDeps,
  type ZeropsNativeSignInState,
} from "./nativeSignIn";

type ZeropsSignIn = NonNullable<DesktopBridge["zeropsSignIn"]>;

function fakeBridge(impl: ZeropsSignIn): ZeropsSignIn {
  return vi.fn(impl);
}

// Pure (no sessionStorage involved) — checks a fragment against the nonce
// this test's `mintNonce` stub handed out, exactly like the real
// `completeZeropsHandover` does once it has read its stored nonce.
const STATE = "STATE";
const mintNonce = () => STATE;

function fakeDeps(overrides: Partial<ZeropsNativeSignInDeps> = {}): ZeropsNativeSignInDeps {
  return {
    zeropsSignIn: fakeBridge(async () => ({ kind: "cancelled" })),
    adoptHandover: vi.fn(async () => undefined),
    completeHandover: ({ fragment }) => readZeropsHandover(fragment, STATE),
    ...overrides,
  } satisfies ZeropsNativeSignInDeps;
}

function collectStates(): {
  readonly setState: (state: ZeropsNativeSignInState) => void;
  readonly states: ZeropsNativeSignInState[];
} {
  const states: ZeropsNativeSignInState[] = [];
  return { setState: (state) => states.push(state), states };
}

describe("readZeropsNativeSignInBridge", () => {
  it("is null with no window (this app never runs server-side, but its tests do)", () => {
    expect(readZeropsNativeSignInBridge()).toBeNull();
  });

  it("is null in a browser without the desktop bridge", () => {
    vi.stubGlobal("window", {});
    expect(readZeropsNativeSignInBridge()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("is null on a desktop build old enough to lack the method", () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    expect(readZeropsNativeSignInBridge()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns the bridge method when the desktop build offers it", () => {
    const zeropsSignIn = fakeBridge(async () => ({ kind: "cancelled" }));
    vi.stubGlobal("window", { desktopBridge: { zeropsSignIn } });
    expect(readZeropsNativeSignInBridge()).toBe(zeropsSignIn);
    vi.unstubAllGlobals();
  });
});

describe("runZeropsNativeSignIn", () => {
  it("goes busy, then adopts the session and returns to idle on a valid callback", async () => {
    const adoptHandover = vi.fn(async () => undefined);
    const zeropsSignIn = fakeBridge(async () => ({
      kind: "callback",
      fragment: "#token=rt-1&state=STATE&clientId=org-1&zcpClaimed=false",
    }));
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn, adoptHandover }),
      {},
      setState,
      () => true,
      mintNonce,
    );

    expect(states[0]).toEqual({ kind: "busy" });
    expect(states.at(-1)).toEqual({ kind: "idle" });
    expect(adoptHandover).toHaveBeenCalledWith({
      token: "rt-1",
      clientId: "org-1",
      zcpClaimed: false,
    });
  });

  it("passes the register intent through to the bridge", async () => {
    const zeropsSignIn = fakeBridge(async () => ({ kind: "cancelled" }));
    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn }),
      { intent: "register" },
      () => undefined,
      () => true,
      mintNonce,
    );

    expect(zeropsSignIn).toHaveBeenCalledWith({ state: "STATE", intent: "register" });
  });

  it("returns to idle without an error when the browser half is cancelled", async () => {
    const { setState, states } = collectStates();
    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn: fakeBridge(async () => ({ kind: "cancelled" })) }),
      {},
      setState,
      () => true,
      mintNonce,
    );

    expect(states).toEqual([{ kind: "busy" }, { kind: "idle" }]);
  });

  it("reports a mismatched callback as an error naming the window", async () => {
    const zeropsSignIn = fakeBridge(async () => ({
      kind: "callback",
      fragment: "#token=attacker&state=someone-elses-nonce",
    }));
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(fakeDeps({ zeropsSignIn }), {}, setState, () => true, mintNonce);

    expect(states.at(-1)).toEqual({
      kind: "error",
      message: "That sign-in did not come from this window. Start again from Zerops Mate.",
    });
  });

  it("reports a declined callback as a cancellation message", async () => {
    const zeropsSignIn = fakeBridge(async () => ({
      kind: "callback",
      fragment: "#error=access_denied&state=STATE",
    }));
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(fakeDeps({ zeropsSignIn }), {}, setState, () => true, mintNonce);

    expect(states.at(-1)).toEqual({ kind: "error", message: "Sign-in was cancelled." });
  });

  it("reports any other declined callback as a generic failure", async () => {
    const zeropsSignIn = fakeBridge(async () => ({
      kind: "callback",
      fragment: "#error=server_error&state=STATE",
    }));
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(fakeDeps({ zeropsSignIn }), {}, setState, () => true, mintNonce);

    expect(states.at(-1)).toEqual({
      kind: "error",
      message: "Zerops could not complete that sign-in.",
    });
  });

  it("treats a callback carrying no hand-over as a plain cancellation", async () => {
    const zeropsSignIn = fakeBridge(async () => ({ kind: "callback", fragment: "" }));
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(fakeDeps({ zeropsSignIn }), {}, setState, () => true, mintNonce);

    expect(states.at(-1)).toEqual({ kind: "idle" });
  });

  it("surfaces a bridge rejection as an error", async () => {
    const zeropsSignIn = fakeBridge(async () => {
      throw new Error("loopback listener failed");
    });
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(fakeDeps({ zeropsSignIn }), {}, setState, () => true, mintNonce);

    expect(states.at(-1)).toEqual({ kind: "error", message: "loopback listener failed" });
  });

  it("surfaces an adoption failure as an error", async () => {
    const zeropsSignIn = fakeBridge(async () => ({
      kind: "callback",
      fragment: "#token=rt-1&state=STATE",
    }));
    const adoptHandover = vi.fn(async () => {
      throw new Error("adopt failed");
    });
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn, adoptHandover }),
      {},
      setState,
      () => true,
      mintNonce,
    );

    expect(states.at(-1)).toEqual({ kind: "error", message: "adopt failed" });
  });

  // The Cancel button abandons a run still in flight on the main-process
  // side: the bridge promise is still pending there, but this run must stop
  // touching UI state once the caller has moved on.
  it("stops updating state once the caller reports the run is no longer current", async () => {
    let resolveSignIn: ((result: { kind: "cancelled" }) => void) | undefined;
    const zeropsSignIn = fakeBridge(
      () =>
        new Promise((resolve) => {
          resolveSignIn = resolve;
        }),
    );
    const { setState, states } = collectStates();
    let current = true;

    const run = runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn }),
      {},
      setState,
      () => current,
      mintNonce,
    );

    current = false;
    resolveSignIn?.({ kind: "cancelled" });
    await run;

    expect(states).toEqual([{ kind: "busy" }]);
  });
});
