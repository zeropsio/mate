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
  MENU_SKELETON_VISIT_MS,
  menuRowsOf,
  menuSkeletonSnapshot,
  onMenuSkeletonChange,
  menuWiring,
  projectOpenedIn,
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
interface DrawCase {
  readonly name: string;
  readonly listing: unknown;
  readonly held?: HeldCandidates<CandidateRow>;
  readonly memory?: ReadonlyArray<CandidateRow> | null;
  readonly current?: boolean;
  readonly graceOver?: boolean;
  readonly whole?: boolean;
  readonly rows: ReadonlyArray<CandidateRow>;
  readonly complete?: boolean;
  readonly fromMemory?: boolean;
  readonly toRemember?: ReadonlyArray<CandidateRow> | null;
}
const asRemembered = (row: CandidateRow) => candidateOfSkeleton(skeletonRowOf(row));

describe("a remembered row", () => {
  // A Mate linked when it was drawn is remembered as one whose link is not made yet: whether it
  // is linked now is its socket's to say, never the memory's.
  it("remembers a connected Mate as not linked yet", () => {
    expect(candidateOfSkeleton(skeletonRowOf(NOVA))).toEqual({ ...UNLINKED_NOVA, group: "ready" });
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

describe("the rows the menu draws while it reads", () => {
  const remembered = (row: CandidateRow) => candidateOfSkeleton(skeletonRowOf(row));
  const [R_NOVA, R_KAI, R_PROD] = [NOVA, KAI, PROD].map(remembered) as [
    CandidateRow,
    CandidateRow,
    CandidateRow,
  ];
  const REMEMBERED = [R_NOVA, R_KAI, R_PROD];
  const LUNA = mate("luna", { group: "ready" });
  const unknownKai: CandidateRow = {
    key: "kai",
    group: "unavailable",
    presence: "unknown",
    project: KAI.project,
  };
  const READING = { state: "reading", sinceMs: 0, attempt: 1 };
  const FAILED = {
    state: "failed",
    failure: { kind: "offline" },
    atMs: 0,
    attempt: 1,
    retryAtMs: 2_000,
  };

  const DRAWS: ReadonlyArray<DrawCase> = [
    {
      name: "unread, a tree remembered: the tree",
      listing: { state: "unread", waitingFor: null },
      rows: REMEMBERED,
      fromMemory: true,
    },
    { name: "being read, a tree remembered: the tree", listing: READING, rows: REMEMBERED },
    {
      name: "waiting on the Zerops session, a tree remembered: the tree",
      listing: { state: "unread", waitingFor: "zerops-session" },
      rows: REMEMBERED,
    },
    {
      name: "its access not verified yet, a tree remembered: the tree",
      listing: { state: "withheld", reason: "access-unverified", cause: null },
      rows: REMEMBERED,
    },
    // A first read that keeps failing never takes the tree back between its retries: its notice
    // stands under the rows instead.
    {
      name: "its read failed, a tree remembered: the tree still",
      listing: FAILED,
      rows: REMEMBERED,
    },
    {
      name: "being read, nothing remembered: nothing, as before",
      listing: READING,
      memory: null,
      rows: [],
      fromMemory: false,
    },
    {
      name: "being read, an empty tree remembered: nothing",
      listing: READING,
      memory: [],
      rows: [],
      fromMemory: false,
    },
    {
      name: "its access lapsed: as before, the app's banner speaks",
      listing: { state: "withheld", reason: "access-lapsed", cause: null },
      rows: [],
      fromMemory: false,
    },
    {
      name: "known and whole: the listing's own rows, the memory replaced",
      listing: known([NOVA, PROD], "complete"),
      held: heldOf([NOVA, PROD], true),
      rows: [NOVA, PROD],
      complete: true,
      fromMemory: false,
      toRemember: [NOVA, PROD],
    },
    {
      name: "known whole, a container not read yet: that row as remembered",
      listing: known([NOVA, unknownKai], "complete"),
      held: heldOf([NOVA, unknownKai], false),
      rows: [NOVA, R_KAI],
      toRemember: [NOVA, R_KAI],
    },
    {
      name: "known whole, a container never read past its grace: its own row, the rest remembered",
      listing: known([NOVA, unknownKai], "complete"),
      held: heldOf([NOVA, unknownKai], false),
      graceOver: true,
      rows: [NOVA, unknownKai],
      fromMemory: false,
      toRemember: [NOVA, R_KAI],
    },
    {
      name: "known whole, a container not read and not remembered: its own row, not remembered",
      listing: known([NOVA, unknownKai], "complete"),
      held: heldOf([NOVA, unknownKai], false),
      memory: [remembered(NOVA)],
      rows: [NOVA, unknownKai],
      fromMemory: false,
      toRemember: [NOVA],
    },
    {
      name: "known whole: a project it lacks is gone, never filled from memory",
      listing: known([NOVA], "complete"),
      held: heldOf([NOVA], true),
      rows: [NOVA],
      complete: true,
      fromMemory: false,
      toRemember: [NOVA],
    },
    // Known in part: what it holds, and the projects it does not hold yet as remembered — none
    // vanishes to come back — and nothing remembered of a part.
    {
      name: "known in part, every row it holds read: its rows and the rest remembered",
      listing: known([NOVA, LUNA], "partial"),
      held: heldOf([NOVA, LUNA], false),
      rows: [NOVA, LUNA, R_KAI, R_PROD],
    },
    {
      name: "known in part, a container not read yet: that row as remembered",
      listing: known([NOVA, unknownKai], "partial"),
      held: heldOf([NOVA, unknownKai], false),
      rows: [NOVA, R_KAI, R_PROD],
    },
    {
      name: "known in part with no row yet: the tree",
      listing: known([], "partial"),
      held: heldOf([], false),
      rows: REMEMBERED,
    },
    // Past its grace a part is what there is: a project withheld for good, or never read, is not
    // painted from memory for ever.
    {
      name: "known in part with no row past its grace: nothing",
      listing: known([], "partial"),
      held: heldOf([], false),
      graceOver: true,
      rows: [],
      fromMemory: false,
    },
    {
      name: "known in part past its grace: its own rows only",
      listing: known([NOVA, unknownKai], "partial"),
      held: heldOf([NOVA, unknownKai], false),
      graceOver: true,
      rows: [NOVA, unknownKai],
      fromMemory: false,
    },
    // An organization just switched to: the listing still holds the last one's rows for a
    // moment. They are neither drawn as its nor remembered under it.
    {
      name: "the listing still the last organization's: this one's tree, nothing remembered",
      listing: known([LUNA], "complete"),
      held: heldOf([LUNA], true),
      current: false,
      rows: REMEMBERED,
    },
    {
      name: "the listing still the last organization's, nothing remembered: nothing of it",
      listing: known([LUNA], "complete"),
      held: heldOf([LUNA], true),
      current: false,
      memory: null,
      rows: [],
      fromMemory: false,
    },
    // A failed read that will not run again on its own holds the tree for the grace, then gives
    // way to its notice alone.
    {
      name: "its read failed for good, within its grace: the tree",
      listing: { ...FAILED, retryAtMs: null },
      rows: REMEMBERED,
    },
    {
      name: "its read failed for good, past its grace: nothing, its notice speaks",
      listing: { ...FAILED, retryAtMs: null },
      graceOver: true,
      rows: [],
      fromMemory: false,
    },
    {
      name: "its read failed and will retry, past any grace: the tree still",
      listing: FAILED,
      graceOver: true,
      rows: REMEMBERED,
    },
    // Whole for this person though not complete — every project it lacks is one they can never
    // see: remembered, and no project it lacks is filled from memory.
    {
      name: "known in part but whole for this person: its rows, remembered",
      listing: known([NOVA], "partial"),
      held: heldOf([NOVA], false),
      whole: true,
      rows: [NOVA],
      fromMemory: false,
      toRemember: [NOVA],
    },
    {
      name: "whole for this person, a container not read yet: that row as remembered, remembered",
      listing: known([NOVA, unknownKai], "partial"),
      held: heldOf([NOVA, unknownKai], false),
      whole: true,
      rows: [NOVA, R_KAI],
      toRemember: [NOVA, R_KAI],
    },
  ];

  it.each(DRAWS)(
    "$name",
    ({
      listing,
      held = NOTHING_HELD,
      memory = REMEMBERED,
      current = true,
      graceOver = false,
      whole = false,
      rows,
      complete = false,
      fromMemory = true,
      toRemember = null,
    }) => {
      const drawn = menuRowsOf({
        listing: listing as Shown<ReadonlyArray<CandidateRow>>,
        held,
        remembered: memory ?? undefined,
        current,
        graceOver,
        whole,
      });
      expect(drawn.rows).toEqual(rows);
      expect(drawn.complete).toBe(complete);
      expect(drawn.fromMemory).toBe(fromMemory);
      expect(drawn.toRemember).toEqual(toRemember);
    },
  );

  it("holds the same rows through a failing first read's retries", () => {
    const draws = [FAILED, READING, FAILED, READING].map(
      (listing) =>
        menuRowsOf({
          listing: listing as Shown<ReadonlyArray<CandidateRow>>,
          held: NOTHING_HELD,
          remembered: REMEMBERED,
          current: true,
          graceOver: false,
          whole: false,
        }).rows,
    );
    for (const rows of draws) expect(rows).toBe(REMEMBERED);
  });
});

describe("the menu's wiring: which organization the listing is, and its grace", () => {
  const known = { state: "known" } as const;
  const failedForGood = { state: "failed", retryAtMs: null } as const;
  it.each([
    {
      name: "the listing the organization's in view, known in part: its own grace",
      session: ORG,
      listingOf: ORG,
      listing: known,
      complete: false,
      wiring: { current: true, rememberUnder: ORG, graceKey: `${ORG}:known` },
    },
    {
      name: "known whole: no grace",
      session: ORG,
      listingOf: ORG,
      listing: known,
      complete: true,
      wiring: { current: true, rememberUnder: ORG, graceKey: null },
    },
    {
      name: "switched, the listing still the last organization's: not current, nothing kept",
      session: OTHER_ORG,
      listingOf: ORG,
      listing: known,
      complete: false,
      wiring: { current: false, rememberUnder: null, graceKey: null },
    },
    {
      name: "switched, its own listing known in part: a grace of its own",
      session: OTHER_ORG,
      listingOf: OTHER_ORG,
      listing: known,
      complete: false,
      wiring: { current: true, rememberUnder: OTHER_ORG, graceKey: `${OTHER_ORG}:known` },
    },
    {
      name: "a read failed for good: its grace",
      session: ORG,
      listingOf: ORG,
      listing: failedForGood,
      complete: false,
      wiring: { current: true, rememberUnder: ORG, graceKey: `${ORG}:failed` },
    },
    {
      name: "a read failed that will retry: no grace",
      session: ORG,
      listingOf: ORG,
      listing: { state: "failed", retryAtMs: 5_000 },
      complete: false,
      wiring: { current: true, rememberUnder: ORG, graceKey: null },
    },
    {
      name: "nobody's organization yet",
      session: undefined,
      listingOf: undefined,
      listing: { state: "reading" },
      complete: false,
      wiring: { current: false, rememberUnder: null, graceKey: null },
    },
  ])("$name", ({ session, listingOf, listing, complete, wiring }) => {
    expect(
      menuWiring({
        organizationId: session,
        listingOrganizationId: listingOf,
        listing: listing as Shown<ReadonlyArray<CandidateRow>>,
        complete,
      }),
    ).toEqual(wiring);
  });

  // Two known listings in part, one organization after the other: the second starts its own
  // grace, never the first's carried over.
  it("gives each organization's partial listing its own grace across a switch", () => {
    const partial = { state: "known" } as unknown as Shown<ReadonlyArray<CandidateRow>>;
    const keys = [
      { organizationId: ORG, listingOrganizationId: ORG },
      { organizationId: OTHER_ORG, listingOrganizationId: ORG },
      { organizationId: OTHER_ORG, listingOrganizationId: OTHER_ORG },
    ].map((ids) => menuWiring({ ...ids, listing: partial, complete: false }).graceKey);
    expect(keys).toEqual([`${ORG}:known`, null, `${OTHER_ORG}:known`]);
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
    expect(rememberedMenuCandidates(ORG)).toEqual([NOVA, KAI, PROD].map(asRemembered));
    expect(rememberedMenuCandidates(OTHER_ORG)).toBeUndefined();
    expect(rememberedMenuCandidates(undefined)).toBeUndefined();
  });

  it("reads back after a reload from what was stored", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA, PROD], 1)) ?? "",
    );
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toEqual([NOVA, PROD].map(asRemembered));
    // The same rows each draw: nothing re-renders for a memory that did not change.
    expect(rememberedMenuCandidates(ORG)).toBe(rememberedMenuCandidates(ORG));
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
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
  });

  it("reads nothing before anybody is signed in", () => {
    stored.set(
      keyOf("user-ida"),
      encodeMenuSkeleton(withOrganizationSkeleton(EMPTY_MENU_SKELETON, ORG, [NOVA], 1)) ?? "",
    );
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toEqual([asRemembered(NOVA)]);
  });

  it("reads nothing from a corrupt entry", () => {
    stored.set(keyOf("user-ida"), "{not a tree");
    openAccountLifetime("user-ida");
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
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
    expect(rememberedMenuCandidates(ORG)).toBeUndefined();
  });
});
