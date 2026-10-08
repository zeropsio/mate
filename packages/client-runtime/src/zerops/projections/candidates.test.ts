import type { ProjectProcesses } from "../../data/projections/processes.ts";
import type { ActivityProcess } from "../activity/dto.ts";
import { describe, expect, it } from "@effect/vitest";

import type { Known, Shown } from "../knowledge/known.ts";
import type { ZeropsProject, ZeropsService } from "../api.ts";
import type { ZeropsCandidate } from "../candidates.ts";
import {
  admittedOnly,
  candidatesComplete,
  candidatesNotice,
  findCandidate,
  heldCandidates,
  learnAddresses,
  listsNoProject,
  presentCandidates,
  selectCandidates,
  takenBotNames,
  type CandidateRow,
  listingSettled,
  subdomainEnableIn,
} from "./candidates.ts";

function projectRecord(id = "project-1", status = "ACTIVE"): ZeropsProject {
  return {
    id,
    name: id,
    status,
    tagList: [],
    publicZone: "fte2334ab.prg1-zerops.zone",
    zeropsSubdomainHost: "24cb",
    mode: "LIGHT",
  };
}

function zcpService(): ZeropsService {
  return {
    id: "service-1",
    name: "zcp",
    status: "ACTIVE",
    serviceStackTypeInfo: {
      serviceStackTypeName: "Zerops Mate",
      serviceStackTypeVersionName: "zcp@1",
      serviceStackTypeCategory: "USER",
    },
    subdomainAccess: true,
    ports: [{ port: 8080, protocol: "TCP", scheme: "http", httpSupport: true }],
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

  const unread = (): Known<ReadonlyArray<ZeropsService>> => ({ state: "unread", waitingFor: null });

  it.each<{
    readonly name: string;
    readonly services: Known<ReadonlyArray<ZeropsService>>;
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
      services: known([zcpService()], "partial"),
      row: {
        key: "project-1:service-1",
        group: "ready",
        containerOrigin: "https://zcp-24cb-8080.prg1.zerops.app",
        presence: "known",
      },
    },
    {
      name: "a complete listing with a zcp container is present at its origin, not connected",
      services: known([zcpService()]),
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

  it.each<{ readonly name: string; readonly projects: Known<ReadonlyArray<ZeropsProject>> }>([
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
    const projects: Known<ReadonlyArray<ZeropsProject>> = {
      state: "known",
      value: [],
      asOf: { ordinal: 7, atMs: 70 },
      coverage: "complete",
      freshness: { kind: "paused", by: "background" },
    };

    expect(selectCandidates(projects, unread)).toEqual(projects);
  });

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<ZeropsProject>>;
    readonly services: Known<ReadonlyArray<ZeropsService>>;
    readonly complete: boolean;
  }>([
    {
      name: "a complete listing whose every presence is known",
      listing: known([projectRecord()]),
      services: known([zcpService()]),
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
      services: known([zcpService()]),
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

const row = (
  id: string,
  presence: CandidateRow["presence"] = "known",
  tagList: ReadonlyArray<string> = [],
): CandidateRow => ({ ...candidate(id, tagList), presence });

const notHeldRows = notHeld.map(({ name, listing }) => ({
  name,
  listing: listing as Known<ReadonlyArray<CandidateRow>>,
}));

describe("heldCandidates", () => {
  it.each(notHeldRows)(
    "holds no row of a listing that is $name, and never calls that complete",
    ({ listing }) => {
      expect(heldCandidates(listing)).toEqual({ rows: [], complete: false });
    },
  );

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<CandidateRow>>;
    readonly complete: boolean;
  }>([
    { name: "complete, every presence read", listing: known([row("a")]), complete: true },
    { name: "complete, a presence unread", listing: known([row("a", "unknown")]), complete: false },
    { name: "partial", listing: known([row("a")], "partial"), complete: false },
  ])("holds a known listing's rows; one that is $name is complete: $complete", (entry) => {
    const held = heldCandidates(entry.listing);

    expect(held.rows).toBe(entry.listing.state === "known" ? entry.listing.value : undefined);
    expect(held.complete).toBe(entry.complete);
  });
});

describe("findCandidate", () => {
  const isA = (entry: CandidateRow) => entry.project.id === "a";

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<CandidateRow>>;
    readonly lookup: object;
  }>([
    {
      name: "a row it holds is found",
      listing: known([row("a")], "partial"),
      lookup: { kind: "found", row: row("a") },
    },
    {
      name: "a complete listing without it proves it absent",
      listing: known([row("b")]),
      lookup: { kind: "absent" },
    },
    {
      name: "a partial listing without it cannot say",
      listing: known([row("b")], "partial"),
      lookup: { kind: "unknown" },
    },
    {
      name: "a listing with a presence unread cannot say",
      listing: known([row("b", "unknown")]),
      lookup: { kind: "unknown" },
    },
    ...notHeldRows.map(({ name, listing }) => ({
      name: `a listing that is ${name} ${listing.state === "unread" || listing.state === "reading" ? "has not answered yet" : "cannot say"}`,
      listing,
      lookup: {
        kind: listing.state === "unread" || listing.state === "reading" ? "pending" : "unknown",
      },
    })),
  ])("$name", ({ listing, lookup }) => {
    expect(findCandidate(listing, isA)).toEqual(lookup);
  });
});

describe("takenBotNames", () => {
  /** A Mate HQ places in its application, its project named `name` in Zerops. */
  const named = (id: string, name: string, presence: CandidateRow["presence"] = "known") => {
    const base = row(id, presence);
    return {
      ...base,
      project: {
        ...base.project,
        name,
        hq: { appId: "app-acme", appName: "Acme", kind: "mate" as const, mate: { face: "" } },
      },
    };
  };

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<CandidateRow>>;
    readonly withheldMembers?: boolean;
    readonly structureKnown?: boolean;
    readonly taken: object;
  }>([
    {
      // D3: a Mate's name is its project's in Zerops; a project that is no Mate names nobody.
      name: "a complete listing names every Mate by its project, a presence unread included",
      listing: known([named("a", "Fen"), named("b", "Ada", "unknown"), row("c")]),
      taken: { names: ["Fen", "Ada"], complete: true },
    },
    {
      // The project is named in full in Zerops ("Acme - Fen"); the Mate goes by what follows.
      name: "a Mate is named by its own name under its application, the whole name where it is not so named",
      listing: known([named("a", "Acme - Fen"), named("b", "Acmed - Ada"), named("c", "Nova")]),
      taken: { names: ["Fen", "Acmed - Ada", "Nova"], complete: true },
    },
    {
      name: "a partial listing names the Mates it read and is never all of them",
      listing: known([named("a", "Fen")], "partial"),
      taken: { names: ["Fen"], complete: false },
    },
    {
      // Until HQ answers, where it places a project — and the name of the Mate in it — is unread.
      name: "a complete listing before HQ's structure is known is not all of them",
      listing: known([named("a", "Fen"), row("b", "known", ["mate"])]),
      structureKnown: false,
      taken: { names: ["Fen"], complete: false },
    },
    {
      // The marker is the Zerops GUI's and a name planted in a tag is nobody's: HQ places Mates.
      name: "a project only its tags call a Mate names nobody",
      listing: known([row("a", "known", ["mate", "mate:bot:Fen"])]),
      taken: { names: [], complete: true },
    },
    {
      name: "a complete listing whose list held a member it may not read is not all of them",
      listing: known([named("a", "Fen")]),
      withheldMembers: true,
      taken: { names: ["Fen"], complete: false },
    },
    ...notHeldRows.map(({ name, listing }) => ({
      name: `a listing that is ${name} names none, and never as all of them`,
      listing,
      taken: { names: [], complete: false },
    })),
  ])("$name", ({ listing, withheldMembers = false, structureKnown = true, taken }) => {
    expect(takenBotNames(listing, { withheldMembers, structureKnown })).toEqual(taken);
  });
});

describe("candidatesNotice", () => {
  const surface = {
    subject: "who is on this project",
    entity: "project",
    source: "zerops" as const,
    checking: "Checking who is on it…",
    negative: null,
  };

  it.each<{
    readonly name: string;
    readonly listing: Known<ReadonlyArray<CandidateRow>>;
    readonly patient?: boolean;
    readonly notice: object | null;
  }>([
    {
      name: "unread: a placeholder that checks after a moment",
      listing: { state: "unread", waitingFor: null },
      notice: {
        region: "placeholder",
        message: { text: "Checking who is on it…", afterMs: 400, tone: "quiet" },
        affordance: null,
      },
    },
    {
      name: "being read: the same placeholder",
      listing: { state: "reading", sinceMs: 10, attempt: 1 },
      notice: {
        region: "placeholder",
        message: { text: "Checking who is on it…", afterMs: 400, tone: "quiet" },
        affordance: null,
      },
    },
    {
      name: "failed: its cause once, with one Try again",
      listing: {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 10,
        attempt: 1,
        retryAtMs: null,
      },
      notice: {
        region: "message",
        message: {
          text: "Couldn't read who is on this project. Zerops didn't answer.",
          afterMs: 0,
          tone: "alert",
        },
        affordance: { kind: "retry", label: "Try again" },
      },
    },
    {
      name: "partial: still reading over the rows read, once it has held the one voice's 1.5 s",
      listing: known([row("a")], "partial"),
      notice: {
        region: "value",
        message: { text: "Still reading…", afterMs: 1_500, tone: "quiet" },
        affordance: null,
      },
    },
    {
      name: "partial, with no row read: still reading in place of a none it may not say",
      listing: known([], "partial"),
      notice: {
        region: "value",
        message: { text: "Still reading…", afterMs: 1_500, tone: "quiet" },
        affordance: null,
      },
    },
    {
      name: "partial past its patience: the rows hold what they have, and say nothing",
      listing: known([row("a")], "partial"),
      patient: false,
      notice: null,
    },
    {
      name: "partial past its patience with no row read: still says it, for there is nothing else",
      listing: known([], "partial"),
      patient: false,
      notice: {
        region: "value",
        message: { text: "Still reading…", afterMs: 1_500, tone: "quiet" },
        affordance: null,
      },
    },
    {
      name: "complete with a presence unread: the row says it is checking, the list nothing",
      listing: known([row("a", "unknown")]),
      notice: null,
    },
    { name: "complete: nothing to say", listing: known([row("a")]), notice: null },
  ])("$name", ({ listing, patient = true, notice }) => {
    expect(candidatesNotice(listing, surface, 0, { patient })).toEqual(notice);
  });
});

describe("candidatesNotice for a region that says nothing while it reads", () => {
  const surface = {
    subject: "your projects",
    entity: "project",
    source: "zerops" as const,
    checking: "Reading your projects…",
    negative: null,
  };

  it.each<{ readonly name: string; readonly listing: Known<ReadonlyArray<CandidateRow>> }>([
    { name: "unread", listing: { state: "unread", waitingFor: null } },
    { name: "being read", listing: { state: "reading", sinceMs: 10, attempt: 1 } },
  ])("is silent while $name", ({ listing }) => {
    expect(candidatesNotice(listing, surface, 0, { readingSilent: true })).toBeNull();
  });

  it.each<{ readonly name: string; readonly listing: Known<ReadonlyArray<CandidateRow>> }>([
    { name: "waiting for a connection", listing: { state: "unread", waitingFor: "online" } },
    { name: "paused in the background", listing: { state: "unread", waitingFor: "visible" } },
    { name: "still reading over its rows", listing: known([row("a")], "partial") },
    { name: "still reading with none", listing: known([], "partial") },
  ])("still says why it waits when $name", ({ listing }) => {
    expect(candidatesNotice(listing, surface, 0, { readingSilent: true })).not.toBeNull();
  });

  it("still says a failed read, with its one Try again", () => {
    const notice = candidatesNotice(
      {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 10,
        attempt: 1,
        retryAtMs: null,
      },
      surface,
      0,
      { readingSilent: true },
    );
    expect(notice?.region).toBe("message");
    expect(notice?.affordance).toEqual({ kind: "retry", label: "Try again" });
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

// DESIGN §3.1, §4.2 G12: while the account's access lapses, the listing is withheld at its read.
describe("a withheld listing", () => {
  const withheld: Shown<ReadonlyArray<CandidateRow>> = {
    state: "withheld",
    reason: "access-lapsed",
    cause: null,
  };
  const surface = {
    subject: "your projects",
    entity: "project",
    source: "zerops" as const,
    checking: null,
    negative: null,
  };

  it("holds no row, finds none absent, names no bot, and never says none", () => {
    expect(heldCandidates(withheld)).toEqual({ rows: [], complete: false });
    expect(candidatesComplete(withheld)).toBe(false);
    expect(findCandidate(withheld, () => true)).toEqual({ kind: "unknown" });
    expect(takenBotNames(withheld, { structureKnown: true })).toEqual({
      names: [],
      complete: false,
    });
    expect(listsNoProject(withheld, () => true)).toBe(false);
    expect(presentCandidates(withheld, (entry: CandidateRow) => entry.key)).toBe(withheld);
  });

  it("leaves its words to the app's one lapse banner", () => {
    expect(candidatesNotice(withheld, surface, 0)).toBeNull();
  });
});

// Review, pass 32: mobile read a listing's value to remember addresses, which web and mobile never
// do (rule 5) — the runtime reads the known listings for them.
describe("learnAddresses — what the listings teach the address memory, and the soonest pose's end", () => {
  const row = (serviceId: string, seen: "awaited" | { origin: string }) =>
    ({
      key: `p-${serviceId}:${serviceId}`,
      project: { id: `p-${serviceId}` },
      group: seen === "awaited" ? "provisioning" : "ready",
      service: { id: serviceId, name: "zcp", status: "ACTIVE" },
      ...(seen === "awaited" ? { addressAwaited: true } : { containerOrigin: seen.origin }),
    }) as unknown as ZeropsCandidate;
  const unread: Known<ReadonlyArray<ZeropsCandidate>> = { state: "unread", waitingFor: null };
  const WATCHED = { addressed: false, building: true } as const;

  it("reads nothing off a listing not known yet", () => {
    expect(learnAddresses(new Map(), [unread])).toEqual({ memory: new Map(), arrivalEnd: null });
  });

  it("remembers every known listing's containers; an address wait has no end of its own", () => {
    const learned = learnAddresses(new Map(), [
      known([row("s-wait", "awaited"), row("s-up", { origin: "https://up.example" })]),
      unread,
      known([row("s-later", "awaited")]),
    ]);
    expect(learned.arrivalEnd).toBeNull();
    expect(learned.memory.get("s-up")).toEqual({ addressed: true });
    expect(learned.memory.get("s-wait")).toEqual(WATCHED);
    expect(learned.memory.get("s-later")).toEqual(WATCHED);
  });

  it("derives the listing again when a container on its way to answering stops being so", () => {
    const arriving = {
      ...row("s-landed", { origin: "https://landed.example" }),
      arriving: { since: 100_000, until: 220_000 },
    } as ZeropsCandidate;
    const watched = new Map([["s-landed", WATCHED]]);
    const learned = learnAddresses(watched, [known([row("s-later", "awaited"), arriving])]);
    expect(learned.arrivalEnd).toBe(220_000);
    expect(learned.memory.get("s-landed")).toEqual({ addressed: true, since: 100_000 });
  });
});

// Whether a container's address is being turned on is its project's processes' word: known once
// both its running processes and its newest history are read; a live enable says so before that.
describe("subdomainEnableIn", () => {
  const enable = (status: string): ActivityProcess => ({
    id: `enable-${status}`,
    projectId: "project-1",
    serviceStackIds: ["service-1"],
    status,
    actionName: "stack.enableSubdomainAccess",
    created: "2026-10-02T12:01:40.000Z",
  });
  const activity = (input: {
    readonly running: ReadonlyArray<string>;
    readonly history: ReadonlyArray<string>;
    readonly runningRead: boolean;
    readonly historyRead: boolean;
  }): ProjectProcesses => {
    const processes = [...input.running, ...input.history].map(enable);
    return {
      retained: input.runningRead ? processes : undefined,
      processes: input.runningRead ? processes : undefined,
      running: input.running.map(enable),
      live: true,
      reconnecting: false,
      history: input.historyRead ? "read" : "reading",
    };
  };

  it.each([
    { case: "nothing asked", read: null, said: undefined },
    {
      case: "a live enable, the history still read: on",
      read: activity({ running: ["RUNNING"], history: [], runningRead: true, historyRead: false }),
      said: "on",
    },
    {
      case: "no live enable, the history still read: not known",
      read: activity({ running: [], history: [], runningRead: true, historyRead: false }),
      said: undefined,
    },
    {
      case: "both read, none held: off",
      read: activity({ running: [], history: [], runningRead: true, historyRead: true }),
      said: "off",
    },
    {
      case: "both read, a failed enable in the history: off",
      read: activity({ running: [], history: ["FAILED"], runningRead: true, historyRead: true }),
      said: "off",
    },
  ] as const)("$case", ({ read, said }) => {
    expect(subdomainEnableIn(read, "service-1")).toBe(said);
  });
});

describe("listingSettled: a listing that will tell no more", () => {
  const known = (coverage: "complete" | "partial") =>
    ({ state: "known", value: [], coverage }) as unknown as Parameters<typeof listingSettled>[0];
  const state = (name: string) =>
    ({ state: name }) as unknown as Parameters<typeof listingSettled>[0];
  it.each([
    ["complete", known("complete"), { loading: true, patient: true }, true],
    [
      "complete, a row's container not read yet",
      {
        state: "known",
        value: [{ presence: "unknown" }],
        coverage: "complete",
      } as unknown as Parameters<typeof listingSettled>[0],
      { loading: true, patient: true },
      false,
    ],
    ["being read", state("reading"), { loading: false, patient: true }, false],
    ["unread", state("unread"), { loading: false, patient: true }, false],
    ["failed", state("failed"), { loading: true, patient: true }, true],
    ["withheld whole", state("withheld"), { loading: true, patient: true }, true],
    ["gone", state("gone"), { loading: true, patient: true }, true],
    // What it lacks the inventory is not reading: withheld projects.
    ["partial, nothing more being read", known("partial"), { loading: false, patient: true }, true],
    ["partial, parts still being read", known("partial"), { loading: true, patient: true }, false],
    // Past its patience the missing parts are failing, retried on their own backoff.
    ["partial past its patience", known("partial"), { loading: true, patient: false }, true],
  ] as const)("%s", (_case, listing, input, settled) => {
    expect(listingSettled(listing, input)).toBe(settled);
  });
});
