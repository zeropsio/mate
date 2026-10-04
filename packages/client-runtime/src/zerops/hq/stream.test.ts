import { describe, expect, it } from "@effect/vitest";
import type { HqChange } from "@t3tools/shared/hqChanges";
import type { MateLiveView } from "@t3tools/shared/hqMates";

import type { HqStructure } from "./client.ts";
import type { HqEnvironment } from "./environments.ts";
import {
  applyChangesEvent,
  applyAppReadsEvent,
  applyStructureEvent,
  structureEventOf,
} from "./stream.ts";

const ACME: HqStructure["apps"][number] = {
  id: "app-1",
  name: "Acme",
  projects: [
    {
      projectId: "p1",
      name: "Acme - Vera",
      kind: "mate",
      mate: { face: "rose:seal" },
    },
  ],
};
const BETA: HqStructure["apps"][number] = { id: "app-2", name: "Beta", projects: [] };

/** Acme's stage, its `api` live on one commit while the next one builds. */
const STAGE: HqEnvironment = {
  projectId: "p-stage",
  tier: "stage",
  name: "stage",
  sources: ["main"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  jobs: [
    {
      id: "2",
      kind: "deploy",
      service: "api",
      sha: "b".repeat(40),
      state: "building",
      cause: "merge",
      ref: "b".repeat(40),
      reason: null,
      appVersionId: "av-2",
      processId: "pr-2",
      requestedBy: "u-ada",
      at: "2026-10-02T10:00:00.000Z",
      endedAt: null,
      supersededBy: null,
    },
    {
      id: "1",
      kind: "deploy",
      service: "api",
      sha: "a".repeat(40),
      state: "live",
      cause: "merge",
      ref: "a".repeat(40),
      reason: null,
      appVersionId: "av-1",
      processId: "pr-1",
      requestedBy: null,
      at: "2026-10-02T09:00:00.000Z",
      endedAt: "2026-10-02T09:03:00.000Z",
      supersededBy: null,
    },
  ],
  release: null,
};
const ACME_STAGED: HqStructure["apps"][number] = { ...ACME, environments: [STAGE] };
const LONE: HqStructure["ungrouped"][number] = {
  projectId: "p9",
  name: "scratch",
  mate: { face: "sky:flower" },
};

/** Vera's change #3 in Acme's `app`, open and pushed to. */
const CHANGE: HqChange = {
  appId: "app-1",
  repo: "app",
  number: 3,
  mateProjectId: "p1",
  title: "Add a /status page",
  body: "",
  state: "open",
  head: "a".repeat(40),
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-10-02T09:00:00.000Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-10-02T09:00:00.000Z",
  mergeability: "clean",
  behind: false,
};

const AT = "2026-10-03T10:00:00.000Z";

/** Vera as a reader observes her: online, a chat of hers waiting on an approval. */
const VERA_VIEW = {
  presence: { online: true, since: AT, overview: "live" },
  identity: { environmentId: "env-vera", serverVersion: "0.11.90", update: null },
  main: null,
  threads: {
    list: [
      {
        id: "t1",
        title: "Add a /status page",
        kind: "approval",
        turnId: "turn-1",
        turnState: "running",
        completedAt: null,
      },
    ],
    omitted: 0,
  },
  logins: { "claude-code": { signedInBy: "u-ada", present: true, token: false } },
  crew: { status: "off" },
} as unknown as MateLiveView;

describe("structureEventOf", () => {
  it.each<[string, unknown, ReturnType<typeof structureEventOf>]>([
    [
      "a snapshot is the whole structure, the Mates in no application with it",
      { type: "snapshot", ungrouped: [LONE], apps: [ACME] },
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [LONE], apps: [ACME] },
        changes: null,
        mates: null,
        people: null,
      },
    ],
    [
      "a snapshot that names no Mate in no application holds none",
      { type: "snapshot", apps: [ACME] },
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [], apps: [ACME] },
        changes: null,
        mates: null,
        people: null,
      },
    ],
    [
      "a snapshot carries each application's changes beside its structure",
      { type: "snapshot", apps: [ACME], changes: { "app-1": [CHANGE] } },
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [], apps: [ACME] },
        changes: new Map([["app-1", [CHANGE]]]),
        mates: null,
        people: null,
      },
    ],
    [
      "a snapshot whose changes this build cannot read still carries its structure",
      { type: "snapshot", apps: [ACME], changes: { "app-1": [{ ...CHANGE, number: 0 }] } },
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [], apps: [ACME] },
        changes: null,
        mates: null,
        people: null,
      },
    ],
    // SPEC §3.2b: an application's stage and production with their jobs, to whoever reads its
    // changes; read through the contract's shape, so a set this build cannot read is not known.
    [
      "a snapshot carries each application's environments and their jobs",
      { type: "snapshot", apps: [ACME_STAGED] },
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [], apps: [ACME_STAGED] },
        changes: null,
        mates: null,
        people: null,
      },
    ],
    [
      "an application whose environments this build cannot read has them unknown, itself read",
      { type: "snapshot", apps: [{ ...ACME, environments: [{ ...STAGE, tier: "dev" }] }] },
      {
        kind: "snapshot",
        appReads: null,
        structure: { ungrouped: [], apps: [ACME] },
        changes: null,
        mates: null,
        people: null,
      },
    ],
    [
      "a snapshot carries each application's birth intents, each read through its shape",
      {
        type: "snapshot",
        apps: [{ ...ACME, births: [{ id: "b-1", face: "rose:seal" }, { id: 7 }] }],
      },
      {
        kind: "snapshot",
        appReads: null,
        structure: {
          ungrouped: [],
          apps: [{ ...ACME, births: [{ id: "b-1", face: "rose:seal" }] }],
        },
        changes: null,
        mates: null,
        people: null,
      },
    ],
    [
      "a change carries its application's environments",
      { type: "change", key: "app-1", value: ACME_STAGED },
      { kind: "change", appId: "app-1", app: ACME_STAGED },
    ],
    [
      "an application's changes, whole",
      { type: "changes", appId: "app-1", changes: [CHANGE] },
      { kind: "changes", appId: "app-1", changes: [CHANGE] },
    ],
    [
      "an application's changes the reader may no longer read",
      { type: "changes", appId: "app-1", changes: null },
      { kind: "changes", appId: "app-1", changes: null },
    ],
    [
      "an application's changes this build cannot read are none",
      { type: "changes", appId: "app-1", changes: [{ ...CHANGE, head: "not-a-sha" }] },
      undefined,
    ],
    [
      "a change carries its application",
      { type: "change", key: "app-1", value: ACME },
      { kind: "change", appId: "app-1", app: ACME },
    ],
    [
      "a change without a value is the application gone",
      { type: "change", key: "app-1", value: null },
      { kind: "change", appId: "app-1", app: null },
    ],
    [
      "a change under `ungrouped` is the whole list of the Mates in no application",
      { type: "change", key: "ungrouped", value: [LONE] },
      { kind: "ungrouped", mates: [LONE] },
    ],
    ["a ping is no change of the structure", { type: "ping" }, undefined],
    ["a message this client does not know is none", { type: "later" }, undefined],
    ["a message that is no object is none", "snapshot", undefined],
  ])("%s", (_name, message, expected) => {
    expect(structureEventOf(message)).toEqual(expected);
  });

  it("parses a Mate's sections and the people map and passes by what it does not know", () => {
    const people = { "u-ada": { name: "Ada Lovelace" } };
    expect(
      structureEventOf({
        type: "snapshot",
        apps: [ACME],
        mates: { p1: { ...VERA_VIEW, later: { since: AT } } },
        people,
      }),
    ).toEqual({
      kind: "snapshot",
      appReads: null,
      structure: { ungrouped: [], apps: [ACME] },
      changes: null,
      mates: new Map([["p1", VERA_VIEW]]),
      people,
    });
    expect(
      structureEventOf({ type: "mate", projectId: "p1", value: { main: null, later: {} } }),
    ).toEqual({ kind: "mate", projectId: "p1", value: { main: null } });
    expect(structureEventOf({ type: "mate", projectId: "p1", value: null })).toEqual({
      kind: "mate",
      projectId: "p1",
      value: null,
    });
    expect(structureEventOf({ type: "people", people })).toEqual({ kind: "people", people });
    // A section this build cannot read is no message it reads.
    expect(
      structureEventOf({ type: "mate", projectId: "p1", value: { presence: { online: true } } }),
    ).toBeUndefined();
  });

  it("leaves out a snapshot's Mate this build cannot read, and reads the others", () => {
    const event = structureEventOf({
      type: "snapshot",
      apps: [ACME],
      mates: { p1: VERA_VIEW, p2: { ...VERA_VIEW, threads: { list: "none", omitted: 0 } } },
      people: {},
    });
    expect(event?.kind === "snapshot" ? event.mates : event).toEqual(new Map([["p1", VERA_VIEW]]));
  });
});

describe("applyStructureEvent", () => {
  it("carries HQ's unfinished deletion through snapshot and app change", () => {
    const deleting = { ...BETA, contents: { empty: false, deletingProjectIds: ["zed"] } };
    const event = structureEventOf({ type: "snapshot", ungrouped: [], apps: [deleting] });
    expect(event?.kind).toBe("snapshot");
    const first = applyStructureEvent(null, event!);
    expect(first?.apps[0]?.contents).toEqual(deleting.contents);
    const empty = { ...BETA, contents: { empty: true, deletingProjectIds: [] } };
    const done = structureEventOf({ type: "change", key: BETA.id, value: empty });
    expect(applyStructureEvent(first, done!)?.apps[0]?.contents).toEqual(empty.contents);
  });

  it.each([
    null,
    { empty: "true", deletingProjectIds: [] },
    { empty: true, deletingProjectIds: ["zed"] },
    { empty: false, deletingProjectIds: [7] },
  ])("treats unreadable HQ contents as unknown: %j", (contents) => {
    const event = structureEventOf({ type: "change", key: BETA.id, value: { ...BETA, contents } });
    expect(event?.kind === "change" ? event.app?.contents : null).toBeUndefined();
  });

  it("replaces on a snapshot, upserts and removes on a change, in place", () => {
    const renamed = { ...ACME, name: "Acme CRM" };
    let structure = applyStructureEvent(null, {
      kind: "snapshot",
      appReads: null,
      structure: { ungrouped: [LONE], apps: [ACME] },
      changes: null,
      mates: null,
      people: null,
    });
    structure = applyStructureEvent(structure, { kind: "change", appId: "app-2", app: BETA });
    expect(structure).toEqual({ ungrouped: [LONE], apps: [ACME, BETA] });
    structure = applyStructureEvent(structure, { kind: "change", appId: "app-1", app: renamed });
    expect(structure).toEqual({ ungrouped: [LONE], apps: [renamed, BETA] });
    structure = applyStructureEvent(structure, { kind: "change", appId: "app-1", app: null });
    expect(structure).toEqual({ ungrouped: [LONE], apps: [BETA] });
  });

  it("replaces the Mates in no application with their change", () => {
    const structure = applyStructureEvent(
      { ungrouped: [LONE], apps: [ACME] },
      { kind: "ungrouped", mates: [] },
    );
    expect(structure).toEqual({ ungrouped: [], apps: [ACME] });
  });

  it("leaves the structure as it is on a Mate's message and on the people's", () => {
    const structure: HqStructure = { ungrouped: [LONE], apps: [ACME] };
    expect(applyStructureEvent(structure, { kind: "mate", projectId: "p1", value: null })).toBe(
      structure,
    );
    expect(applyStructureEvent(structure, { kind: "people", people: {} })).toBe(structure);
  });

  it("knows nothing from a change before its snapshot", () => {
    expect(applyStructureEvent(null, { kind: "change", appId: "app-2", app: BETA })).toBeNull();
  });
});

describe("applyChangesEvent", () => {
  const merged: HqChange = {
    ...CHANGE,
    state: "merged",
    mergedSha: "b".repeat(40),
    landedHead: CHANGE.head,
    mergedAt: "2026-10-02T10:00:00.000Z",
  };

  it("replaces on a snapshot, and replaces or drops one application's on its message", () => {
    let changes = applyChangesEvent(null, {
      kind: "snapshot",
      appReads: null,
      structure: { ungrouped: [], apps: [ACME, BETA] },
      changes: new Map([["app-1", [CHANGE]]]),
      mates: null,
      people: null,
    });
    changes = applyChangesEvent(changes, { kind: "changes", appId: "app-1", changes: [merged] });
    changes = applyChangesEvent(changes, { kind: "changes", appId: "app-2", changes: [] });
    expect(changes).toEqual(
      new Map([
        ["app-1", [merged]],
        ["app-2", []],
      ]),
    );
    changes = applyChangesEvent(changes, { kind: "changes", appId: "app-1", changes: null });
    expect(changes).toEqual(new Map([["app-2", []]]));
  });

  it("knows nothing before a snapshot that carried them, and leaves them on a structure change", () => {
    expect(
      applyChangesEvent(null, { kind: "changes", appId: "app-1", changes: [CHANGE] }),
    ).toBeNull();
    const held = new Map([["app-1", [CHANGE]]]);
    expect(applyChangesEvent(held, { kind: "change", appId: "app-1", app: null })).toBe(held);
  });
});

/** A snapshot as HQ sends it, with what `extra` adds. */
const snapshot = (extra: Record<string, unknown> = {}) => ({
  type: "snapshot",
  ungrouped: [],
  apps: [{ id: "app-shop", name: "Shop", projects: [] }],
  changes: {},
  ...extra,
});

const read = (revision: string) => ({
  revision,
  failure: null,
  value: {
    releases: [],
    repos: [],
    recipes: { stage: { state: "absent" as const }, production: { state: "absent" as const } },
  },
});

describe("each application's load data, as HQ's stream says it", () => {
  it("is read from the snapshot, and moved by its message", () => {
    const first = read("41");
    const fresh = read("57");
    const told = structureEventOf(snapshot({ appReads: { "app-shop": first } }));
    const moved = structureEventOf({ type: "release-revision", appId: "app-shop", read: fresh });
    expect(moved).toEqual({ kind: "release-revision", appId: "app-shop", read: fresh });
    const atSnapshot = applyAppReadsEvent(null, told!);
    expect(atSnapshot).toEqual(new Map([["app-shop", first]]));
    expect(applyAppReadsEvent(atSnapshot, moved!)).toEqual(new Map([["app-shop", fresh]]));
  });

  it("has no value before a valid snapshot, and never reads a fallback", () => {
    const told = structureEventOf(snapshot());
    const unknown = applyAppReadsEvent(new Map([["app-shop", read("41")]]), told!);
    expect(unknown).toBeNull();
    expect(
      applyAppReadsEvent(unknown, {
        kind: "release-revision",
        appId: "app-shop",
        read: read("57"),
      }),
    ).toBeNull();
  });

  it("passes by a message this build cannot read", () => {
    expect(structureEventOf({ type: "release-revision", appId: "app-shop" })).toBeUndefined();
  });
});
