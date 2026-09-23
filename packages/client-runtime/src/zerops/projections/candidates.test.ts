import { describe, expect, it } from "@effect/vitest";

import type { Known } from "../knowledge/known.ts";
import type { FacetAdmission, ProjectRecord, ProjectRef, ServiceRecord } from "../data/types.ts";
import { project, service, stamp } from "../data/__fixtures__/index.ts";
import type { ZeropsCandidate } from "../candidates.ts";
import {
  admittedOnly,
  candidateMembers,
  candidatesComplete,
  listsNoProject,
  presentCandidates,
  selectCandidates,
} from "./candidates.ts";

const admission: FacetAdmission = {
  lastNativeReceiptOrdinal: null,
  lastAppliedAuthoritativeDispatchOrdinal: null,
  hasAuthoritativeObservation: true,
};

const observed = <Fields>(fields: Fields) => ({
  knowledge: "observed" as const,
  fields,
  unresolvedRequiredFields: [] as const,
  source: "direct-read" as const,
  stamp: stamp(1),
  admission,
});

function projectRecord(id = "project-1", status = "ACTIVE"): ProjectRecord {
  return {
    ref: project(id),
    identity: observed({ name: id, createdAt: null }),
    lifecycle: observed({ status }),
    presentation: observed({ tags: [], description: null }),
    placement: observed({
      publicZone: "fte2334ab.prg1-zerops.zone",
      zeropsSubdomainHost: "24cb",
      mode: "LIGHT" as const,
    }),
  };
}

function zcpRecord(owner: ProjectRef): ServiceRecord {
  return {
    ref: service("service-1", owner),
    identity: observed({
      hostname: "zcp",
      type: { versionName: "zcp@1", displayName: "Zerops Mate", category: "runtime" },
    }),
    lifecycle: observed({ status: "ACTIVE", createdAt: null, updatedAt: null }),
    routing: observed({
      subdomainAccess: true,
      ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
    }),
    deployment: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
    scaling: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
  };
}

const known = <T>(value: T, coverage: "complete" | "partial" = "complete"): Known<T> => ({
  state: "known",
  value,
  asOf: { ordinal: 4, atMs: 40 },
  coverage,
  freshness: { kind: "live" },
});

describe("selectCandidates", () => {
  it("marks a candidate whose service the inventory has not read as presence unknown", () => {
    const selected = selectCandidates(known([projectRecord()]), () => ({
      state: "unread",
      waitingFor: null,
    }));

    expect(selected).toMatchObject({
      state: "known",
      value: [{ key: "project-1", project: { id: "project-1" }, presence: "unknown" }],
    });
  });

  it("says nothing negative of a row whose presence is unknown: no reason, no missing container", () => {
    const selected = selectCandidates(known([projectRecord()]), () => ({
      state: "unread",
      waitingFor: null,
    }));

    expect(selected).toMatchObject({ state: "known" });
    const [row] = selected.state === "known" ? selected.value : [];
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("reason");
    expect(row).not.toHaveProperty("missingContainer");
  });

  const unread = (): Known<ReadonlyArray<ServiceRecord>> => ({ state: "unread", waitingFor: null });

  it.each<{
    readonly name: string;
    readonly services: Known<ReadonlyArray<ServiceRecord>>;
    readonly row: object;
  }>([
    {
      name: "a services read that failed leaves presence unknown",
      services: {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 30,
        attempt: 1,
        retryAtMs: 90,
      },
      row: { key: "project-1", presence: "unknown" },
    },
    {
      name: "a partial services listing with no zcp container read leaves presence unknown",
      services: known([], "partial"),
      row: { key: "project-1", presence: "unknown" },
    },
    {
      name: "a partial services listing that holds a zcp container is present at its origin",
      services: known([zcpRecord(project())], "partial"),
      row: {
        key: "project-1:service-1",
        group: "ready",
        containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
        presence: "known",
      },
    },
    {
      name: "a complete listing with a zcp container is present at its origin, not connected",
      services: known([zcpRecord(project())]),
      row: {
        key: "project-1:service-1",
        group: "ready",
        containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
        presence: "known",
      },
    },
    {
      name: "a complete listing without one is a known missing container",
      services: known([]),
      row: { key: "project-1", group: "unavailable", missingContainer: true, presence: "known" },
    },
  ])("an active project: $name", ({ services, row }) => {
    const selected = selectCandidates(known([projectRecord()]), () => services);

    expect(selected).toMatchObject({ state: "known", value: [row] });
    expect(selected).not.toMatchObject({ value: [{ environmentId: expect.anything() }] });
  });

  it("a project that is not active needs no services read to be known", () => {
    expect(selectCandidates(known([projectRecord("project-1", "STOPPED")]), unread)).toMatchObject({
      state: "known",
      value: [{ group: "unavailable", reason: "project is STOPPED", presence: "known" }],
    });
  });

  it.each<{ readonly name: string; readonly projects: Known<ReadonlyArray<ProjectRecord>> }>([
    { name: "unread", projects: { state: "unread", waitingFor: "access-grant" } },
    { name: "reading", projects: { state: "reading", sinceMs: 10, attempt: 1 } },
    {
      name: "failed",
      projects: {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 30,
        attempt: 2,
        retryAtMs: 90,
      },
    },
  ])("projects $name give no rows, never an empty list", ({ projects }) => {
    expect(selectCandidates(projects, unread)).toEqual(projects);
  });

  it("keeps the projects' stamp, freshness and coverage", () => {
    const projects: Known<ReadonlyArray<ProjectRecord>> = {
      state: "known",
      value: [],
      asOf: { ordinal: 7, atMs: 70 },
      coverage: "complete",
      freshness: { kind: "paused", by: "background" },
    };

    expect(selectCandidates(projects, unread)).toEqual(projects);
  });

  it("leaves out a project whose status is not read, and is then partial", () => {
    const pending: ProjectRecord = {
      ...projectRecord("project-2"),
      lifecycle: { knowledge: "unresolved", fields: {}, unresolvedRequiredFields: [], admission },
    };

    expect(selectCandidates(known([pending, projectRecord()]), unread)).toMatchObject({
      state: "known",
      value: [{ key: "project-1" }],
      coverage: "partial",
    });
  });

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<ProjectRecord>>;
    readonly services: Known<ReadonlyArray<ServiceRecord>>;
    readonly complete: boolean;
  }>([
    {
      name: "a complete listing whose every presence is known",
      listing: known([projectRecord()]),
      services: known([zcpRecord(project())]),
      complete: true,
    },
    {
      name: "a row whose presence is unknown",
      listing: known([projectRecord()]),
      services: unread(),
      complete: false,
    },
    {
      name: "a partial listing",
      listing: known([projectRecord()], "partial"),
      services: known([zcpRecord(project())]),
      complete: false,
    },
    {
      name: "an unread listing",
      listing: { state: "unread", waitingFor: null },
      services: unread(),
      complete: false,
    },
  ])("may say none of what the rows lack only over $name: $complete", (row) => {
    expect(candidatesComplete(selectCandidates(row.listing, () => row.services))).toBe(
      row.complete,
    );
  });
});

const notHeld: ReadonlyArray<{
  readonly name: string;
  readonly listing: Known<ReadonlyArray<ZeropsCandidate>>;
}> = [
  { name: "unread", listing: { state: "unread", waitingFor: null } },
  { name: "being read", listing: { state: "reading", sinceMs: 10, attempt: 1 } },
  {
    name: "failed",
    listing: {
      state: "failed",
      failure: { kind: "transport", detail: "gateway" },
      atMs: 10,
      attempt: 1,
      retryAtMs: 90,
    },
  },
  {
    name: "gone",
    listing: { state: "gone", evidence: "direct-forbidden", asOf: { ordinal: 2, atMs: 20 } },
  },
];

const candidate = (id: string, tagList: ReadonlyArray<string> = []): ZeropsCandidate => ({
  key: id,
  project: { id, name: id, status: "ACTIVE", tagList },
  group: "unavailable",
});

describe("presentCandidates", () => {
  it("presents a known listing's rows and keeps its stamp, coverage and freshness", () => {
    const listing = known([candidate("a"), candidate("b")], "partial");

    expect(presentCandidates(listing, (row) => row.key)).toEqual({ ...listing, value: ["a", "b"] });
  });

  it.each(notHeld)("passes a listing that is $name through, never an empty one", ({ listing }) => {
    expect(presentCandidates(listing, (row) => row.key)).toBe(listing);
  });
});

describe("candidateMembers", () => {
  it("holds a known listing's rows, a partial one's included", () => {
    const rows = [candidate("a")];

    expect(candidateMembers(known(rows, "partial"))).toBe(rows);
  });

  it.each(notHeld)("holds no member of a listing that is $name", ({ listing }) => {
    expect(candidateMembers(listing)).toEqual([]);
  });
});

describe("listsNoProject", () => {
  const isProject = (row: ZeropsCandidate) => !row.project.tagList?.includes("tool");

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<ZeropsCandidate>>;
    readonly none: boolean;
  }>([
    { name: "known and complete, with no row", listing: known([]), none: true },
    {
      name: "known and complete, with no row it counts",
      listing: known([candidate("gitea", ["tool"])]),
      none: true,
    },
    { name: "known and complete, with a project", listing: known([candidate("a")]), none: false },
    { name: "known in part, with no row", listing: known([], "partial"), none: false },
    ...notHeld.map(({ name, listing }) => ({ name, listing, none: false })),
  ])("says none of a listing that is $name: $none", ({ listing, none }) => {
    expect(listsNoProject(listing, isProject)).toBe(none);
  });
});

describe("admittedOnly", () => {
  const listing = (value: ReadonlyArray<string>): Known<ReadonlyArray<string>> => ({
    state: "known",
    value,
    asOf: { ordinal: 3, atMs: 30 },
    coverage: "complete",
    freshness: { kind: "live" },
  });

  it("leaves a listing partial when it drops a project the grant has not admitted, never a complete none", () => {
    expect(admittedOnly(listing(["created-in-another-tab"]), () => false)).toEqual({
      ...listing([]),
      coverage: "partial",
    });
  });

  it("keeps a listing whose every project is admitted as it was", () => {
    const whole = listing(["a", "b"]);
    expect(admittedOnly(whole, () => true)).toEqual(whole);
  });

  it("passes a listing it does not hold through", () => {
    const unread: Known<ReadonlyArray<string>> = { state: "unread", waitingFor: "access-grant" };
    expect(admittedOnly(unread, () => false)).toBe(unread);
  });
});
