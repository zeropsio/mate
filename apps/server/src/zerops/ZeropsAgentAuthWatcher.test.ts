// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type WatchFactory, watchWithFallback } from "./ZeropsAgentAuthWatcher.ts";

vi.mock("node:fs", { spy: true });

class FakeWatcher extends NodeEvents.EventEmitter implements NodeFS.FSWatcher {
  readonly close = vi.fn(() => this.emit("close"));
  ref() {
    return this;
  }
  unref() {
    return this;
  }
}

let root: string;
const handles: Array<{ dispose: () => void }> = [];

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-agent-auth-watcher-"));
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  vi.useRealTimers();
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const setup = (target = NodePath.join(root, "auth.json")) => {
  const watches: Array<{
    path: string;
    listener: NodeFS.WatchListener<string>;
    watcher: FakeWatcher;
  }> = [];
  const watch = vi.fn<WatchFactory>((path, listener) => {
    const watcher = new FakeWatcher();
    watches.push({ path, listener, watcher });
    return watcher;
  });
  const onChange = vi.fn();
  const logWarning = vi.fn();
  const onStateChange = vi.fn();
  const handle = watchWithFallback(target, root, onChange, { watch, logWarning, onStateChange });
  handles.push(handle);
  return { target, watch, watches, onChange, logWarning, onStateChange, handle };
};

describe("watchWithFallback", () => {
  it("ends an allocation failure visibly without polling or rearming", () => {
    const target = NodePath.join(root, "auth.json");
    const watch = vi.fn<WatchFactory>(() => {
      throw new Error("watch allocation failed");
    });
    const logWarning = vi.fn();
    const onChange = vi.fn();
    const handle = watchWithFallback(target, root, onChange, { watch, logWarning });
    handles.push(handle);
    NodeFS.writeFileSync(target, "{}");
    vi.advanceTimersByTime(60_000);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(logWarning).toHaveBeenCalledTimes(1);
    expect(logWarning.mock.calls[0]?.[0]).toContain("Watch again");
    expect(handle.getState()).toMatchObject({
      status: "degraded",
      reason: "watch allocation failed",
      lastObservedAt: 1000,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["error", "close"] as const)(
    "ends an unexpected watcher %s once and ignores stale events",
    (event) => {
      const { watches, handle, watch, onChange, logWarning, onStateChange } = setup();
      const first = watches[0]!;
      first.watcher.emit(event, new Error("watch failed"));
      first.listener("rename", "auth.json");
      first.watcher.emit("error", new Error("late error"));
      vi.advanceTimersByTime(60_000);
      expect(watch).toHaveBeenCalledTimes(1);
      expect(first.watcher.close).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
      expect(logWarning).toHaveBeenCalledTimes(1);
      expect(handle.getState().status).toBe("degraded");
      expect(onStateChange.mock.lastCall?.[0]).toEqual(handle.getState());
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("Watch again makes exactly one new attempt, including when that attempt fails", () => {
    const { watch, watches, handle } = setup();
    watches[0]!.watcher.emit("error", new Error("watch failed"));
    watch.mockImplementationOnce(() => {
      throw new Error("still unavailable");
    });
    handle.watchAgain();
    vi.advanceTimersByTime(60_000);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(handle.getState()).toMatchObject({ status: "degraded", reason: "still unavailable" });
    handle.watchAgain();
    expect(watch).toHaveBeenCalledTimes(3);
    expect(handle.getState()).toMatchObject({ status: "watching", reason: undefined });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Check now emits one credential observation without restarting a failed watch", () => {
    const { target, watch, watches, handle, onChange } = setup();
    watches[0]!.watcher.emit("error", new Error("watch failed"));
    NodeFS.writeFileSync(target, "{}");
    vi.setSystemTime(2000);
    handle.checkNow();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(handle.getState()).toMatchObject({
      status: "degraded",
      lastObservedAt: 2000,
      reason: "watch failed",
    });
  });

  it("does not claim a new observation when OS events are lost", () => {
    const target = NodePath.join(root, "auth.json");
    NodeFS.writeFileSync(target, "{}");
    const { handle, watch, onChange } = setup(target);
    NodeFS.writeFileSync(target, '{"changed":true}');
    vi.advanceTimersByTime(60_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(watch).toHaveBeenCalledTimes(1);
    expect(handle.getState().lastObservedAt).toBe(1000);
    handle.checkNow();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(handle.getState().lastObservedAt).toBe(61_000);
  });

  it("continues once when a filesystem event announces the missing target appeared", () => {
    const dir = NodePath.join(root, ".codex");
    const { watches, watch, handle, onChange } = setup(dir);
    expect(watches[0]!.path).toBe(root);
    NodeFS.mkdirSync(dir);
    watches[0]!.listener("rename", ".codex");
    expect(watch).toHaveBeenCalledTimes(2);
    expect(watches[1]!.path).toBe(dir);
    expect(onChange).toHaveBeenCalledTimes(1);
    watches[0]!.listener("rename", ".codex");
    expect(watch).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(handle.getState().status).toBe("watching");
  });

  it("ends a failed event-driven target attachment without retrying", () => {
    const dir = NodePath.join(root, ".codex");
    const { watches, watch, handle, onChange } = setup(dir);
    NodeFS.mkdirSync(dir);
    watch.mockImplementationOnce(() => {
      throw new Error("target watch failed");
    });
    watches[0]!.listener("rename", ".codex");
    vi.advanceTimersByTime(60_000);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(handle.getState()).toMatchObject({ status: "degraded", reason: "target watch failed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("follows newly created ancestors so a nested credential file can appear", () => {
    const dir = NodePath.join(root, ".codex");
    const { watches, watch, onChange } = setup(NodePath.join(dir, "auth.json"));
    NodeFS.mkdirSync(dir);
    watches[0]!.listener("rename", ".codex");
    expect(watch).toHaveBeenCalledTimes(2);
    expect(watches[1]!.path).toBe(dir);
    expect(onChange).not.toHaveBeenCalled();
    NodeFS.writeFileSync(NodePath.join(dir, "auth.json"), "{}");
    watches[1]!.listener("rename", "auth.json");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(2);
  });

  it("observes a directory removal and follows its announced replacement once", () => {
    const dir = NodePath.join(root, ".codex");
    NodeFS.mkdirSync(dir);
    const { watches, watch, onChange } = setup(dir);
    NodeFS.rmdirSync(dir);
    watches[0]!.listener("rename", ".codex");
    expect(watches[1]!.path).toBe(root);
    NodeFS.mkdirSync(dir);
    watches[1]!.listener("rename", ".codex");
    expect(watch).toHaveBeenCalledTimes(3);
    expect(watches[2]!.path).toBe(dir);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("ignores sibling file events but observes atomic replacement and removal of the credential", () => {
    const target = NodePath.join(root, "auth.json");
    NodeFS.writeFileSync(target, "{}");
    const { watches, watch, onChange, handle } = setup(target);
    expect(watches[0]!.path).toBe(root);
    watches[0]!.listener("change", "sibling.json");
    expect(onChange).not.toHaveBeenCalled();
    NodeFS.writeFileSync(NodePath.join(root, "next.json"), "{}");
    NodeFS.renameSync(NodePath.join(root, "next.json"), target);
    vi.setSystemTime(2000);
    watches[0]!.listener("rename", "auth.json");
    NodeFS.unlinkSync(target);
    watches[0]!.listener("rename", "auth.json");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(handle.getState().lastObservedAt).toBe(2000);
  });

  it("reports an unreadable target once and only checks again manually", () => {
    const { target, watches, watch, onChange, handle, logWarning } = setup();
    const originalStat = NodeFS.statSync;
    const stat = vi.spyOn(NodeFS, "statSync").mockImplementation((path, options) => {
      if (path === target) throw new Error("permission denied");
      return originalStat(path, options as { bigint: false });
    });
    try {
      watches[0]!.listener("rename", "auth.json");
      vi.advanceTimersByTime(60_000);
      expect(onChange).not.toHaveBeenCalled();
      expect(watch).toHaveBeenCalledTimes(1);
      expect(handle.getState()).toMatchObject({
        status: "degraded",
        reason: "permission denied",
        lastObservedAt: 1000,
      });
      expect(logWarning).toHaveBeenCalledTimes(1);
      handle.checkNow();
      expect(logWarning).toHaveBeenCalledTimes(2);
    } finally {
      stat.mockRestore();
    }
  });

  it("disposes idempotently and rejects stale events and manual actions after disposal", () => {
    const { watches, watch, onChange, logWarning, handle } = setup();
    handle.dispose();
    handle.dispose();
    watches[0]!.listener("rename", "auth.json");
    watches[0]!.watcher.emit("error", new Error("late error"));
    handle.watchAgain();
    handle.checkNow();
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watches[0]!.watcher.close).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(logWarning).not.toHaveBeenCalled();
    expect(handle.getState().status).toBe("disposed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
