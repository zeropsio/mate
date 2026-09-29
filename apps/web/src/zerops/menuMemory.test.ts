import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import type { ZeropsAgentActivity } from "./agentActivity";
import {
  activityFromMemory,
  changeFromMemory,
  EMPTY_MENU_MEMORY,
  MENU_MEMORY_STORAGE_KEY,
  menuMemory,
  rememberedChangeOf,
  rememberedRowOf,
  rememberMenu,
  withChanges,
  withChips,
  withMembers,
  withRows,
} from "./menuMemory";

const WORKING: ZeropsAgentActivity = {
  threadId: ThreadId.make("thread-nova"),
  kind: "working",
  status: null,
  face: "working",
  subject: "Add a /status page",
  at: "2026-09-27T10:00:00.000Z",
  snippet: "The page reads the build number.",
  unread: true,
  pausedUntil: undefined,
  threadKey: "env-nova:thread-nova",
  task: "Add a /status page",
};

const PULL: FlowPullRequest = {
  repository: "app",
  number: 14,
  title: "Add a /status page",
  kind: "code",
  mateProjectId: "nova",
  author: "nova-bot",
  url: "https://git.example/app/pulls/14",
  checks: "passing",
  checkWord: "Checks passed",
  mergeability: "mergeable",
  merged: false,
  mergedAt: undefined,
  headSha: "abc123",
  baseBranch: "main",
  line: "app #14",
  updatedAt: "2026-09-27T10:05:00.000Z",
};

describe("a remembered row", () => {
  it("draws the words and the time the row last said, at rest, with nothing only true then", () => {
    expect(activityFromMemory(rememberedRowOf(WORKING))).toEqual({
      threadId: "thread-nova",
      kind: "idle",
      status: null,
      face: "idle",
      subject: "Add a /status page",
      at: "2026-09-27T10:00:00.000Z",
      snippet: "The page reads the build number.",
      unread: true,
      pausedUntil: undefined,
      threadKey: "env-nova:thread-nova",
      task: "Add a /status page",
      remembered: true,
    });
  });

  // A row keeping its last line for words still to come draws it from
  // memory too, so a reload mid-run before the Mate's first words stands the
  // row at the height it had rather than growing it when the socket answers.
  it("keeps the line a row held for words still to come, and only that", () => {
    const waiting = activityFromMemory(rememberedRowOf({ ...WORKING, snippet: undefined }));
    expect(waiting).toMatchObject({ awaitingWords: true, snippet: undefined });
    const sent = activityFromMemory(
      rememberedRowOf({ ...WORKING, kind: "idle", snippet: undefined, awaitingWords: true }),
    );
    expect(sent.awaitingWords).toBe(true);
    for (const row of [
      WORKING,
      { ...WORKING, kind: "idle" as const, snippet: undefined },
      { ...WORKING, subject: undefined, snippet: undefined },
    ]) {
      expect(activityFromMemory(rememberedRowOf(row))).not.toHaveProperty("awaitingWords");
    }
  });

  it("keeps no word the row did not say", () => {
    const quiet = rememberedRowOf({ ...WORKING, subject: undefined, snippet: undefined });
    expect(quiet).not.toHaveProperty("subject");
    expect(activityFromMemory(quiet).snippet).toBeUndefined();
  });
});

describe("a remembered change", () => {
  it("is its title where it hung, with no verdict until Gitea says one again", () => {
    expect(changeFromMemory(rememberedChangeOf(PULL))).toEqual({
      ...PULL,
      checks: "none",
      checkWord: undefined,
      mergeability: "checking",
      headSha: undefined,
    });
  });
});

describe("what the memory keeps", () => {
  const row = rememberedRowOf(WORKING);

  it("writes each row and forgets a Mate no longer listed", () => {
    const first = withRows(EMPTY_MENU_MEMORY, { nova: row, kai: row }, new Set(["nova", "kai"]));
    const next = withRows(first, {}, new Set(["nova"]));
    expect(Object.keys(next.rows)).toEqual(["nova"]);
  });

  it("is the same memory when nothing changed, so nothing is written", () => {
    const first = withRows(EMPTY_MENU_MEMORY, { nova: row }, new Set(["nova"]));
    expect(withRows(first, { nova: rememberedRowOf(WORKING) }, new Set(["nova"]))).toBe(first);
    const changes = withChanges(first, { g1: [rememberedChangeOf(PULL)] }, new Set(["g1"]));
    expect(withChanges(changes, { g1: [rememberedChangeOf(PULL)] }, new Set(["g1"]))).toBe(changes);
  });

  it("keeps a member's record and nothing else of what the platform sent", () => {
    const memory = withMembers(EMPTY_MENU_MEMORY, "org-1", [
      {
        id: "cu-jan",
        roleCode: "OWNER",
        user: { id: "u-jan", fullName: "Jan Novák", avatar: null },
        extra: "dropped",
      } as never,
      { nope: true } as never,
    ]);
    expect(memory.members["org-1"]).toEqual([
      {
        id: "cu-jan",
        roleCode: "OWNER",
        user: { id: "u-jan", fullName: "Jan Novák", avatar: null },
      },
    ]);
  });
});

describe("a remembered production chip", () => {
  const OK = { label: "prod", state: "ok", version: "v0.1.0" } as const;
  const WAITING = { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 } as const;

  it("keeps each project's chip as last drawn, and forgets one that is no more", () => {
    const first = withChips(EMPTY_MENU_MEMORY, { g1: OK, g2: WAITING }, new Set(["g1", "g2"]));
    expect(first.chips).toEqual({ g1: OK, g2: WAITING });
    // Read again: g2 has no production any more.
    const next = withChips(first, { g2: null }, new Set(["g1", "g2"]));
    expect(next.chips).toEqual({ g1: OK });
    // A project no longer listed takes its chip with it.
    expect(withChips(next, {}, new Set(["g2"])).chips).toEqual({});
  });

  it("is the same memory when no chip changed, so nothing is written", () => {
    const first = withChips(EMPTY_MENU_MEMORY, { g1: OK }, new Set(["g1"]));
    expect(withChips(first, { g1: { ...OK } }, new Set(["g1"]))).toBe(first);
    expect(withChips(first, {})).toBe(first);
  });
});

describe("the memory in this browser", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    stored.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
  });

  afterEach(() => {
    closeAccountLifetime();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is written per account once the menu settles, read back, and gone when the account closes", () => {
    openAccountLifetime("user-ales");
    rememberMenu((memory) =>
      withRows(memory, { nova: rememberedRowOf(WORKING) }, new Set(["nova"])),
    );
    expect(stored.size).toBe(0);
    vi.advanceTimersByTime(400);
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    expect(JSON.parse(stored.get(key) ?? "{}").rows.nova.subject).toBe("Add a /status page");

    closeAccountLifetime();
    expect(stored.has(key)).toBe(false);
    openAccountLifetime("user-ales");
    expect(menuMemory()).toEqual(EMPTY_MENU_MEMORY);
  });

  it("reads nothing another account remembered", () => {
    openAccountLifetime("user-ales");
    rememberMenu((memory) =>
      withRows(memory, { nova: rememberedRowOf(WORKING) }, new Set(["nova"])),
    );
    vi.advanceTimersByTime(400);
    openAccountLifetime("user-jan");
    expect(menuMemory().rows).toEqual({});
  });
});
