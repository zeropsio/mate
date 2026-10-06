import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "../api.ts";
import type { Known } from "../knowledge/known.ts";
import type { CandidateRow } from "../projections/candidates.ts";
import type { Presence } from "./environmentMachine.ts";
import type { RegistrationRecord } from "./records.ts";
import { containerTargetsOf, listTargets, type ListedTarget } from "./targets.ts";
import type { TargetKey } from "./exchangeDriver.ts";

const ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";
const ENV = EnvironmentId.make("environment-1");
const KEY = "project-1:service-1";
/** A service of the project the platform no longer lists. */
const OLD = "project-1:old-service";

const project = { id: "project-1", name: "shop", status: "ACTIVE" } as ZeropsProject;

/** The project's Mate as the inventory read it. */
const mateRow = (status: string, origin: string | null = ORIGIN): CandidateRow => ({
  key: KEY,
  project,
  group: status === "ACTIVE" ? "ready" : "provisioning",
  service: { id: "service-1", name: "zcp", status },
  ...(origin === null ? {} : { containerOrigin: origin }),
  presence: "known",
});

/** The project's Mate ACTIVE without its address: its address being turned on, or off. */
const addressRow = (group: "provisioning" | "unavailable"): CandidateRow => ({
  key: KEY,
  project,
  group,
  service: { id: "service-1", name: "zcp", status: "ACTIVE" },
  ...(group === "provisioning" ? { addressAwaited: true as const } : {}),
  presence: "known",
});

/** The project whose services are not read yet: nothing is said of any Mate in it. */
const unreadRow: CandidateRow = {
  key: project.id,
  project,
  group: "unavailable",
  presence: "unknown",
};

const known = (
  rows: ReadonlyArray<CandidateRow>,
  coverage: "complete" | "partial" = "complete",
): Known<ReadonlyArray<CandidateRow>> => ({
  state: "known",
  value: rows,
  asOf: { ordinal: 1, atMs: 0 },
  coverage,
  freshness: { kind: "live" },
});

const remembered = (targetKey: string, origin: string | null = ORIGIN): RegistrationRecord => ({
  targetKey,
  environmentId: ENV,
  origin,
  projectRef: { projectId: "project-1", orgId: "org-1" },
  name: "shop",
});

interface Row {
  readonly name: string;
  /** Each organization's listing, `org-1` first; the records name `org-1`. */
  readonly listings: ReadonlyArray<Known<ReadonlyArray<CandidateRow>>>;
  readonly records: ReadonlyArray<string>;
  /** The origin the records kept; `ORIGIN` unless a row says otherwise. */
  readonly origin?: string | null;
  /** Each target's presence before this evaluation. */
  readonly last?: ReadonlyArray<readonly [TargetKey, Presence]>;
  readonly targets: ReadonlyArray<ListedTarget>;
}

const REMEMBERED = { kind: "remembered", origin: ORIGIN } as const;
const GONE = { kind: "gone", evidence: "complete-scope-omits-verified" } as const;

const ROWS: ReadonlyArray<Row> = [
  {
    name: "a listed Mate is present at its origin",
    listings: [known([mateRow("ACTIVE")])],
    records: [KEY],
    targets: [{ key: KEY, presence: { kind: "present", origin: ORIGIN }, record: ENV }],
  },
  {
    name: "a Mate restarting keeps its target, transitioning",
    listings: [known([mateRow("RESTARTING", null)])],
    records: [KEY],
    targets: [{ key: KEY, presence: { kind: "transitioning", status: "RESTARTING" }, record: ENV }],
  },
  {
    name: "a new Mate in its first build is on its way up, never inactive",
    listings: [known([mateRow("READY_TO_DEPLOY", null)])],
    records: [],
    targets: [
      { key: KEY, presence: { kind: "transitioning", status: "READY_TO_DEPLOY" }, record: null },
    ],
  },
  {
    name: "a young Mate ACTIVE before its address landed is on its way to it, never without one",
    listings: [known([addressRow("provisioning")])],
    records: [],
    targets: [{ key: KEY, presence: { kind: "address-pending" }, record: null }],
  },
  {
    name: "a Mate ACTIVE without an address past its wait has no public address",
    listings: [known([addressRow("unavailable")])],
    records: [KEY],
    targets: [{ key: KEY, presence: { kind: "no-origin", reason: "no-subdomain" }, record: ENV }],
  },
  {
    name: "services not read yet: a remembered Mate is looked for where its record kept it, never gone (A16)",
    listings: [known([unreadRow])],
    records: [KEY],
    targets: [
      { key: project.id, presence: { kind: "unknown" }, record: null },
      { key: KEY, presence: REMEMBERED, record: ENV },
    ],
  },
  {
    name: "services not read yet: a record that kept no origin says nothing of its Mate",
    listings: [known([unreadRow])],
    records: [KEY],
    origin: null,
    targets: [
      { key: project.id, presence: { kind: "unknown" }, record: null },
      { key: KEY, presence: { kind: "unknown" }, record: ENV },
    ],
  },
  {
    name: "projects still being read: a remembered Mate is looked for where its record kept it (A16)",
    listings: [{ state: "reading", sinceMs: 0, attempt: 1 }],
    records: [KEY],
    targets: [{ key: KEY, presence: REMEMBERED, record: ENV }],
  },
  {
    name: "its organization's complete listing lacks the project while another's is read: the last presence held",
    listings: [known([]), { state: "reading", sinceMs: 0, attempt: 1 }],
    records: [KEY],
    targets: [{ key: KEY, presence: null, record: ENV }],
  },
  {
    name: "its organization's complete listing lacks the project of a remembered Mate while another's is read: unknown, no longer looked for at its record's origin (A16)",
    listings: [known([]), { state: "reading", sinceMs: 0, attempt: 1 }],
    records: [KEY],
    last: [[KEY, REMEMBERED]],
    targets: [{ key: KEY, presence: { kind: "unknown" }, record: ENV }],
  },
  {
    name: "its organization's partial listing lacks the project of a remembered Mate while another's is read: held",
    listings: [known([], "partial"), { state: "reading", sinceMs: 0, attempt: 1 }],
    records: [KEY],
    last: [[KEY, REMEMBERED]],
    targets: [{ key: KEY, presence: null, record: ENV }],
  },
  {
    name: "its own organization's projects still being read beside another's complete listing: remembered (A16)",
    listings: [{ state: "reading", sinceMs: 0, attempt: 1 }, known([])],
    records: [KEY],
    targets: [{ key: KEY, presence: REMEMBERED, record: ENV }],
  },
  {
    name: "projects still being read hold the last presence of a record that kept no origin",
    listings: [{ state: "reading", sinceMs: 0, attempt: 1 }],
    records: [KEY],
    origin: null,
    targets: [{ key: KEY, presence: null, record: ENV }],
  },
  {
    name: "a listing that failed holds the last presence",
    listings: [
      {
        state: "failed",
        failure: { kind: "offline" },
        atMs: 0,
        attempt: 1,
        retryAtMs: null,
      },
    ],
    records: [KEY],
    targets: [{ key: KEY, presence: null, record: ENV }],
  },
  {
    name: "a partial listing that lacks the project holds the last presence",
    listings: [known([], "partial")],
    records: [KEY],
    targets: [{ key: KEY, presence: null, record: ENV }],
  },
  {
    name: "a complete listing that lacks the project: gone",
    listings: [known([])],
    records: [KEY],
    targets: [
      {
        key: KEY,
        presence: { kind: "gone", evidence: "complete-scope-omits-verified" },
        record: ENV,
      },
    ],
  },
  {
    name: "the organization's complete services listing without the remembered one: gone",
    listings: [known([mateRow("ACTIVE")])],
    records: [OLD],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: GONE, record: ENV },
    ],
  },
  {
    name: "the project's services read without a remembered one while a listing is partial: unknown (A16)",
    listings: [known([mateRow("ACTIVE")], "partial")],
    records: [OLD],
    last: [[OLD, REMEMBERED]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: { kind: "unknown" }, record: ENV },
    ],
  },
  {
    name: "the project's services read without a Mate last present while a listing is partial: held",
    listings: [known([mateRow("ACTIVE")], "partial")],
    records: [OLD],
    last: [[OLD, { kind: "present", origin: ORIGIN }]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: null, record: ENV },
    ],
  },
];

describe("listTargets: region P from the listings and the records (§4.4, §9 C19)", () => {
  it.each(ROWS)("$name", (row) => {
    expect(
      listTargets({
        listings: row.listings.map((listing, index) => ({
          organizationId: `org-${index + 1}`,
          listing,
        })),
        records: row.records.map((key) =>
          remembered(key, row.origin === undefined ? ORIGIN : row.origin),
        ),
        lastPresence: (key) => new Map(row.last ?? []).get(key) ?? null,
      }),
    ).toEqual({ targets: row.targets });
  });
});

describe("listTargets: a record is gone only on its own organization's word", () => {
  it.each([
    { name: "no listing at all (no organization chosen, or none read)", listings: [] },
    {
      name: "only another organization's listing, complete",
      listings: [{ organizationId: "org-2", listing: known([]) }],
    },
  ])("$name: kept where its record kept it", ({ listings }) => {
    const listed = listTargets({
      listings,
      records: [remembered(KEY)],
      lastPresence: () => null,
    });
    expect(listed.targets).toEqual([{ key: KEY, presence: REMEMBERED, record: ENV }]);
  });
});

describe("containerTargetsOf", () => {
  it("names each row's origin and platform statuses", () => {
    expect(containerTargetsOf([mateRow("ACTIVE"), unreadRow], [], null)).toEqual([
      { key: KEY, origin: ORIGIN, platform: { project: "ACTIVE", service: "ACTIVE" } },
      { key: project.id, origin: null, platform: { project: "ACTIVE", service: null } },
    ]);
  });

  it("carries when the row's container was made, for its first build's wait", () => {
    const made = "2026-10-02T10:00:00.000Z";
    const row: CandidateRow = {
      ...mateRow("READY_TO_DEPLOY", null),
      service: { id: "service-1", name: "zcp", status: "READY_TO_DEPLOY", created: made },
    };
    expect(containerTargetsOf([row], [], null)).toEqual([
      {
        key: KEY,
        origin: null,
        platform: { project: "ACTIVE", service: "READY_TO_DEPLOY", serviceCreated: made },
      },
    ]);
  });

  it("reads a remembered Mate of a listed project at its record's origin, the route's first (A16)", () => {
    const other = { id: "project-2", name: "blog", status: "ACTIVE" } as ZeropsProject;
    const otherOrigin = "https://zcp-9f1a-8080.prg1.zerops.app";
    const otherKey = "project-2:service-2";
    const unlistedKey = "project-3:service-3";
    const targets: ReadonlyArray<ListedTarget> = [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: otherKey, presence: { kind: "remembered", origin: otherOrigin }, record: ENV },
      // No listing names its project yet: the platform has said nothing of its container.
      { key: unlistedKey, presence: { kind: "remembered", origin: otherOrigin }, record: ENV },
    ];
    const otherUnread: CandidateRow = { ...unreadRow, key: other.id, project: other };

    expect(containerTargetsOf([mateRow("ACTIVE"), otherUnread], targets, otherKey)).toEqual([
      { key: otherKey, origin: otherOrigin, platform: { project: "ACTIVE", service: null } },
      { key: KEY, origin: ORIGIN, platform: { project: "ACTIVE", service: "ACTIVE" } },
      { key: other.id, origin: null, platform: { project: "ACTIVE", service: null } },
    ]);
  });
});
