// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
// Exercises watchWithFallback's own plain-Node behavior directly — see that
// module's header comment for why it deliberately bypasses Effect's
// FileSystem.watch.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { watchWithFallback } from "./ZeropsAgentAuthWatcher.ts";

let root: string;

beforeEach(() => {
  root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "z3-agent-auth-watcher-"));
});

afterEach(() => {
  NodeFS.rmSync(root, { recursive: true, force: true });
});

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * Polls for `predicate`, firing `nudge()` once if it hasn't happened by
 * `nudgeAfterMs`. A single fs write's "change" notification can be delayed
 * or dropped entirely under system load — macOS FSEvents coalescing is not
 * fully deterministic — so this gives the watcher a second, distinctly
 * payloaded event to react to well before giving up, rather than trusting
 * one write alone against a longer fixed wait.
 */
const waitForWithNudge = async (
  predicate: () => boolean,
  nudge: () => void,
  { nudgeAfterMs = 1500, timeoutMs = 5000 }: { nudgeAfterMs?: number; timeoutMs?: number } = {},
): Promise<void> => {
  const start = Date.now();
  let nudged = false;
  while (!predicate()) {
    const elapsed = Date.now() - start;
    if (!nudged && elapsed >= nudgeAfterMs) {
      nudge();
      nudged = true;
    }
    if (elapsed > timeoutMs) {
      throw new Error("waitForWithNudge: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("watchWithFallback", () => {
  it("fires when the target file already exists and changes", async () => {
    const target = NodePath.join(root, "auth.json");
    NodeFS.writeFileSync(target, "{}");
    let fired = 0;
    const handle = watchWithFallback(target, root, () => {
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
    const handle = watchWithFallback(dir, root, () => {
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
    let fired = 0;
    const handle = watchWithFallback(dir, root, () => {
      fired += 1;
    });
    try {
      NodeFS.mkdirSync(dir);
      NodeFS.writeFileSync(NodePath.join(dir, "auth.json"), "{}");
      await waitFor(() => fired > 0);
      const afterAttach = fired;

      NodeFS.writeFileSync(NodePath.join(dir, "auth.json"), '{"again":true}');
      await waitFor(() => fired > afterAttach);
      expect(fired).toBeGreaterThan(afterAttach);
    } finally {
      handle.dispose();
    }
  });

  it("gives up quietly when the fallback directory itself does not exist", async () => {
    const dir = NodePath.join(root, "missing-parent", "also-missing");
    const fallback = NodePath.join(root, "missing-parent");
    let fired = 0;
    const handle = watchWithFallback(dir, fallback, () => {
      fired += 1;
    });
    // No throw, no crash — just never fires.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fired).toBe(0);
    handle.dispose();
  });

  // S7 follow-up F4: watching a FILE target (as ZeropsAgentAuth.ts now
  // does for the credential path) must ignore writes to SIBLING files in
  // the same directory — Claude's own `backups/`, `sessions/` writes were
  // re-triggering the credential check on every probe before this fix.
  it("ignores writes to sibling files in the same directory", async () => {
    const target = NodePath.join(root, ".credentials.json");
    const sibling = NodePath.join(root, "backups", "x.json");
    NodeFS.writeFileSync(target, "{}");
    NodeFS.mkdirSync(NodePath.join(root, "backups"));
    let fired = 0;
    const handle = watchWithFallback(target, root, () => {
      fired += 1;
    });
    try {
      // Let watcher-startup noise settle first — on this platform, attaching
      // right after other writes in the same directory can replay a stale
      // event for the target's own name once the watch actually engages
      // (the same FSEvents non-determinism this file's header comment and
      // `waitForWithNudge` already call out). This test asserts a NEGATIVE
      // (no fire for the sibling), so that startup noise would otherwise
      // register as a false failure — resetting the counter after the
      // settle window isolates the assertion to the sibling write alone.
      await new Promise((resolve) => setTimeout(resolve, 250));
      fired = 0;

      NodeFS.writeFileSync(sibling, "{}");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fired).toBe(0);

      // Confirm the watcher is actually live — a real change to the target
      // itself still fires, so a silent "nothing ever fires" bug wouldn't
      // pass this test by accident.
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

  it("stops firing after dispose", async () => {
    const target = NodePath.join(root, "auth.json");
    NodeFS.writeFileSync(target, "{}");
    let fired = 0;
    const handle = watchWithFallback(target, root, () => {
      fired += 1;
    });
    handle.dispose();
    NodeFS.writeFileSync(target, '{"changed":true}');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fired).toBe(0);
  });
});
