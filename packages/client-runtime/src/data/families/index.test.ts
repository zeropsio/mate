import { describe, expect, it } from "vite-plus/test";

import { moveProject } from "../operations/moveProject.ts";
import { defineOperationKinds } from "../operations/kinds.ts";
import { attentionFamily } from "./attention.ts";
import { defineFamilies } from "./index.ts";
import { placementFamily } from "./placement.ts";
import { processFamily } from "./process.ts";
import { projectFamily } from "./project.ts";

describe("the registries", () => {
  it("accept the families as registered", () => {
    expect(
      defineFamilies([projectFamily, processFamily, placementFamily, attentionFamily]),
    ).toHaveLength(4);
  });

  it.each([
    { name: "a family twice", families: [projectFamily, projectFamily], error: /family project/ },
    {
      name: "a scope name twice",
      families: [
        projectFamily,
        { ...processFamily, scope: { ...processFamily.scope, suffix: "projects" } },
      ],
      error: /scope projects/,
    },
    {
      name: "an index name twice",
      families: [
        processFamily,
        { ...placementFamily, index: { ...placementFamily.index!, name: "running" } },
      ],
      error: /index running/,
    },
  ])("refuse $name at startup", ({ families, error }) => {
    expect(() => defineFamilies(families as never)).toThrow(error);
  });

  it("refuses an operation kind twice at startup", () => {
    expect(() => defineOperationKinds([moveProject, moveProject])).toThrow(/move-project/);
  });
});
