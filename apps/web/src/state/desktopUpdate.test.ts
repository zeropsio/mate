import type { DesktopUpdateState } from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createDesktopUpdateStateAtom, DesktopUpdateStateReadError } from "./desktopUpdate";

const baseState: DesktopUpdateState = {
  enabled: true,
  status: "idle",
  channel: "latest",
  currentVersion: "1.0.0",
  hostArch: "x64",
  appArch: "x64",
  runningUnderArm64Translation: false,
  availableVersion: null,
  downloadedVersion: null,
  releaseNotes: [],
  downloadPercent: null,
  checkedAt: null,
  message: null,
  errorContext: null,
  canRetry: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function stateReceived(
  registry: AtomRegistry.AtomRegistry,
  atom: ReturnType<typeof createDesktopUpdateStateAtom>,
  status: DesktopUpdateState["status"],
): Promise<void> {
  return new Promise((resolve) => {
    let unsubscribe = () => {};
    let matched = false;
    unsubscribe = registry.subscribe(
      atom,
      (result) => {
        if (AsyncResult.getOrElse(result, () => null)?.status === status) {
          matched = true;
          unsubscribe();
          resolve();
        }
      },
      { immediate: true },
    );
    if (matched) unsubscribe();
  });
}

describe("desktopUpdateStateAtom", () => {
  it("loads once, retains state, and follows desktop update events", async () => {
    let listener: ((state: DesktopUpdateState) => void) | undefined;
    const unsubscribe = vi.fn();
    const getUpdateState = vi.fn(async () => baseState);
    const onUpdateState = vi.fn((nextListener: (state: DesktopUpdateState) => void) => {
      listener = nextListener;
      return unsubscribe;
    });
    const atom = createDesktopUpdateStateAtom(() => ({ getUpdateState, onUpdateState }));
    const registry = AtomRegistry.make();

    const receivedInitial = stateReceived(registry, atom, "idle");
    const unmount = registry.mount(atom);
    await receivedInitial;
    expect(AsyncResult.getOrElse(registry.get(atom), () => null)).toEqual(baseState);

    const downloadedState: DesktopUpdateState = {
      ...baseState,
      status: "downloaded",
      availableVersion: "1.1.0",
      downloadedVersion: "1.1.0",
    };
    const receivedUpdate = stateReceived(registry, atom, "downloaded");
    listener?.(downloadedState);

    await receivedUpdate;
    expect(AsyncResult.getOrElse(registry.get(atom), () => null)).toEqual(downloadedState);
    unmount();

    const remount = registry.mount(atom);
    expect(AsyncResult.getOrElse(registry.get(atom), () => null)).toEqual(downloadedState);
    expect(getUpdateState).toHaveBeenCalledTimes(1);
    expect(onUpdateState).toHaveBeenCalledTimes(1);

    remount();
    registry.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not let a slower initial read overwrite a newer update event", async () => {
    let resolveInitial!: (state: DesktopUpdateState) => void;
    const initial = new Promise<DesktopUpdateState>((resolve) => {
      resolveInitial = resolve;
    });
    let markStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let listener: ((state: DesktopUpdateState) => void) | undefined;
    const atom = createDesktopUpdateStateAtom(() => ({
      getUpdateState: () => {
        markStarted();
        return initial;
      },
      onUpdateState: (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    }));
    const registry = AtomRegistry.make();
    registry.mount(atom);

    await readStarted;
    // Effect registered its Promise handler when it requested this read.
    const initialHandled = initial.then(() => undefined);
    expect(listener).toBeDefined();
    const newerState: DesktopUpdateState = { ...baseState, status: "checking" };
    const receivedUpdate = stateReceived(registry, atom, "checking");
    listener?.(newerState);
    await receivedUpdate;
    resolveInitial(baseState);
    await initialHandled;

    expect(AsyncResult.getOrElse(registry.get(atom), () => null)).toEqual(newerState);
    registry.dispose();
  });

  it("keeps listening when the initial desktop state read fails", async () => {
    let listener: ((state: DesktopUpdateState) => void) | undefined;
    const cause = new Error("IPC unavailable");
    let markReported!: () => void;
    const reported = new Promise<void>((resolve) => {
      markReported = resolve;
    });
    const reportError = vi.spyOn(console, "log").mockImplementation(markReported);
    const getUpdateState = vi.fn(async () => Promise.reject(cause));
    const atom = createDesktopUpdateStateAtom(() => ({
      getUpdateState,
      onUpdateState: (nextListener) => {
        listener = nextListener;
        return () => undefined;
      },
    }));
    const registry = AtomRegistry.make();
    registry.mount(atom);

    await reported;
    expect(listener).toBeDefined();
    expect(reportError).toHaveBeenCalledOnce();
    expect(getUpdateState).toHaveBeenCalledTimes(3);
    const [, errorMessage, errorContext] = reportError.mock.calls[0] ?? [];
    expect(errorMessage).toBe("Failed to read the initial desktop update state after 3 attempts.");
    expect(errorContext).toMatchObject({
      errorTag: "DesktopUpdateStateReadError",
      attemptCount: 3,
    });
    const loggedError = (errorContext as { readonly error: unknown }).error;
    expect(loggedError).toBeInstanceOf(DesktopUpdateStateReadError);
    expect(loggedError).toMatchObject({
      _tag: "DesktopUpdateStateReadError",
      attemptCount: 3,
    });
    expect((loggedError as DesktopUpdateStateReadError).cause).toBe(cause);

    const receivedUpdate = stateReceived(registry, atom, "idle");
    listener?.(baseState);
    await receivedUpdate;
    expect(AsyncResult.getOrElse(registry.get(atom), () => null)).toEqual(baseState);
    registry.dispose();
  });
});
