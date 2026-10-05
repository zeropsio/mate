import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  changeFromMemory,
  EMPTY_MENU_MEMORY,
  MENU_MEMORY_STORAGE_KEY,
  menuMemory,
  rememberedChangeOf,
  rememberedChanges,
  rememberedMates,
  rememberMenu,
  withChanges,
  withChips,
  withMates,
  withMembers,
  withoutMate,
  withStructure,
} from "./menuMemory";

/** Vera as HQ last told her: asleep, her last overview stored. */
const VERA = Schema.decodeUnknownSync(MateLiveView)({
  presence: { online: false, since: "2026-10-03T08:00:00.000Z", overview: "stored" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: null,
  threads: { list: [], omitted: 0 },
  logins: { "claude-code": { signedInBy: "u-ada", present: true, token: false } },
  crew: { status: "off" },
});

const PULL: FlowPullRequest = {
  repository: "app",
  number: 14,
  title: "Add a /status page",
  kind: "code",
  mateProjectId: "nova",
  url: "https://git.example/app/pulls/14",
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: "abc123",
  baseBranch: "main",
  line: "app #14",
  updatedAt: "2026-09-27T10:05:00.000Z",
};

describe("a remembered change", () => {
  it("is its title where it hung, with no verdict until HQ says one again", () => {
    expect(changeFromMemory(rememberedChangeOf(PULL))).toEqual({
      ...PULL,
      mergeability: "checking",
      headSha: undefined,
    });
  });

  // Review of pass 42: a draft remembered read as ready, and a reload drew
  // its Review only to take it away once HQ spoke.
  it("stays a draft", () => {
    expect(changeFromMemory(rememberedChangeOf({ ...PULL, ready: false })).ready).toBe(false);
  });
});

describe("what the memory keeps", () => {
  it("forgets everything of a deleted Mate at once, HQ's word of it and its crew, and nothing else", () => {
    const told = new Map([
      ["nova", VERA],
      ["kai", VERA],
    ]);
    const first = withMates(EMPTY_MENU_MEMORY, "org-1", told, null);
    const next = withoutMate(first, "nova");
    expect(Object.keys(next.mates["org-1"]?.mates ?? {})).toEqual(["kai"]);
    expect(withoutMate(next, "nova")).toBe(next);
  });

  it("is the same memory when nothing changed, so nothing is written", () => {
    const first = withMates(EMPTY_MENU_MEMORY, "org-1", new Map([["nova", VERA]]), null);
    expect(withMates(first, "org-1", new Map([["nova", VERA]]), null)).toBe(first);
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

describe("a remembered HQ structure", () => {
  const STRUCTURE = {
    ungrouped: [{ projectId: "p9", name: "scratch", mate: { name: "Ada", face: "sky:flower" } }],
    apps: [
      {
        id: "app-1",
        name: "Acme CRM",
        projects: [
          {
            projectId: "p-vera",
            name: "Acme CRM - Vera",
            kind: "mate",
            mate: { name: "Vera", face: "rose:seal" },
          },
        ],
      },
    ],
  };

  it("keeps an organization's structure with when HQ answered it, and is the same memory for the same one", () => {
    const memory = withStructure(EMPTY_MENU_MEMORY, "org-1", STRUCTURE, 1_000);
    expect(memory.structures["org-1"]).toEqual({
      readAt: 1_000,
      ungrouped: STRUCTURE.ungrouped,
      apps: STRUCTURE.apps,
    });
    expect(
      withStructure(
        memory,
        "org-1",
        { ungrouped: [...STRUCTURE.ungrouped], apps: [...STRUCTURE.apps] },
        1_000,
      ),
    ).toBe(memory);
  });
});

describe("a project's remembered chips", () => {
  const OK = { label: "prod", state: "ok", version: "v0.1.0" } as const;
  const WAITING = { label: "prod", state: "waiting", version: "v0.1.44", waiting: 1 } as const;
  const STAGE = { label: "stage", state: "failed", version: "main" } as const;
  const STAGES = {
    label: "stage",
    state: "down",
    stages: [
      { name: "stage", state: "ok" },
      { name: "qa", state: "down" },
    ],
  } as const;

  it("keeps each project's chips as last drawn, and forgets one that is no more", () => {
    const first = withChips(
      EMPTY_MENU_MEMORY,
      { g1: { prod: OK, stage: STAGE }, g2: { prod: WAITING } },
      new Set(["g1", "g2"]),
    );
    expect(first.chips).toEqual({ g1: { prod: OK, stage: STAGE }, g2: { prod: WAITING } });
    // Read again: g1's stage is gone; g2's production is unread, so kept.
    const next = withChips(first, { g1: { stage: null }, g2: {} }, new Set(["g1", "g2"]));
    expect(next.chips).toEqual({ g1: { prod: OK }, g2: { prod: WAITING } });
    // A project that has neither any more keeps nothing.
    expect(withChips(next, { g1: { prod: null } }).chips).toEqual({ g2: { prod: WAITING } });
    // A project no longer listed takes its chips with it.
    expect(withChips(next, {}, new Set(["g2"])).chips).toEqual({ g2: { prod: WAITING } });
  });

  it("keeps a chip over several stages with each of them", () => {
    expect(withChips(EMPTY_MENU_MEMORY, { g1: { stage: STAGES } }).chips).toEqual({
      g1: { stage: STAGES },
    });
  });

  it("is the same memory when no chip changed, so nothing is written", () => {
    const first = withChips(EMPTY_MENU_MEMORY, { g1: { prod: OK } }, new Set(["g1"]));
    expect(withChips(first, { g1: { prod: { ...OK } } }, new Set(["g1"]))).toBe(first);
    expect(withChips(first, { g1: {} })).toBe(first);
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
    rememberMenu((memory) => withChanges(memory, { g1: [rememberedChangeOf(PULL)] }));
    expect(stored.size).toBe(0);
    vi.advanceTimersByTime(400);
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    expect(JSON.parse(stored.get(key) ?? "{}").changes.g1[0].title).toBe("Add a /status page");

    closeAccountLifetime();
    expect(stored.has(key)).toBe(false);
    openAccountLifetime("user-ales");
    expect(menuMemory()).toEqual(EMPTY_MENU_MEMORY);
  });

  it("reads back a chip that says at least how many changes wait", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const prod = {
      label: "prod",
      state: "waiting",
      version: "v0.1.44",
      waiting: 10000,
      waitingAtLeast: true,
    } as const;
    stored.set(
      key,
      JSON.stringify({ rows: {}, changes: {}, chips: { g1: { prod } }, members: {} }),
    );
    openAccountLifetime("user-ales");
    expect(menuMemory().chips.g1?.prod).toEqual(prod);
  });

  it("reads back a chip that cannot tell what a service runs", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const prod = { label: "prod", state: "ok", version: "v0.1.44", untold: ["api"] } as const;
    stored.set(
      key,
      JSON.stringify({ rows: {}, changes: {}, chips: { g1: { prod } }, members: {} }),
    );
    openAccountLifetime("user-ales");
    expect(menuMemory().chips.g1?.prod).toEqual(prod);
  });

  it("reads a memory written before HQ structures were kept, with none", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(key, JSON.stringify({ rows: {}, changes: {}, chips: {}, members: {} }));
    openAccountLifetime("user-ales");
    expect(menuMemory().structures).toEqual({});
  });

  it("reads a structure remembered before the Mates in no application, with none of them", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const structures = { "org-1": { readAt: 1_000, apps: [] } };
    stored.set(key, JSON.stringify({ rows: {}, changes: {}, members: {}, structures }));
    openAccountLifetime("user-ales");
    expect(menuMemory().structures["org-1"]).toEqual({ readAt: 1_000, ungrouped: [], apps: [] });
  });

  // A reload after an upgrade paints what the last version drew: a memory
  // from before the production chip (with each stop's line, no chips) keeps
  // its changes and members, and simply has no chip yet.
  it("reads a memory written before the production chip, keeping all it held", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(
      key,
      JSON.stringify({
        changes: { g1: [rememberedChangeOf(PULL)] },
        stops: { "prod-1": "v1.4.0" },
        members: { "org-1": [{ id: "cu-jan", roleCode: "OWNER" }] },
      }),
    );
    openAccountLifetime("user-ales");
    const memory = menuMemory();
    expect(memory.changes.g1).toHaveLength(1);
    expect(memory.members["org-1"]).toEqual([{ id: "cu-jan", roleCode: "OWNER" }]);
    expect(memory.chips).toEqual({});
  });

  // A memory written while a project wore one chip keeps all else it held,
  // and has no chip yet: one reload draws them once they are read.
  it("reads a memory written with one chip per project, keeping all else it held", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(
      key,
      JSON.stringify({
        ...EMPTY_MENU_MEMORY,
        changes: { g1: [rememberedChangeOf(PULL)] },
        chips: { g1: { label: "prod", state: "ok", version: "v1.4.0" } },
      }),
    );
    openAccountLifetime("user-ales");
    const memory = menuMemory();
    expect(memory.changes.g1).toHaveLength(1);
    expect(memory.chips).toEqual({ g1: {} });
  });

  // A crew's faces come with its Mate's overview now (`mates`): a memory written while this browser
  // kept crews of their own still reads, those crews passed by, rather than forgotten whole.
  it("reads a memory written while crews were kept, its crews passed by", () => {
    openAccountLifetime("user-ada");
    const key = `mate:account:user-ada:${MENU_MEMORY_STORAGE_KEY}`;
    const before = {
      ...EMPTY_MENU_MEMORY,
      changes: { g1: [rememberedChangeOf(PULL)] },
      crews: {
        nova: { faces: [{ handle: "ada", displayName: "Ada", tint: "violet", lead: true }] },
      },
    };
    stored.set(key, JSON.stringify(before));
    closeAccountLifetime();
    stored.set(key, JSON.stringify(before));
    openAccountLifetime("user-ada");
    expect(menuMemory().changes.g1?.[0]?.title).toBe("Add a /status page");
    expect("crews" in menuMemory()).toBe(false);
  });

  // Only Mates open changes (SPEC §5.4): the author a change was once remembered with is not
  // kept, and the change is.
  it("reads a change remembered with its author, keeping the change and not the author", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    stored.set(
      key,
      JSON.stringify({
        ...EMPTY_MENU_MEMORY,
        changes: { g1: [{ ...rememberedChangeOf(PULL), author: "nova-bot" }] },
      }),
    );
    openAccountLifetime("user-ales");
    expect(menuMemory().changes.g1).toEqual([rememberedChangeOf(PULL)]);
  });

  // Only Mates open changes (SPEC §5.4): a change remembered with no Mate — a person's own branch,
  // from before — reads, and is drawn nowhere; the rest of what was remembered still is.
  it("reads a change remembered without its Mate, and draws it nowhere", () => {
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const { mateProjectId: _mate, ...personal } = { ...rememberedChangeOf(PULL), number: 15 };
    stored.set(
      key,
      JSON.stringify({
        ...EMPTY_MENU_MEMORY,
        changes: { g1: [personal, rememberedChangeOf(PULL)] },
      }),
    );
    openAccountLifetime("user-ales");
    expect(rememberedChanges("g1")?.map((pull) => pull.number)).toEqual([14]);
  });

  it("remembers HQ's Mates view and nothing quoted from a shell", () => {
    const people = { "u-ada": { name: "Ada Lovelace" } };
    openAccountLifetime("user-ales");
    rememberMenu((memory) => withMates(memory, "org-1", new Map([["p-vera", VERA]]), people));
    vi.advanceTimersByTime(400);
    const key = `mate:account:user-ales:${MENU_MEMORY_STORAGE_KEY}`;
    const written = JSON.parse(stored.get(key) ?? "{}");
    expect(written.mates).toEqual({ "org-1": { mates: { "p-vera": VERA }, people } });
    expect(written).not.toHaveProperty("rows");

    // A memory from before keeps its rows out, and all else it held.
    stored.set(key, JSON.stringify({ ...written, rows: { nova: { at: "x" } } }));
    closeAccountLifetime();
    stored.set(key, JSON.stringify({ ...written, rows: { nova: { at: "x" } } }));
    openAccountLifetime("user-ales");
    expect(menuMemory()).not.toHaveProperty("rows");
    expect(rememberedMates("org-1")).toEqual({ mates: new Map([["p-vera", VERA]]), people });
  });

  it("reads nothing another account remembered", () => {
    openAccountLifetime("user-ales");
    rememberMenu((memory) => withChanges(memory, { g1: [rememberedChangeOf(PULL)] }));
    vi.advanceTimersByTime(400);
    openAccountLifetime("user-jan");
    expect(menuMemory().changes).toEqual({});
  });
});
