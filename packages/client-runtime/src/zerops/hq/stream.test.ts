import { describe, expect, it } from "@effect/vitest";

import type { HqStructure } from "./client.ts";
import { applyStructureEvent, structureEventOf } from "./stream.ts";

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
const LONE: HqStructure["ungrouped"][number] = {
  projectId: "p9",
  name: "scratch",
  mate: { name: "Ada", face: "sky:flower" },
};

describe("structureEventOf", () => {
  it.each<[string, unknown, ReturnType<typeof structureEventOf>]>([
    [
      "a snapshot is the whole structure, the Mates in no application with it",
      { type: "snapshot", ungrouped: [LONE], apps: [ACME] },
      { kind: "snapshot", structure: { ungrouped: [LONE], apps: [ACME] } },
    ],
    [
      "a snapshot that names no Mate in no application holds none",
      { type: "snapshot", apps: [ACME] },
      { kind: "snapshot", structure: { ungrouped: [], apps: [ACME] } },
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
