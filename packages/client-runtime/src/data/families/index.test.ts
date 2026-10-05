import { describe, expect, it } from "vite-plus/test";

import { defineOperationKinds } from "../operations/kinds.ts";
import { defineFamilies } from "./index.ts";
import { processFamily } from "./process.ts";

/** Another family as the registry sees it: a name, a scope and an index of its own. */
const otherFamily = {
  ...processFamily,
  family: "other",
  scope: { ...processFamily.scope, suffix: "other" },
  indexes: [{ name: "other", keyOf: () => null }],
  details: [],
};

describe("the registries", () => {
  it("accept the families as registered", () => {
    expect(defineFamilies([processFamily, otherFamily as never])).toHaveLength(2);
  });

  it.each([
    { name: "a family twice", families: [processFamily, processFamily], error: /family process/ },
    {
      name: "a scope name twice",
      families: [processFamily, { ...otherFamily, scope: processFamily.scope }],
      error: /scope running/,
    },
    {
      name: "a detail listing's scope name twice",
      families: [processFamily, { ...otherFamily, details: processFamily.details }],
      error: /scope history/,
    },
    {
      name: "an index name twice",
      families: [processFamily, { ...otherFamily, indexes: processFamily.indexes }],
      error: /index running/,
    },
  ])("refuse $name at startup", ({ families, error }) => {
    expect(() => defineFamilies(families as never)).toThrow(error);
  });

  it("refuses an operation kind twice at startup", () => {
    const kind = { kind: "some-kind", executor: "hq", reflected: () => false };
    expect(() => defineOperationKinds([kind, kind] as never)).toThrow(/some-kind/);
  });
});
