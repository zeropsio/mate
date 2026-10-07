import { describe, expect, it } from "vite-plus/test";

import { defineOperationKinds } from "../operations/kinds.ts";
import { defineFamilies, streamMode } from "./index.ts";
import { organizationMembersFamily } from "./organizationMembers.ts";
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
    {
      name: "a sampled family registered like a realtime one",
      families: [{ ...organizationMembersFamily, zerops: processFamily.zerops }],
      error: /sampled family organizationMembers/,
    },
    {
      name: "a sampled family observed with navigation",
      families: [
        {
          ...organizationMembersFamily,
          scope: { ...organizationMembersFamily.scope, demand: "navigation" },
        },
      ],
      error: /sampled family organizationMembers/,
    },
  ])("refuse $name at startup", ({ families, error }) => {
    expect(() => defineFamilies(families as never)).toThrow(error);
  });

  it.each([
    { key: "zerops:org", mode: "realtime" },
    { key: "zerops:org:running", mode: "realtime" },
    { key: "zerops:org:members:org", mode: "once" },
    { key: "zerops:org:routings", mode: "realtime" },
    { key: "zerops:org:projectRoutings:p1", mode: "realtime" },
    { key: "zerops:org:agents:s1", mode: "sampled" },
    { key: "hq:org:unregistered", mode: "realtime" },
    { key: "mate:env:database:panel/query", mode: "once" },
    { key: "mate:database-session-env", mode: "realtime" },
    { key: "mate:database-session-env:database-session", mode: "realtime" },
  ])("observe $key as $mode", ({ key, mode }) => {
    expect(streamMode(key)).toBe(mode);
  });

  it("refuses an operation kind twice at startup", () => {
    const kind = { kind: "some-kind", executor: "hq", reflected: () => false };
    expect(() => defineOperationKinds([kind, kind] as never)).toThrow(/some-kind/);
  });
});
