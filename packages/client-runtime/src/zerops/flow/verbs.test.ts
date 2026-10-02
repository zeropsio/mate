import { describe, expect, it } from "vite-plus/test";

import type { FlowVerb } from "../projectFlow.ts";
import { flowVerbInvalidations, type FlowInvalidation } from "./verbs.ts";

describe("flowVerbInvalidations", () => {
  // DESIGN §4.7 "Verbs": settlement invalidates exactly what the verb changed.
  const cases: ReadonlyArray<{
    readonly verb: FlowVerb;
    readonly expected: FlowInvalidation;
  }> = [
    {
      // That repository's `main`, whose head the deploy half reads for what a release would
      // carry; the change itself comes back down HQ's stream.
      verb: { kind: "merge", slug: "harbor", repository: "appdev", number: 4 },
      expected: { forge: null, deploys: { kind: "main-head", repository: "appdev" } },
    },
    {
      // The group repo's `main` holds the declarations and the tiers the
      // deploy half reads, so a recipe merge reads that half whole again.
      verb: { kind: "merge", slug: "harbor", repository: "group", number: 2 },
      expected: { forge: null, deploys: "group" },
    },
    {
      verb: { kind: "release", groupId: "g1" },
      expected: { forge: { kind: "tags" }, deploys: null },
    },
    {
      verb: { kind: "roll-back", groupId: "g1", tag: "v1.2.0" },
      expected: { forge: { kind: "tags" }, deploys: null },
    },
  ];

  it.each(cases)("$verb.kind invalidates what it changed", ({ verb, expected }) => {
    expect(flowVerbInvalidations(verb)).toEqual(expected);
  });
});
