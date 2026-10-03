import { EnvironmentId } from "@t3tools/contracts";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidateRow, HeldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  candidateOfSkeleton,
  decodeMenuSkeleton,
  EMPTY_MENU_SKELETON,
  encodeMenuSkeleton,
  MENU_SKELETON_MAX_BYTES,
  MENU_SKELETON_MAX_ORGANIZATIONS,
  MENU_SKELETON_MAX_ROWS,
  MENU_SKELETON_STORAGE_KEY,
  menuRowsOf,
  rememberedMenuCandidates,
  rememberMenuCandidates,
  skeletonRowOf,
  withOrganizationSkeleton,
} from "./menuSkeleton";

const ORG = "org-lumen";
const OTHER_ORG = "org-harbor";

const mate = (id: string, overrides: Partial<CandidateRow> = {}): CandidateRow => ({
  key: `${id}:svc-${id}`,
  group: "connected",
  presence: "known",
  service: { id: `svc-${id}`, name: "zcp", status: "ACTIVE", created: "2026-09-01T10:00:00Z" },
  containerOrigin: `https://zcp-${id}.example.test`,
  environmentId: EnvironmentId.make(`env-${id}`),
  project: {
    id,
    name: `${id}-dev`,
    status: "ACTIVE",
    clientId: ORG,
    created: "2026-09-01T09:58:00Z",
    tagList: ["mate", "mate:g:g-garden", `mate:bot:${id}`],
  },
  ...overrides,
});

const NOVA = mate("nova");
const { environmentId: _linked, ...UNLINKED } = mate("kai");
const KAI: CandidateRow = { ...UNLINKED, group: "ready" };
const PROD: CandidateRow = {
  key: "garden-prod",
  group: "unavailable",
  presence: "known",
  missingContainer: true,
  project: {
    id: "garden-prod",
    name: "garden-prod",
    status: "ACTIVE",
    tagList: ["mate:g:g-garden", "mate:role:production"],
    userRoles: [{ clientUserId: "cu-ida", roleCode: "OWNER" }],
  },
};

const known = (
  rows: ReadonlyArray<CandidateRow>,
  coverage: "complete" | "partial",
): Shown<ReadonlyArray<CandidateRow>> =>
  ({
    state: "known",
    value: rows,
    coverage,
    asOf: { atMs: 0 },
    freshness: { kind: "live" },
  }) as unknown as Shown<ReadonlyArray<CandidateRow>>;

const heldOf = (
  rows: ReadonlyArray<CandidateRow>,
  complete: boolean,
): HeldCandidates<CandidateRow> => ({
  rows,
  complete,
});
const NOTHING_HELD = heldOf([], false);

describe("a remembered row", () => {
  it.each([
    { name: "a connected Mate", row: NOVA },
    { name: "a Mate not linked yet", row: KAI },
    { name: "a stop without a container, its roles read", row: PROD },
    {
      name: "a Mate whose creation failed",
      row: {
        ...KAI,
        group: "unavailable" as const,
        creationFailed: { message: "The platform said no." },
      },
    },
  ])("paints $name as it was read", ({ row }) => {
    expect(candidateOfSkeleton(skeletonRowOf(row))).toEqual(row);
  });

  it("keeps nothing the row does not draw from", () => {
    const presented = {
      ...NOVA,
      routes: [{ url: "https://nova.example.test" }],
      connection: { phase: "connected" },
      project: { ...NOVA.project, description: "kept elsewhere", maxCreditLimit: 10 },
    } as unknown as CandidateRow;
    const row = skeletonRowOf(presented);
    expect(row).not.toHaveProperty("routes");
    expect(row).not.toHaveProperty("connection");
    expect(row.project).not.toHaveProperty("description");
    expect(row.project).not.toHaveProperty("maxCreditLimit");
  });
});

describe("the remembered tree, bounded", () => {
  it("keeps an organization's rows in their order, and is the same memory when nothing moved", () => {
    const first = withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA, KAI, PROD], 1);
    expect(first.organizations[ORG]?.rows.map((row) => row.key)).toEqual([
      NOVA.key,
      KAI.key,
      PROD.key,
    ]);
    expect(withOrganizationSkeleton(first, ORG, [NOVA, KAI, PROD], 2)).toBe(first);
  });

  it("keeps the first rows up to its cap", () => {
    const many = Array.from({ length: MENU_SKELETON_MAX_ROWS + 5 }, (_, index) =>
      mate(`m${String(index)}`),
    );
    const skeleton = withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, many, 1);
    expect(skeleton.organizations[ORG]?.rows).toHaveLength(MENU_SKELETON_MAX_ROWS);
    expect(skeleton.organizations[ORG]?.rows[0]?.project.id).toBe("m0");
  });

  it("lets the oldest organization go past its cap", () => {
    let skeleton = EMPTY_MENU_SKELETON;
    for (let index = 0; index <= MENU_SKELETON_MAX_ORGANIZATIONS; index += 1) {
      skeleton = withOrganizationSkeleton(skeleton, `org-${String(index)}`, [NOVA], index);
    }
    expect(Object.keys(skeleton.organizations)).toHaveLength(MENU_SKELETON_MAX_ORGANIZATIONS);
    expect(skeleton.organizations["org-0"]).toBeUndefined();
    expect(skeleton.organizations[`org-${String(MENU_SKELETON_MAX_ORGANIZATIONS)}`]).toBeDefined();
  });

  it("stores within its bytes, the oldest organization let go first", () => {
    const wide = (prefix: string) =>
      Array.from({ length: MENU_SKELETON_MAX_ROWS }, (_, index) =>
        mate(`${prefix}${String(index)}`, {
          project: {
            ...NOVA.project,
            id: `${prefix}${String(index)}`,
            name: "n".repeat(600),
          },
        }),
      );
    let skeleton = withOrganizationSkeleton(EMPTY_MENU_SKELETON, OTHER_ORG, wide("a"), 1);
    skeleton = withOrganizationSkeleton(skeleton, ORG, wide("b"), 2);
    const encoded = encodeMenuSkeleton(skeleton);
    expect(encoded).not.toBeNull();
    expect((encoded ?? "").length).toBeLessThanOrEqual(MENU_SKELETON_MAX_BYTES);
    expect(Object.keys(decodeMenuSkeleton(encoded).organizations)).toEqual([ORG]);
  });

  it.each([
    { name: "nothing stored", stored: null },
    { name: "not JSON", stored: "{nope" },
    { name: "another shape", stored: JSON.stringify({ organizations: { [ORG]: { rows: 3 } } }) },
    {
      name: "a row missing its project",
      stored: JSON.stringify({ organizations: { [ORG]: { at: 1, rows: [{ key: "x" }] } } }),
    },
  ])("reads nothing from $name", ({ stored }) => {
    expect(decodeMenuSkeleton(stored)).toEqual(EMPTY_MENU_SKELETON);
  });
});

describe("the rows the menu draws while it reads", () => {
  const REMEMBERED = [NOVA, KAI, PROD];
  const unknownKai: CandidateRow = {
    key: "kai",
    group: "unavailable",
    presence: "unknown",
    project: KAI.project,
  };

  it.each([
    {
      name: "unread, a tree remembered: the tree",
      listing: { state: "unread", waitingFor: null },
      held: NOTHING_HELD,
      remembered: REMEMBERED,
      rows: REMEMBERED,
      complete: false,
      fromMemory: true,
      settled: false,
    },
    {
      name: "being read, a tree remembered: the tree",
      listing: { state: "reading", sinceMs: 0, attempt: 1 },
      held: NOTHING_HELD,
      remembered: REMEMBERED,
      rows: REMEMBERED,
      complete: false,
      fromMemory: true,
      settled: false,
    },
    {
      name: "waiting on the Zerops session, a tree remembered: the tree",
      listing: { state: "unread", waitingFor: "zerops-session" },
      held: NOTHING_HELD,
      remembered: REMEMBERED,
      rows: REMEMBERED,
      complete: false,
      fromMemory: true,
      settled: false,
    },
    {
      name: "its access not verified yet, a tree remembered: the tree",
      listing: { state: "withheld", reason: "access-unverified", cause: null },
      held: NOTHING_HELD,
      remembered: REMEMBERED,
      rows: REMEMBERED,
      complete: false,
      fromMemory: true,
      settled: false,
    },
    {
      name: "being read, nothing remembered: nothing, as before",
      listing: { state: "reading", sinceMs: 0, attempt: 1 },
      held: NOTHING_HELD,
      remembered: undefined,
      rows: [],
      complete: false,
      fromMemory: false,
      settled: false,
    },
    {
      name: "being read, an empty tree remembered: nothing",
      listing: { state: "reading", sinceMs: 0, attempt: 1 },
      held: NOTHING_HELD,
      remembered: [],
      rows: [],
      complete: false,
      fromMemory: false,
      settled: false,
    },
    {
      name: "known and whole: the listing's own rows, the memory replaced",
      listing: known([NOVA, PROD], "complete"),
      held: heldOf([NOVA, PROD], true),
      remembered: REMEMBERED,
      rows: [NOVA, PROD],
      complete: true,
      fromMemory: false,
      settled: true,
    },
    {
      name: "known in part, a container not read yet: that row as remembered",
      listing: known([NOVA, unknownKai], "partial"),
      held: heldOf([NOVA, unknownKai], false),
      remembered: REMEMBERED,
      rows: [NOVA, KAI],
      complete: false,
      fromMemory: true,
      settled: false,
    },
    {
      name: "known in part, every row read: the listing's own rows",
      listing: known([NOVA], "partial"),
      held: heldOf([NOVA], false),
      remembered: REMEMBERED,
      rows: [NOVA],
      complete: false,
      fromMemory: false,
      settled: true,
    },
    {
      name: "known in part, a container not read and not remembered: the listing's row",
      listing: known([unknownKai], "partial"),
      held: heldOf([unknownKai], false),
      remembered: [NOVA],
      rows: [unknownKai],
      complete: false,
      fromMemory: false,
      settled: false,
    },
    {
      name: "known in part with no row yet, a tree remembered: the tree",
      listing: known([], "partial"),
      held: heldOf([], false),
      remembered: REMEMBERED,
      rows: REMEMBERED,
      complete: false,
      fromMemory: true,
      settled: false,
    },
    {
      name: "known in part, a container not read and nothing remembered: not to remember",
      listing: known([unknownKai], "partial"),
      held: heldOf([unknownKai], false),
      remembered: undefined,
      rows: [unknownKai],
      complete: false,
      fromMemory: false,
      settled: false,
    },
    {
      name: "a failed read: as before, its notice speaks",
      listing: {
        state: "failed",
        failure: { kind: "offline" },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      },
      held: NOTHING_HELD,
      remembered: REMEMBERED,
      rows: [],
      complete: false,
      fromMemory: false,
      settled: false,
    },
    {
      name: "its access lapsed: as before, the app's banner speaks",
      listing: { state: "withheld", reason: "access-lapsed", cause: null },
      held: NOTHING_HELD,
      remembered: REMEMBERED,
      rows: [],
      complete: false,
      fromMemory: false,
      settled: false,
    },
  ])("$name", ({ listing, held, remembered, rows, complete, fromMemory, settled }) => {
    const drawn = menuRowsOf(listing as Shown<ReadonlyArray<CandidateRow>>, held, remembered);
    expect(drawn.rows).toEqual(rows);
    expect(drawn.complete).toBe(complete);
    expect(drawn.fromMemory).toBe(fromMemory);
    expect(drawn.settled).toBe(settled);
  });
});

describe("the tree in this browser", () => {
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

  const keyOf = (user: string) => `mate:account:${user}:${MENU_SKELETON_STORAGE_KEY}`;

  it("is written per person and organization once the menu settles, and read back", () => {
    openAccountLifetime("user-ida");
    rememberMenuCandidates(ORG, [NOVA, KAI, PROD]);
    expect(stored.size).toBe(0);
    vi.advanceTimersByTime(400);
    expect(stored.has(keyOf("user-ida"))).toBe(true);
    expect(rememberedMenuCandidates(ORG)).toEqual([NOVA, KAI, PROD]);
    expect(rememberedMenuCandidates(OTHER_ORG)).toBeUndefined();
    expect(rememberedMenuCandidates(undefined)).toBeUndefined();
  });

  it("reads back after a reload from what was stored", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA, PROD], 1)) ?? "",
    );
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toEqual([NOVA, PROD]);
    // The same rows each draw: nothing re-renders for a memory that did not change.
    expect(rememberedMenuCandidates(ORG)).toBe(rememberedMenuCandidates(ORG));
  });

  it("reads nothing another person remembered on this browser", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA], 1)) ?? "",
    );
    openAccountLifetime("user-oto");
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
  });

  it("reads nothing before anybody is signed in", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA], 1)) ?? "",
    );
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toEqual([NOVA]);
  });

  it("reads nothing from a corrupt entry", () => {
    stored.set(keyOf("user-ida"), "{not a tree");
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
  });

  it("is gone when the account closes", () => {
    openAccountLifetime("user-ida");
    rememberMenuCandidates(ORG, [NOVA]);
    vi.advanceTimersByTime(400);
    closeAccountLifetime();
    expect(stored.has(keyOf("user-ida"))).toBe(false);
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
  });
});
