import { describe, expect, it } from "@effect/vitest";
import type { HqChange } from "@t3tools/shared/hqChanges";

import type { HqStructure } from "./client.ts";
import type { HqEnvironment } from "./environments.ts";
import { applyChangesEvent, applyStructureEvent, structureEventOf } from "./stream.ts";

const ACME: HqStructure["apps"][number] = {
  id: "app-1",
  name: "Acme",
  projects: [
    {
      projectId: "p1",
      name: "Acme - Vera",
      kind: "mate",
      mate: { name: "Vera", face: "rose:seal" },
    },
  ],
};
const BETA: HqStructure["apps"][number] = { id: "app-2", name: "Beta", projects: [] };

/** Acme's stage, its `api` live on one commit while the next one deploys. */
const STAGE: HqEnvironment = {
  projectId: "p-stage",
  tier: "stage",
  name: "stage",
  sources: ["main"],
  order: 1,
  keyHeld: true,
  keyInvalid: false,
  deploys: [
    {
      service: "api",
      latest: {
        sha: "b".repeat(40),
        state: "deploying",
        failure: null,
        message: null,
        appVersionId: "av-2",
        processId: "pr-2",
        requestedBy: "u-ada",
        at: "2026-10-02T10:00:00.000Z",
      },
      live: {
        sha: "a".repeat(40),
        state: "live",
        failure: null,
        message: null,
        appVersionId: "av-1",
        processId: "pr-1",
        requestedBy: null,
        at: "2026-10-02T09:00:00.000Z",
      },
    },
  ],
};
const ACME_STAGED: HqStructure["apps"][number] = { ...ACME, environments: [STAGE] };
const LONE: HqStructure["ungrouped"][number] = {
  projectId: "p9",
  name: "scratch",
  mate: { name: "Ada", face: "sky:flower" },
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

describe("structureEventOf", () => {
  it.each<[string, unknown, ReturnType<typeof structureEventOf>]>([
    [
      "a snapshot is the whole structure, the Mates in no application with it",
      { type: "snapshot", ungrouped: [LONE], apps: [ACME] },
      { kind: "snapshot", structure: { ungrouped: [LONE], apps: [ACME] }, changes: null },
    ],
    [
      "a snapshot that names no Mate in no application holds none",
      { type: "snapshot", apps: [ACME] },
      { kind: "snapshot", structure: { ungrouped: [], apps: [ACME] }, changes: null },
    ],
    [
      "a snapshot carries each application's changes beside its structure",
      { type: "snapshot", apps: [ACME], changes: { "app-1": [CHANGE] } },
      {
        kind: "snapshot",
        structure: { ungrouped: [], apps: [ACME] },
        changes: new Map([["app-1", [CHANGE]]]),
      },
    ],
    [
      "a snapshot whose changes this build cannot read still carries its structure",
      { type: "snapshot", apps: [ACME], changes: { "app-1": [{ ...CHANGE, number: 0 }] } },
      { kind: "snapshot", structure: { ungrouped: [], apps: [ACME] }, changes: null },
    ],
    // SPEC §3.2b: an application's stage and production with their deploys, to whoever reads its
    // changes; read through the contract's shape, so a set this build cannot read is not known.
    [
      "a snapshot carries each application's environments and their deploys",
      { type: "snapshot", apps: [ACME_STAGED] },
      { kind: "snapshot", structure: { ungrouped: [], apps: [ACME_STAGED] }, changes: null },
    ],
    [
      "an application whose environments this build cannot read has them unknown, itself read",
      { type: "snapshot", apps: [{ ...ACME, environments: [{ ...STAGE, tier: "dev" }] }] },
      { kind: "snapshot", structure: { ungrouped: [], apps: [ACME] }, changes: null },
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
});

describe("applyStructureEvent", () => {
  it("replaces on a snapshot, upserts and removes on a change, in place", () => {
    const renamed = { ...ACME, name: "Acme CRM" };
    let structure = applyStructureEvent(null, {
      kind: "snapshot",
      structure: { ungrouped: [LONE], apps: [ACME] },
      changes: null,
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
      structure: { ungrouped: [], apps: [ACME, BETA] },
      changes: new Map([["app-1", [CHANGE]]]),
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
