import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "../api.ts";
import type { Known } from "../knowledge/known.ts";
import type { CandidateRow } from "../projections/candidates.ts";
import type { RegistrationRecord } from "./records.ts";
import { containerTargetsOf, listTargets, type Absence, type ListedTarget } from "./targets.ts";
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
  readonly listings: ReadonlyArray<Known<ReadonlyArray<CandidateRow>>>;
  readonly records: ReadonlyArray<string>;
  /** The origin the records kept; `ORIGIN` unless a row says otherwise. */
  readonly origin?: string | null;
  /** The receipt ordinal each project's services were last read at directly. */
  readonly directReads?: ReadonlyArray<readonly [string, number]>;
  /** The absences before this evaluation. */
  readonly absences?: ReadonlyArray<readonly [TargetKey, Absence]>;
  readonly targets: ReadonlyArray<ListedTarget>;
  /** The absences after it. */
  readonly after?: ReadonlyArray<readonly [TargetKey, Absence]>;
  /** The targets whose confirming read it asks for. */
  readonly confirm?: ReadonlyArray<TargetKey>;
}

const REMEMBERED = { kind: "remembered", origin: ORIGIN } as const;
const GONE = { kind: "gone", evidence: "complete-scope-omits-verified" } as const;
const waiting = (past: number | null): Absence => ({ kind: "waiting", past });
const CONFIRMED: Absence = { kind: "confirmed" };

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
    name: "services not read yet after an omission: unknown, not remembered",
    listings: [known([unreadRow])],
    records: [OLD],
    absences: [[OLD, waiting(3)]],
    targets: [
      { key: project.id, presence: { kind: "unknown" }, record: null },
      { key: OLD, presence: { kind: "unknown" }, record: ENV },
    ],
  },
  {
    name: "projects still being read: a remembered Mate is looked for where its record kept it (A16)",
    listings: [{ state: "reading", sinceMs: 0, attempt: 1 }],
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
    name: "the project's services read without the remembered one: held, and a confirming read asked for",
    listings: [known([mateRow("ACTIVE")])],
    records: [OLD],
    directReads: [[project.id, 3]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: null, record: ENV },
    ],
    after: [[OLD, waiting(3)]],
    confirm: [OLD],
  },
  {
    name: "a direct read no newer than the omission holds it",
    listings: [known([mateRow("ACTIVE")])],
    records: [OLD],
    directReads: [[project.id, 3]],
    absences: [[OLD, waiting(3)]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: null, record: ENV },
    ],
    after: [[OLD, waiting(3)]],
  },
  {
    name: "a deleted service loses its Mate only after a confirming read",
    listings: [known([mateRow("ACTIVE")])],
    records: [OLD],
    directReads: [[project.id, 4]],
    absences: [[OLD, waiting(3)]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: GONE, record: ENV },
    ],
    after: [[OLD, CONFIRMED]],
  },
  {
    name: "an omission seen before any direct read waits past the first one, and asks again",
    listings: [known([mateRow("ACTIVE")])],
    records: [OLD],
    directReads: [[project.id, 1]],
    absences: [[OLD, waiting(null)]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: null, record: ENV },
    ],
    after: [[OLD, waiting(1)]],
    confirm: [OLD],
  },
  {
    name: "a confirmed absence stays gone and asks for no read",
    listings: [known([mateRow("ACTIVE")])],
    records: [OLD],
    directReads: [[project.id, 9]],
    absences: [[OLD, CONFIRMED]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: GONE, record: ENV },
    ],
    after: [[OLD, CONFIRMED]],
  },
  {
    name: "services not read yet hold a confirmed absence",
    listings: [known([unreadRow])],
    records: [OLD],
    absences: [[OLD, CONFIRMED]],
    targets: [
      { key: project.id, presence: { kind: "unknown" }, record: null },
      { key: OLD, presence: null, record: ENV },
    ],
    after: [[OLD, CONFIRMED]],
  },
  {
    name: "the service listed again ends its absence",
    listings: [known([mateRow("ACTIVE")])],
    records: [KEY],
    directReads: [[project.id, 4]],
    absences: [[KEY, CONFIRMED]],
    targets: [{ key: KEY, presence: { kind: "present", origin: ORIGIN }, record: ENV }],
  },
  {
    name: "a listing no longer settled holds the absence as it waits",
    listings: [known([mateRow("ACTIVE")], "partial")],
    records: [OLD],
    directReads: [[project.id, 4]],
    absences: [[OLD, waiting(3)]],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      { key: OLD, presence: null, record: ENV },
    ],
    after: [[OLD, waiting(3)]],
  },
];

describe("listTargets: region P from the listings and the records (§4.4, §9 C19)", () => {
  it.each(ROWS)("$name", (row) => {
    expect(
      listTargets({
        listings: row.listings,
        records: row.records.map((key) =>
          remembered(key, row.origin === undefined ? ORIGIN : row.origin),
        ),
        directReads: new Map(row.directReads ?? []),
        absences: new Map(row.absences ?? []),
      }),
    ).toEqual({
      targets: row.targets,
      absences: new Map(row.after ?? []),
      confirm: row.confirm ?? [],
    });
  });
});

describe("containerTargetsOf", () => {
  it("names each row's origin and platform statuses", () => {
    expect(containerTargetsOf([mateRow("ACTIVE"), unreadRow], [], null)).toEqual([
      { key: KEY, origin: ORIGIN, platform: { project: "ACTIVE", service: "ACTIVE" } },
      { key: project.id, origin: null, platform: { project: "ACTIVE", service: null } },
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
