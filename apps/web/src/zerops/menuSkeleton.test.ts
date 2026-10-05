import { EnvironmentId } from "@t3tools/contracts";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  decodeMenuSkeleton,
  EMPTY_MENU_SKELETON,
  encodeMenuSkeleton,
  MENU_SKELETON_MAX_BYTES,
  MENU_SKELETON_MAX_ORGANIZATIONS,
  MENU_SKELETON_MAX_ROWS,
  MENU_SKELETON_STORAGE_KEY,
  MENU_SKELETON_VISIT_MS,
  menuSkeletonSnapshot,
  onMenuSkeletonChange,
  projectOpenedIn,
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
    tagList: ["mate", "garden"],
  },
  ...overrides,
});

const NOVA = mate("nova");
const { environmentId: _novaLinked, ...UNLINKED_NOVA } = NOVA;
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
    tagList: ["garden"],
    userRoles: [{ clientUserId: "cu-ida", roleCode: "OWNER" }],
  },
};

/** The organization's rows as this browser remembers them, by key. */
const rememberedKeys = (organizationId: string) =>
  menuSkeletonSnapshot().organizations[organizationId]?.rows.map((row) => row.key);

describe("a remembered row", () => {
  // A Mate linked when it was drawn is remembered as one whose link is not made yet: whether it
  // is linked now is its socket's to say, never the memory's.
  it("remembers a connected Mate as not linked yet, with the environment it opened in", () => {
    const row = skeletonRowOf(NOVA);
    expect(row.group).toBe("ready");
    expect(row.openedIn).toBe("env-nova");
    expect(row).not.toHaveProperty("environmentId");
  });

  it.each([
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
  ])("reads $name back as it was written", ({ row }) => {
    const skeleton = withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [row], 1);
    expect(decodeMenuSkeleton(encodeMenuSkeleton(skeleton))).toEqual(skeleton);
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

  it("rewrites nothing when only a Mate's link came or went", () => {
    const first = withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA, KAI], 1);
    const unlinked = { ...UNLINKED_NOVA, group: "ready" as const };
    expect(withOrganizationSkeleton(first, ORG, [unlinked, KAI], 2)).toBe(first);
  });

  // Which Mate a conversation is open in is kept, only to say which row is open: the open row
  // keeps its highlight through a reload, whether or not its link was made when it was drawn.
  it("knows which remembered Mate an environment opened, after its link went too", () => {
    const first = withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA, KAI], 1);
    const unlinked = { ...UNLINKED_NOVA, group: "ready" as const };
    const after = withOrganizationSkeleton(first, ORG, [unlinked, KAI], 2);
    expect(projectOpenedIn(after, ORG, EnvironmentId.make("env-nova"))).toBe("nova");
    expect(projectOpenedIn(after, ORG, EnvironmentId.make("env-kai"))).toBeUndefined();
    expect(projectOpenedIn(after, OTHER_ORG, EnvironmentId.make("env-nova"))).toBeUndefined();
  });

  // An organization visited every day is never the oldest: its visit keeps it, rows unchanged.
  it("marks an organization visited when its tree is drawn again a while later", () => {
    const first = withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA], 1);
    expect(withOrganizationSkeleton(first, ORG, [NOVA], 1 + MENU_SKELETON_VISIT_MS / 2)).toBe(
      first,
    );
    const later = withOrganizationSkeleton(first, ORG, [NOVA], 1 + MENU_SKELETON_VISIT_MS);
    expect(later.organizations[ORG]?.at).toBe(1 + MENU_SKELETON_VISIT_MS);
    expect(later.organizations[ORG]?.rows).toBe(first.organizations[ORG]?.rows);
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
    expect(rememberedKeys(ORG)).toEqual([NOVA.key, KAI.key, PROD.key]);
    expect(rememberedKeys(OTHER_ORG)).toBeUndefined();
  });

  it("reads back after a reload from what was stored", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA, PROD], 1)) ?? "",
    );
    openAccountLifetime("user-ida");
    expect(rememberedKeys(ORG)).toEqual([NOVA.key, PROD.key]);
    // The same memory each read: nothing re-renders for a memory that did not change.
    expect(menuSkeletonSnapshot()).toBe(menuSkeletonSnapshot());
  });

  it("knows which remembered Mate an environment opened", () => {
    openAccountLifetime("user-ida");
    rememberMenuCandidates(ORG, [NOVA, KAI]);
    const skeleton = menuSkeletonSnapshot();
    expect(projectOpenedIn(skeleton, ORG, EnvironmentId.make("env-nova"))).toBe("nova");
    expect(projectOpenedIn(skeleton, OTHER_ORG, EnvironmentId.make("env-nova"))).toBeUndefined();
  });

  // Two tabs of one account, each in its own organization: neither writes the other's tree away.
  it("keeps what another tab remembered meanwhile, replacing only its own organization", () => {
    openAccountLifetime("user-ida");
    rememberMenuCandidates(ORG, [NOVA]);
    vi.advanceTimersByTime(400);
    // The other tab, in the other organization, writes its tree after this one read the memory.
    const theirs = decodeMenuSkeleton(stored.get(keyOf("user-ida")) ?? null);
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(theirs, OTHER_ORG, [KAI], 2)) ?? "",
    );
    rememberMenuCandidates(ORG, [NOVA, PROD]);
    vi.advanceTimersByTime(400);
    const both = decodeMenuSkeleton(stored.get(keyOf("user-ida")) ?? null);
    expect(both.organizations[ORG]?.rows.map((row) => row.key)).toEqual([NOVA.key, PROD.key]);
    expect(both.organizations[OTHER_ORG]?.rows.map((row) => row.key)).toEqual([KAI.key]);
  });

  it("reads nothing another person remembered on this browser", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA], 1)) ?? "",
    );
    openAccountLifetime("user-oto");
    expect(rememberedKeys(ORG)).toBeUndefined();
  });

  it("reads nothing before anybody is signed in", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA], 1)) ?? "",
    );
    expect(rememberedKeys(ORG)).toBeUndefined();
    openAccountLifetime("user-ida");
    expect(rememberedKeys(ORG)).toEqual([NOVA.key]);
  });

  it("reads nothing from a corrupt entry", () => {
    stored.set(keyOf("user-ida"), "{not a tree");
    openAccountLifetime("user-ida");
    expect(rememberedKeys(ORG)).toBeUndefined();
  });

  it("writes every organization drawn within one settling moment", () => {
    openAccountLifetime("user-ida");
    rememberMenuCandidates(ORG, [NOVA]);
    vi.advanceTimersByTime(200);
    rememberMenuCandidates(OTHER_ORG, [KAI]);
    vi.advanceTimersByTime(400);
    const both = decodeMenuSkeleton(stored.get(keyOf("user-ida")) ?? null);
    expect(Object.keys(both.organizations).toSorted()).toEqual([OTHER_ORG, ORG].toSorted());
  });

  // What reads the memory hears when it changes: the open row's highlight follows a write.
  it("tells its readers of each change, with a new snapshot, and of none without one", () => {
    openAccountLifetime("user-ida");
    let heard = 0;
    const stop = onMenuSkeletonChange(() => {
      heard += 1;
    });
    const before = menuSkeletonSnapshot();
    rememberMenuCandidates(ORG, [NOVA]);
    const after = menuSkeletonSnapshot();
    expect(after).not.toBe(before);
    expect(heard).toBe(1);
    expect(projectOpenedIn(after, ORG, EnvironmentId.make("env-nova"))).toBe("nova");
    rememberMenuCandidates(ORG, [NOVA]);
    expect(menuSkeletonSnapshot()).toBe(after);
    expect(heard).toBe(1);
    stop();
  });

  it("is gone when the account closes", () => {
    openAccountLifetime("user-ida");
    rememberMenuCandidates(ORG, [NOVA]);
    vi.advanceTimersByTime(400);
    closeAccountLifetime();
    expect(stored.has(keyOf("user-ida"))).toBe(false);
    openAccountLifetime("user-ida");
    expect(rememberedKeys(ORG)).toBeUndefined();
  });
});
