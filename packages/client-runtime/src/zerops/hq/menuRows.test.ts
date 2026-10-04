import { describe, expect, it } from "@effect/vitest";
import { menuRowsFromHq } from "./placement.ts";
import type { HqStructure } from "./client.ts";
import type { CandidateRow } from "../projections/candidates.ts";

const structure: HqStructure = {
  ungrouped: [{ projectId: "loose", name: "Last loose", mate: { face: "sky:flower" } }],
  apps: [
    {
      id: "app",
      name: "App",
      projects: [
        { projectId: "mate", name: "Last name", kind: "mate", mate: { face: "rose:seal" } },
        { projectId: "stage", name: "Last stage", kind: "stage", mate: null },
      ],
    },
  ],
};
const candidate: CandidateRow = {
  key: "mate:service",
  project: { id: "mate", name: "Fresh name", status: "ACTIVE" },
  service: { id: "service", name: "zcp", status: "ACTIVE" },
  group: "ready",
  presence: "known",
  containerOrigin: "https://mate.test",
};
const input = {
  organizationId: "org",
  structure,
  projects: [],
  candidates: [],
  gone: new Set<string>(),
};

describe("HQ menu rows", () => {
  it("paints HQ placements without platform inventory", () => {
    const rows = menuRowsFromHq(input);
    expect(rows.map((row) => row.project.id)).toEqual(["mate", "stage", "loose"]);
    expect(rows.every((row) => row.presence === "unknown")).toBe(true);
    expect(rows[0]?.project.name).toBe("Last name");
    expect(rows[0]?.project.hq?.appId).toBe("app");
  });
  it("enriches by id and never promotes an unplaced zcp container", () => {
    const extra = { ...candidate, key: "extra", project: { ...candidate.project, id: "extra" } };
    const rows = menuRowsFromHq({
      ...input,
      candidates: [extra, candidate],
      projects: [candidate.project],
    });
    expect(rows.map((row) => row.project.id)).toEqual(["mate", "stage", "loose"]);
    expect(rows[0]?.project.name).toBe("Fresh name");
    expect(rows[0]?.service?.id).toBe("service");
  });
  it("keeps omitted placements until Zerops gives definite gone evidence", () => {
    expect(
      menuRowsFromHq({ ...input, gone: new Set(["mate"]) }).map((row) => row.project.id),
    ).toEqual(["stage", "loose"]);
  });
  it("takes platform names and state without requiring services or project admission", () => {
    const rows = menuRowsFromHq({
      ...input,
      projects: [{ id: "mate", name: "Renamed", status: "STOPPED" }],
    });
    expect(rows[0]?.project).toMatchObject({ name: "Renamed", status: "STOPPED" });
    expect(rows[0]?.presence).toBe("unknown");
  });
});
