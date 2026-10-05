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

const { useZeropsMateUpdate, useZeropsMateUpdateStates } = await import("./useZeropsMateUpdate");

let environments = 0;
let ENVIRONMENT_ID = EnvironmentId.make("environment-0");

/** The server's descriptor as the socket holds it: its version and its boot. */
type Descriptor = { readonly serverVersion: string; readonly bootId?: string };
let boot = 1;

/** The server process starts again: every descriptor from now on names another boot. */
const restart = () => {
  boot += 1;
};

/**
 * Renders against the server on `version`, in the boot it runs now — a new descriptor object at
 * every render, as a remount reads one; `null` while the socket holds none.
 */
function render(
  version: string | Descriptor | null,
  environmentId: EnvironmentId = ENVIRONMENT_ID,
) {
  reactHookHarness.beginRender();
  const descriptor =
    typeof version === "string" ? { serverVersion: version, bootId: `boot-${boot}` } : version;
  return useZeropsMateUpdate(environmentId, descriptor);
}

beforeEach(() => {
  reactHookHarness.reset();
  commandSpy.mockReset();
  checkCommandSpy.mockReset();
  container.verdict = { level: "ready" };
  container.intents = [];
  container.takes = true;
  boot = 1;
  environments += 1;
  ENVIRONMENT_ID = EnvironmentId.make(`environment-${environments}`);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useZeropsMateUpdate", () => {
  it("update starts at once — the person was asked in the app's dialog before the call", () => {
    commandSpy.mockReturnValue(new Promise(() => {}));
    let hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "idle" });

    hook.update("0.8.1");
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating", to: "0.8.1" });
    expect(commandSpy).toHaveBeenCalledTimes(1);

    // A second press while it runs is not a second update.
    hook.update("0.8.1");
    expect(commandSpy).toHaveBeenCalledTimes(1);
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
    hook.update("0.8.1");
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
    hook.update("0.8.1");
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

  // A clock is no answer: a slow install is still an install, and a second Update mid-install
  // would start another.
  it("an update past its budget is taking longer, never failed, and Update stays off", async () => {
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
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);

    container.verdict = { level: "updating", overdue: true };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating", to: "0.8.1", overdue: true });

    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);
    expect(commandSpy).toHaveBeenCalledTimes(1);
  });

  it("an update no container follows waits for another version, taking longer past its budget", async () => {
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
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating", to: "0.8.1" });

    // Past the update's budget with the version unchanged, it is taking longer — never failed.
    await vi.advanceTimersByTimeAsync(120_000);
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating", to: "0.8.1", overdue: true });

    // Coming back later on the new version, it has still updated.
    render("0.8.1");
    hook = render("0.8.1");
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });
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
    hook.update("0.8.1");
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
    hook.update("0.8.1");
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
    hook.update("0.8.1");
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
    hook.update("0.8.1");
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

  it("a server that never comes back reads as taking longer, the update still its", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("SocketCloseError: connection reset")),
    });
    let hook = render("0.8.0");
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);

    container.verdict = { level: "updating", overdue: true };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating", to: "0.8.1", overdue: true });

    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);
    expect(commandSpy).toHaveBeenCalledTimes(1);
  });

  it("a Mate that comes back late has still updated", async () => {
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("SocketCloseError: connection reset")),
    });
    let hook = render("0.8.0");
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);

    container.verdict = { level: "updating", overdue: true };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state).toEqual({ phase: "updating", to: "0.8.1", overdue: true });

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
  it("check resolves with the server's answer, so the caller can offer what it found", async () => {
    const answer = {
      installed: "0.8.0",
      latest: "0.8.1",
      available: true,
      checkedAt: "2026-09-09T00:00:00Z",
    };
    checkCommandSpy.mockResolvedValue({ _tag: "Success", value: answer });
    await expect(render("0.8.0").check()).resolves.toEqual(answer);
  });

  it("check resolves to nothing when it failed, so nothing is offered off it", async () => {
    checkCommandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("read scope required")),
    });
    await expect(render("0.8.0").check()).resolves.toBeUndefined();
  });

  const ACCEPTED = {
    _tag: "Success",
    value: {
      action: "updated",
      from: "0.8.0",
      to: "0.8.1",
      restarted: true,
      serverVersion: "0.8.0",
    },
  } as const;

  // The server it comes back as is the answer: on another boot of the version it left, the update
  // did not take.
  it.each([
    { name: "no container follows it", takes: false },
    { name: "its container follows it", takes: true },
  ])(
    "a server restarted on the version it left says the update did not take, and offers Update again ($name)",
    async ({ takes }) => {
      container.takes = takes;
      commandSpy.mockResolvedValue(ACCEPTED);
      let hook = render("0.8.0");
      hook.update("0.8.1");
      await vi.advanceTimersByTimeAsync(0);

      container.verdict = { level: "ready" };
      restart();
      render("0.8.0");
      hook = render("0.8.0");
      expect(hook.state).toEqual({
        phase: "failed",
        message: "The update did not take: this Mate is still on 0.8.0.",
      });

      hook.update("0.8.1");
      expect(commandSpy).toHaveBeenCalledTimes(2);
    },
  );

  // Its container says it is back, but the descriptor is still the boot the update was pressed
  // in: that server has not restarted yet, so it never reads as updated to the version it left.
  it("a container back while the descriptor is still the old boot stays updating", async () => {
    commandSpy.mockResolvedValue(ACCEPTED);
    let hook = render("0.8.0");
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);

    container.verdict = { level: "ready" };
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state).toMatchObject({ phase: "updating", to: "0.8.1" });

    restart();
    render("0.8.1");
    hook = render("0.8.1");
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });
  });

  // A socket that only blinked under the call comes back to the server it left, not restarted:
  // the update is still on its way, never "did not take".
  it("a socket that blinked under the call and came back to the same boot is still updating", async () => {
    container.takes = false;
    commandSpy.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.die(new Error("RpcClientError: SocketCloseError: 1006")),
    });
    let hook = render("0.8.0");
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);
    render(null);
    render("0.8.0");
    hook = render("0.8.0");
    expect(hook.state).toMatchObject({ phase: "updating", to: "0.8.1" });

    restart();
    render("0.8.1");
    hook = render("0.8.1");
    expect(hook.state).toEqual({ phase: "updated", to: "0.8.1" });
  });

  // A server older than the boot cannot say whether it restarted: the same version is no answer.
  it("a server that names no boot is no answer on the version it left", async () => {
    container.takes = false;
    commandSpy.mockResolvedValue(ACCEPTED);
    let hook = render({ serverVersion: "0.8.0" });
    hook.update("0.8.1");
    await vi.advanceTimersByTimeAsync(0);
    render({ serverVersion: "0.8.0" });
    hook = render({ serverVersion: "0.8.0" });
    expect(hook.state).toMatchObject({ phase: "updating", to: "0.8.1" });
  });

  it("every Mate's state reads as one snapshot, a new one on every change", () => {
    commandSpy.mockReturnValue(new Promise(() => {}));
    reactHookHarness.beginRender();
    const before = useZeropsMateUpdateStates();
    render("0.8.0").update("0.8.1");
    reactHookHarness.beginRender();
    const after = useZeropsMateUpdateStates();
    expect(after).not.toBe(before);
    expect(after.of({ environmentId: ENVIRONMENT_ID, key: "elsewhere" })).toEqual({
      phase: "updating",
      to: "0.8.1",
    });
  });

  // A card whose Mate is restarting into its update has no socket, so no
  // environment: it still says the update, found by its container.
  it("while its socket is down, a Mate's update is found by its container", () => {
    commandSpy.mockReturnValue(new Promise(() => {}));
    render("0.8.0").update("0.8.1");
    reactHookHarness.beginRender();
    const states = useZeropsMateUpdateStates();
    expect(states.of({ environmentId: undefined, key: "project:service" })).toEqual({
      phase: "updating",
      to: "0.8.1",
    });
    expect(states.of({ environmentId: undefined, key: "another:service" })).toBeUndefined();
  });
});
