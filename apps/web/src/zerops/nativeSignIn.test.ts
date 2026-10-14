import { describe, expect, it, vi } from "vite-plus/test";

import type { DesktopBridge, DesktopZeropsSignInProgress } from "@t3tools/contracts";
import { readZeropsHandover } from "@t3tools/client-runtime/zerops/handover";

import {
  readZeropsNativeSignInBridge,
  readZeropsNativeSignInProgress,
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
    adoptDeviceLogin: vi.fn(async () => undefined),
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

describe("readZeropsNativeSignInProgress", () => {
  it("is null on a desktop build that runs the hand-over only", () => {
    vi.stubGlobal("window", { desktopBridge: { zeropsSignIn: vi.fn() } });
    expect(readZeropsNativeSignInProgress()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns the progress subscription when the desktop build offers it", () => {
    const onZeropsSignInProgress = vi.fn(() => () => undefined);
    vi.stubGlobal("window", { desktopBridge: { onZeropsSignInProgress } });
    expect(readZeropsNativeSignInProgress()).toBe(onZeropsSignInProgress);
    vi.unstubAllGlobals();
  });
});

describe("runZeropsNativeSignIn: device login", () => {
  /** A progress push the test fires by hand, and whether anyone still listens. */
  function fakeProgress() {
    const listeners = new Set<(progress: DesktopZeropsSignInProgress) => void>();
    return {
      onProgress: (listener: (progress: DesktopZeropsSignInProgress) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      push: (progress: DesktopZeropsSignInProgress) =>
        listeners.forEach((listener) => listener(progress)),
      listening: () => listeners.size,
    };
  }

  it("shows the code Zerops shows, then adopts the approved session", async () => {
    const progress = fakeProgress();
    const session = { accessToken: "at-1", refreshToken: "rt-1", expiresIn: 3600 };
    const adoptDeviceLogin = vi.fn(async () => undefined);
    const adoptHandover = vi.fn(async () => undefined);
    const zeropsSignIn = fakeBridge(async () => {
      progress.push({ state: "someone-elses", userCode: "WXYZ-0000" });
      progress.push({ state: STATE, userCode: "ABCD-EFGH" });
      return { kind: "session", session };
    });
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn, adoptDeviceLogin, adoptHandover, onProgress: progress.onProgress }),
      {},
      setState,
      () => true,
      mintNonce,
    );

    expect(states).toEqual([
      { kind: "busy" },
      { kind: "busy", userCode: "ABCD-EFGH" },
      { kind: "idle" },
    ]);
    expect(adoptDeviceLogin).toHaveBeenCalledWith(session);
    expect(adoptHandover).not.toHaveBeenCalled();
    expect(progress.listening()).toBe(0);
  });

  it.each([
    {
      title: "says the sign-in was cancelled when the person denies it on Zerops",
      result: { kind: "denied" } as const,
      message: "Sign-in was cancelled.",
    },
    {
      title: "says the Zerops window timed out when nobody decided in time",
      result: { kind: "expired" } as const,
      message: "The Zerops window timed out. Start again.",
    },
    {
      title: "says what Zerops said when it refused the sign-in",
      result: { kind: "failed", message: "Unknown app." } as const,
      message: "Unknown app.",
    },
  ])("$title", async ({ result, message }) => {
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn: fakeBridge(async () => result) }),
      {},
      setState,
      () => true,
      mintNonce,
    );

    expect(states.at(-1)).toEqual({ kind: "error", message });
  });

  it("surfaces a device-login adoption failure as an error", async () => {
    const adoptDeviceLogin = vi.fn(async () => {
      throw new Error("adopt failed");
    });
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(
      fakeDeps({
        zeropsSignIn: fakeBridge(async () => ({
          kind: "session",
          session: { accessToken: "at-1" },
        })),
        adoptDeviceLogin,
      }),
      {},
      setState,
      () => true,
      mintNonce,
    );

    expect(states.at(-1)).toEqual({ kind: "error", message: "adopt failed" });
  });

  it("shows no code for a run the caller already moved on from", async () => {
    const progress = fakeProgress();
    let current = true;
    const zeropsSignIn = fakeBridge(async () => {
      current = false;
      progress.push({ state: STATE, userCode: "ABCD-EFGH" });
      return { kind: "cancelled" };
    });
    const { setState, states } = collectStates();

    await runZeropsNativeSignIn(
      fakeDeps({ zeropsSignIn, onProgress: progress.onProgress }),
      {},
      setState,
      () => current,
      mintNonce,
    );

    expect(states).toEqual([{ kind: "busy" }]);
    expect(progress.listening()).toBe(0);
  });
});

describe("runZeropsNativeSignIn", () => {
  it("goes busy, then adopts the session and returns to idle on a valid callback", async () => {
    const adoptHandover = vi.fn(async () => undefined);
    const zeropsSignIn = fakeBridge(async () => ({
      kind: "callback",
      fragment: "#token=rt-1&state=STATE&zcpClaimed=false",
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
