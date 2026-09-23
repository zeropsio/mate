/**
 * Table-driven over `useZeropsMateUpdate`'s states, run as a plain function
 * against `reactHookHarness` (no DOM, no react-dom/client): calling the hook
 * again after each action observes the next state the same way a re-render
 * would.
 *
 * An update belongs to the Mate it was started on, so every test works in its
 * own environment — the state lives outside React, keyed by environment, and
 * two tests sharing an id would share an update.
 */
import type { ContainerVerdict } from "@t3tools/client-runtime/zerops/environments";
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
    useEffect: harness.useEffect,
    useRef: harness.useRef,
    useState: harness.useState,
    useSyncExternalStore: harness.useSyncExternalStore,
  };
});

vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (tag: symbol) => (tag === MATE_CHECK_UPDATE_TAG ? checkCommandSpy : commandSpy),
}));

vi.mock("../state/zeropsCommands", () => ({
  zeropsCommands: { mateUpdate: MATE_UPDATE_TAG, mateCheckUpdate: MATE_CHECK_UPDATE_TAG },
}));

/** The Mate's container as the container store would hold it: an intent makes it `updating`. */
const container = vi.hoisted(() => ({
  verdict: { level: "ready" } as ContainerVerdict,
  intents: [] as Array<unknown>,
  /** Whether a container takes the intent. */
  takes: true,
}));
vi.mock("./zeropsContainers", () => ({
  useEnvironmentContainer: () => ({ key: "project:service", verdict: container.verdict }),
  intendContainer: (key: string, intent: unknown) => {
    container.intents.push({ key, intent });
    if (container.takes) container.verdict = { level: "updating", overdue: false };
    return container.takes;
  },
}));

const { useZeropsMateUpdate } = await import("./useZeropsMateUpdate");

let environments = 0;
let ENVIRONMENT_ID = EnvironmentId.make("environment-0");

function render(serverVersion: string | undefined, environmentId: EnvironmentId = ENVIRONMENT_ID) {
  reactHookHarness.beginRender();
  return useZeropsMateUpdate(environmentId, serverVersion);
}

beforeEach(() => {
  reactHookHarness.reset();
  commandSpy.mockReset();
  checkCommandSpy.mockReset();
  container.verdict = { level: "ready" };
  container.intents = [];
  container.takes = true;
  environments += 1;
  ENVIRONMENT_ID = EnvironmentId.make(`environment-${environments}`);
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
    expect(hook.state).toMatchObject({ phase: "updating" });

    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "already-current" });
    // An update the RPC answers as already current creates no intent.
    expect(container.intents).toEqual([]);

    await vi.advanceTimersByTimeAsync(4_000);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });
  });

  it("action 'updated': the container shows updating until it is back, then settles to idle", async () => {
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
    expect(hook.state).toMatchObject({ phase: "updating" });
    expect(container.intents).toEqual([
      { key: "project:service", intent: { kind: "update", from: "0.8.0" } },
    ]);

    // Still updating a while later: the container decides, not a clock here.
    await vi.advanceTimersByTimeAsync(60_000);
    hook = render(version);
    expect(hook.state).toMatchObject({ phase: "updating" });

    // The container is back, on the new version.
    container.verdict = { level: "ready" };
    version = "0.8.1";
    render(version);
    hook = render(version);
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });

    await vi.advanceTimersByTimeAsync(4_000);
    hook = render(version);
    expect(hook.state).toEqual({ phase: "idle" });
  });

  it("an update past its budget says the server has not come back", async () => {
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

    container.verdict = { level: "updating", overdue: true };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state.phase).toBe("failed");
  });

  it("an update no container can follow says so", async () => {
    container.takes = false;
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

  it("the update belongs to the Mate it was started on", async () => {
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
    const other = EnvironmentId.make(`${ENVIRONMENT_ID}-other`);
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);

    // The screen that carries this control is one component reused across
    // Mates, so the other Mate renders through the same hook slots.
    expect(render("0.9.0", other).state).toEqual({ phase: "idle" });
    expect(render("0.8.0").state).toMatchObject({ phase: "updating" });
  });

  it("a check belongs to its Mate too", async () => {
    checkCommandSpy.mockResolvedValue({
      _tag: "Success",
      value: {
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      },
    });
    const other = EnvironmentId.make(`${ENVIRONMENT_ID}-other`);
    let hook = render("0.8.0");
    hook.check();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.checked).toMatchObject({ latest: "0.8.1" });
    expect(render("0.8.1", other).checked).toBeUndefined();
  });

  it("the socket dropping is the update happening, not a failure", async () => {
    // Updating restarts the server, which is exactly what closes the socket
    // the answer would have come back on. This is the shape the RPC client
    // hands over: a close code wrapped in its reason.
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("RpcClientError: SocketCloseError: 1006")),
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toMatchObject({ phase: "updating" });

    // The server comes back, on a version it did not have before. The render
    // that carries it is the one that notices; the next one is what a
    // subscriber sees.
    expect(container.intents).toHaveLength(1);
    container.verdict = { level: "ready" };
    render("0.8.1");
    hook = render("0.8.1");
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });
  });

  it("a server that never comes back does say so", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("SocketCloseError: connection reset")),
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);

    container.verdict = { level: "updating", overdue: true };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state.phase).toBe("failed");
  });

  it("a Mate that comes back late has still updated", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("SocketCloseError: connection reset")),
    });
    let hook = render("0.8.0");
    hook.request();
    hook = render("0.8.0");
    hook.confirm();
    await vi.advanceTimersByTimeAsync(0);

    container.verdict = { level: "updating", overdue: true };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state.phase).toBe("failed");

    // It was slow, not broken.
    container.verdict = { level: "ready" };
    render("0.8.1");
    hook = render("0.8.1");
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });
  });

  it("check: a closed socket is said in words, never as a close code", async () => {
    checkCommandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("RpcClientError: SocketCloseError: 1006")),
    });
    let hook = render("0.8.0");
    hook.check();
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({
      phase: "failed",
      message: "This Mate is not reachable right now.",
    });
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
