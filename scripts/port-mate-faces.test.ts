import { describe, expect, it } from "vite-plus/test";

import mateSro from "./__fixtures__/origin-faces-mate-sro.json" with { type: "json" };
import krls from "./__fixtures__/origin-faces-krls.json" with { type: "json" };

import { originMateFaces, facePortPlan, applyFacePort } from "./port-mate-faces.ts";

describe("porting origin faces into HQ", () => {
  it("ports tags without their namespace and resolves tagless faces over the whole origin name pool", () => {
    const projects = [
      { id: "fern", name: "Fern", tags: ["mate"] },
      { id: "kai", name: "Kai", tags: ["mate", "mate:bot:Kai"] },
      {
        id: "picked",
        name: "Different project name",
        tags: ["mate", "mate:bot:Ada", "mate:face:sky:hexagon:named"],
      },
      { id: "stage", name: "Stage", tags: ["mate", "mate:role:stage"] },
      { id: "tool", name: "Gitea", tags: ["mate", "mate:tool:gitea"] },
    ];
    expect([...originMateFaces(projects)]).toEqual([
      ["fern", "violet:gem"],
      ["kai", "coral:pentagon"],
      ["picked", "sky:hexagon:named"],
    ]);
    const records = [
      { projectId: "fern", face: "rose:flower" },
      { projectId: "picked", face: "sky:hexagon:named" },
    ];
    const plan = facePortPlan(projects, records);
    expect(plan).toEqual([
      {
        projectId: "fern",
        name: "Fern",
        oldFace: "rose:flower",
        newFace: "violet:gem",
        changed: true,
      },
      {
        projectId: "picked",
        name: "Different project name",
        oldFace: "sky:hexagon:named",
        newFace: "sky:hexagon:named",
        changed: false,
      },
    ]);
    expect(
      facePortPlan(
        projects,
        plan.map((p) => ({ projectId: p.projectId, face: p.newFace })),
      ).every((p) => !p.changed),
    ).toBe(true);
  });

  it("uses the first readable face and name, falls back each unknown part, and hashes names rather than ids", () => {
    const projects = [
      {
        id: "a",
        name: "Project",
        tags: [
          "mate",
          "mate:bot: ",
          "mate:bot: Fen ",
          "mate:face:unknown:unknown",
          "mate:face:violet:unknown:extra",
          "mate:face:rose:flower",
        ],
      },
      { id: "b", name: "Other", tags: ["mate", "mate:bot:Fen", "mate:face:unknown:pick"] },
      { id: "body", name: "Fen", tags: [], hasMateContainer: true },
    ];
    expect([...originMateFaces(projects)]).toEqual([
      ["a", "violet:gem"],
      ["b", "sand:pick"],
      ["body", "sand:seal"],
    ]);
    expect([
      ...originMateFaces(projects.map((p) => ({ ...p, id: `${p.id}-renamed` }))).values(),
    ]).toEqual([...originMateFaces(projects).values()]);
  });

  it("refuses a record without an origin Mate instead of guessing or creating records", () => {
    expect(() => facePortPlan([], [{ projectId: "gone", face: "" }])).toThrow("gone");
  });
});

describe("face-port writes", () => {
  it.each([{ projects: mateSro }, { projects: krls }])(
    "matches the complete read-only origin inventory",
    ({ projects }) => {
      expect([...originMateFaces(projects)]).toEqual(projects.map((p) => [p.id, p.originFace]));
    },
  );

  it("dry-runs by default, patches only differences, and stops visibly on the first failed attempt", async () => {
    const plan = facePortPlan(
      [{ id: "p", name: "Fen", tags: ["mate"] }],
      [{ projectId: "p", face: "" }],
    );
    const calls: string[] = [];
    const patch = async (id: string, face: string) => {
      calls.push(`${id}:${face}`);
    };
    await applyFacePort(plan, patch);
    expect(calls).toEqual([]);
    await applyFacePort(plan, patch, { apply: true });
    expect(calls).toEqual(["p:sand:seal"]);
    calls.length = 0;
    await applyFacePort(
      plan.map((p) => ({ ...p, oldFace: p.newFace, changed: false })),
      patch,
      { apply: true },
    );
    expect(calls).toEqual([]);
    const fail = async () => {
      calls.push("attempt");
      throw new Error("forbidden");
    };
    await expect(applyFacePort([...plan, ...plan], fail, { apply: true })).rejects.toThrow(
      "forbidden",
    );
    expect(calls).toEqual(["attempt"]);
  });
});
