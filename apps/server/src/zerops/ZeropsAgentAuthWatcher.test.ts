// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off
// Exercises watchWithFallback's own plain-Node behavior directly — see that
// module's header comment for why it deliberately bypasses Effect's
// FileSystem.watch.
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type WatchFactory,
  type WatchWithFallbackOptions,
  watchWithFallback,
} from "./ZeropsAgentAuthWatcher.ts";

let root: string;

const changes = new NodeEvents.EventEmitter();

const startWatcher = (
  target: string,
  fallbackDir: string,
  onChange: () => void,
  options: WatchWithFallbackOptions = {},
) =>
  watchWithFallback(
    target,
    fallbackDir,
    () => {
      onChange();
      changes.emit("change");
    },
    {
      logWarning: () => undefined,
      ...options,
    },
  );

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-agent-auth-watcher-"));
});

afterEach(() => {
  vi.useRealTimers();
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const waitFor = async (predicate: () => boolean): Promise<void> => {
  while (!predicate()) await new Promise<void>((resolve) => changes.once("change", resolve));
};

/** A distinct second write covers filesystem event coalescing without bounding delivery. */
const waitForWithNudge = async (predicate: () => boolean, nudge: () => void): Promise<void> => {
  const timer = setTimeout(nudge, 1500);
  try {
    await waitFor(predicate);
  } finally {
    clearTimeout(timer);
  }
};

describe("watchWithFallback", () => {
  it("recovers after the first filesystem-watch arm fails", async () => {
    const target = NodePath.join(root, ".codex");
    const credential = NodePath.join(target, "auth.json");
    let armAttempts = 0;
    const warnings: Array<string> = [];
    const failFirstWatch: WatchFactory = (path, listener) => {
      armAttempts += 1;
      if (armAttempts === 1) {
        throw Object.assign(new Error("watch allocation failed"), { code: "EMFILE" });
      }
      return NodeFS.watch(path, listener);
    };
    let fired = 0;
    const handle = startWatcher(
      target,
      root,
      () => {
        fired += 1;
      },
      {
        watch: failFirstWatch,
        logWarning: (message) => warnings.push(message),
      },
    );
    try {
      expect(armAttempts).toBe(1);
      NodeFS.mkdirSync(target);
      NodeFS.writeFileSync(credential, '{"recovered":true}');
      await waitFor(() => fired > 0);
      expect(armAttempts).toBeGreaterThanOrEqual(2);
      expect(warnings.some((message) => message.includes("could not arm filesystem watch"))).toBe(
        true,
      );
      expect(fired).toBeGreaterThan(0);
    } finally {
      handle.dispose();
    }
  });

  it("fires when the target file already exists and changes", async () => {
    const target = NodePath.join(root, "auth.json");
    NodeFS.writeFileSync(target, "{}");
    let fired = 0;
    const handle = startWatcher(target, root, () => {
      fired += 1;
    });
    try {
      NodeFS.writeFileSync(target, '{"changed":true}');
      await waitForWithNudge(
        () => fired > 0,
        () => NodeFS.writeFileSync(target, '{"changed":true,"nudge":true}'),
      );
      expect(fired).toBeGreaterThan(0);
    } finally {
      handle.dispose();
    }
  });

  it("tolerates a missing target directory, firing once it is created", async () => {
    const dir = NodePath.join(root, ".codex");
    const target = NodePath.join(dir, "auth.json");
    let fired = 0;
    const handle = startWatcher(dir, root, () => {
      fired += 1;
    });
    try {
      // dir does not exist yet — the fallback watch (root) must catch its creation.
      NodeFS.mkdirSync(dir);
      NodeFS.writeFileSync(target, "{}");
      await waitFor(() => fired > 0);
      expect(fired).toBeGreaterThan(0);
    } finally {
      handle.dispose();
    }
  });

  it("keeps reporting changes to the target after it re-attaches", async () => {
    const dir = NodePath.join(root, ".codex");
    let targetWatchArms = 0;
    const dropTargetWatchEvents: WatchFactory = (path, listener) => {
      if (path === dir) {
        targetWatchArms += 1;
        return NodeFS.watch(path, () => undefined);
      }
      return NodeFS.watch(path, listener);
    };
    let fired = 0;
    const handle = startWatcher(
      dir,
      root,
      () => {
        fired += 1;
      },
      { watch: dropTargetWatchEvents },
    );
    try {
      NodeFS.mkdirSync(dir);
      NodeFS.writeFileSync(NodePath.join(dir, "auth.json"), "{}");
      await waitFor(() => fired > 0);
      expect(targetWatchArms).toBeGreaterThan(0);
      const afterAttach = fired;

      // The target watch is armed and healthy but its callback is suppressed,
      // modeling an OS delivery silently dropped without an "error" event.
      NodeFS.writeFileSync(NodePath.join(dir, "auth.json"), '{"again":true}');
      await waitFor(() => fired > afterAttach);
      expect(fired).toBeGreaterThan(afterAttach);
    } finally {
      handle.dispose();
    }
  });

  it("polls without throwing when the fallback directory itself does not exist", async () => {
    vi.useFakeTimers();
    const dir = NodePath.join(root, "missing-parent", "also-missing");
    const fallback = NodePath.join(root, "missing-parent");
    const warnings: Array<string> = [];
    let fired = 0;
    const handle = startWatcher(
      dir,
      fallback,
      () => {
        fired += 1;
      },
      { logWarning: (message) => warnings.push(message) },
    );
    // No throw or crash; the degraded poll stays inert until the target changes.
    await vi.advanceTimersToNextTimerAsync();
    expect(fired).toBe(0);
    expect(warnings.some((message) => message.includes("polling"))).toBe(true);
    handle.dispose();
  });

  // S7 follow-up F4: watching a FILE target (as ZeropsAgentAuth.ts now
  // does for the credential path) must ignore writes to SIBLING files in
  // the same directory — Claude's own `backups/`, `sessions/` writes were
  // re-triggering the credential check on every probe before this fix.
  it("ignores writes to sibling files in the same directory", () => {
    const target = NodePath.join(root, ".credentials.json");
    NodeFS.writeFileSync(target, "{}");
    let receive!: NodeFS.WatchListener<string>;
    const watcher = Object.assign(new NodeEvents.EventEmitter(), {
      close: vi.fn(),
      ref() {
        return watcher;
      },
      unref() {
        return watcher;
      },
    });
    let fired = 0;
    const handle = startWatcher(
      target,
      root,
      () => {
        fired += 1;
      },
      {
        watch: (_path, listener) => {
          receive = listener;
          return watcher;
        },
      },
    );
    try {
      // Delivery returns after the watcher's filename decision has run.
      receive("change", "backups");
      expect(fired).toBe(0);
      receive("change", ".credentials.json");
      expect(fired).toBe(1);
    } finally {
      handle.dispose();
    }
  });

  it("stops firing after dispose", () => {
    const target = NodePath.join(root, "auth.json");
    NodeFS.writeFileSync(target, "{}");
    let receive!: NodeFS.WatchListener<string>;
    const watcher = Object.assign(new NodeEvents.EventEmitter(), {
      close: vi.fn(),
      ref() {
        return watcher;
      },
      unref() {
        return watcher;
      },
    });
    let fired = 0;
    const handle = startWatcher(
      target,
      root,
      () => {
        fired += 1;
      },
      {
        watch: (_path, listener) => {
          receive = listener;
          return watcher;
        },
      },
    );
    handle.dispose();
    receive("change", "auth.json");
    expect(watcher.close).toHaveBeenCalledOnce();
    expect(fired).toBe(0);
  });
});
