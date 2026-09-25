import { describe, expect, it } from "vite-plus/test";

import { validateUsageSearch } from "./-usageSearch";

describe("validateUsageSearch", () => {
  it.each([
    {
      name: "keeps every present value",
      raw: { person: "u1", project: "shop", mate: "env-a" },
      expected: { person: "u1", project: "shop", mate: "env-a" },
    },
    {
      name: "trims surrounding whitespace",
      raw: { person: " u1 ", project: "\tshop\n" },
      expected: { person: "u1", project: "shop" },
    },
    {
      name: "drops a whitespace-only value",
      raw: { person: "  ", project: "", mate: " " },
      expected: {},
    },
    {
      name: "drops a value that is not a string",
      raw: { person: 7, project: ["shop"] },
      expected: {},
    },
  ])("$name", ({ raw, expected }) => {
    expect(validateUsageSearch(raw)).toEqual(expected);
  });
});
