/**
 * Table-driven over `useZeropsMateUpdate`'s states, run as a plain function
 * against `reactHookHarness` (no DOM, no react-dom/client): the hook uses
 * only `useState`/`useRef`/`useCallback`, so calling it again after each
 * action observes the next state the same way a re-render would.
 */
import { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness } from "../test/reactHookHarness";

const commandSpy = vi.hoisted(() => vi.fn());
const checkCommandSpy = vi.hoisted(() => vi.fn());
const MATE_UPDATE_TAG = vi.hoisted(() => Symbol("mateUpdate"));
const MATE_CHECK_UPDATE_TAG = vi.hoisted(() => Symbol("mateCheckUpdate"));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness: harness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useCallback: harness.useCallback,
    useRef: harness.useRef,
    useState: harness.useState,
  };
});

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (tag: symbol) => (tag === MATE_CHECK_UPDATE_TAG ? checkCommandSpy : commandSpy),
}));

vi.mock("../state/zeropsCommands", () => ({
  zeropsCommands: { mateUpdate: MATE_UPDATE_TAG, mateCheckUpdate: MATE_CHECK_UPDATE_TAG },
}));

const { useZeropsMateUpdate } = await import("./useZeropsMateUpdate");

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function render(serverVersion: string | undefined) {
  reactHookHarness.beginRender();
  return useZeropsMateUpdate(ENVIRONMENT_ID, serverVersion, {
    verifyAttempts: 3,
    verifyIntervalMs: 1_000,
  });
}

beforeEach(() => {
  reactHookHarness.reset();
  commandSpy.mockReset();
  checkCommandSpy.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useZeropsMateUpdate", () => {
  it("idle → confirm → cancel → idle, without ever calling the RPC", () => {
    let hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });

    hook.request();
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "confirm" });

    hook.cancel();
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it("action 'none': already-current, then idle again on its own", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Success",
      value: {
        action: "none",
        from: "0.8.0",
        to: "0.8.0",
        restarted: false,
        serverVersion: "0.8.0",
      },
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating" });

    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "already-current" });

    await vi.advanceTimersByTimeAsync(4_000);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });
  });

  it("action 'updated': waits for serverVersion to reach 'to', then settles to idle", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Success",
      value: {
        action: "updated",
        from: "0.8.0",
        to: "0.8.1",
        restarted: true,
        serverVersion: "0.8.0",
      },
    });
    let version = "0.8.0";
    let hook = render(version);
    hook.request();
    hook = render(version);
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);
    hook = render(version);
    expect(hook.state).toEqual({ phase: "updating" });

    // Still on the old version after the first poll tick.
    await vi.advanceTimersByTimeAsync(1_000);
    hook = render(version);
    expect(hook.state).toEqual({ phase: "updating" });

    // The socket comes back on the new version.
    version = "0.8.1";
    hook = render(version);
    await vi.advanceTimersByTimeAsync(1_000);
    hook = render(version);
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });

    await vi.advanceTimersByTimeAsync(4_000);
    hook = render(version);
    expect(hook.state).toEqual({ phase: "idle" });
  });

  it("the socket never comes back: fails after the verify attempts run out", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Success",
      value: {
        action: "updated",
        from: "0.8.0",
        to: "0.8.1",
        restarted: true,
        serverVersion: "0.8.0",
      },
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(3_000);
    hook = render("0.8.0");
    expect(hook.state.phase).toBe("failed");
  });

  it("the RPC's own ZeropsMateUpdateResult.error: fails with that message, never a transport error", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Success",
      value: {
        action: "none",
        from: "0.8.0",
        to: "0.8.0",
        restarted: false,
        serverVersion: "0.8.0",
        error: "zcp mate update exited 1",
      },
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "failed", message: "zcp mate update exited 1" });
  });

  it("a transport failure (no exec:operate, zcp not found): fails with the squashed cause's message", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("exec:operate required")),
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "failed", message: "exec:operate required" });
  });

  it("check: available update — settles to idle so the verb is offered, and holds the value", async () => {
    checkCommandSpy.mockResolvedValue({
      _tag: "Success",
      value: {
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      },
    });
    let hook = render("0.8.0");
    hook.check();
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "checking" });

    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });
    expect(hook.checked).toEqual({
      installed: "0.8.0",
      latest: "0.8.1",
      available: true,
      checkedAt: "2026-09-09T00:00:00Z",
    });
  });

  it("check: nothing new — already-current, then idle again on its own", async () => {
    checkCommandSpy.mockResolvedValue({ _tag: "Success", value: null });
    let hook = render("0.8.0");
    hook.check();
    hook = render("0.8.0");
    hook.check();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "already-current" });
    expect(hook.checked).toBeNull();

    await vi.advanceTimersByTimeAsync(4_000);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });
  });

  it("check: a transport failure fails with the squashed cause's message", async () => {
    checkCommandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("read scope required")),
    });
    let hook = render("0.8.0");
    hook.check();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "failed", message: "read scope required" });
  });
});
