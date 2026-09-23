import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "../api.ts";
import type { Known } from "../knowledge/known.ts";
import type { CandidateRow } from "../projections/candidates.ts";
import type { RegistrationRecord } from "./records.ts";
import { containerTargetsOf, listTargets, type ListedTarget } from "./targets.ts";

const ORIGIN = "https://zcp-24cb-8080.prg1.zerops.app";
const ENV = EnvironmentId.make("environment-1");
const KEY = "project-1:service-1";

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

const remembered = (targetKey: string): RegistrationRecord => ({
  targetKey,
  environmentId: ENV,
  origin: ORIGIN,
  projectRef: { projectId: "project-1", orgId: "org-1" },
  name: "shop",
});

interface Row {
  readonly name: string;
  readonly listings: ReadonlyArray<Known<ReadonlyArray<CandidateRow>>>;
  readonly records: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<ListedTarget>;
}

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
    name: "services not read yet: every Mate of the project is unknown, never gone",
    listings: [known([unreadRow])],
    records: [KEY],
    targets: [
      { key: project.id, presence: { kind: "unknown" }, record: null },
      { key: KEY, presence: { kind: "unknown" }, record: ENV },
    ],
  },
  {
    name: "a listing still being read holds the last presence",
    listings: [{ state: "reading", sinceMs: 0, attempt: 1 }],
    records: [KEY],
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
    name: "the project's services read without the remembered one: gone",
    listings: [known([mateRow("ACTIVE")])],
    records: ["project-1:old-service"],
    targets: [
      { key: KEY, presence: { kind: "present", origin: ORIGIN }, record: null },
      {
        key: "project-1:old-service",
        presence: { kind: "gone", evidence: "complete-scope-omits-verified" },
        record: ENV,
      },
    ],
  },
];

describe("listTargets: region P from the listings and the records (§4.4)", () => {
  it.each(ROWS)("$name", ({ listings, records, targets }) => {
    expect(listTargets({ listings, records: records.map(remembered) })).toEqual(targets);
  });
});

describe("containerTargetsOf", () => {
  it("names each row's origin and platform statuses", () => {
    expect(containerTargetsOf([mateRow("ACTIVE"), unreadRow])).toEqual([
      { key: KEY, origin: ORIGIN, platform: { project: "ACTIVE", service: "ACTIVE" } },
      { key: project.id, origin: null, platform: { project: "ACTIVE", service: null } },
    ]);
  });
});
