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
      // A change merges, and closes, in HQ: nothing of Gitea moves, and the change comes back
      // down HQ's stream — nothing is read again.
      verb: { kind: "merge", groupId: "g1", repository: "appdev", number: 4 },
      expected: { forge: null },
    },
    {
      verb: { kind: "close", groupId: "g1", repository: "group", number: 2 },
      expected: { forge: null },
    },
    {
      verb: { kind: "release", groupId: "g1" },
      expected: { forge: { kind: "tags" } },
    },
    {
      verb: { kind: "roll-back", groupId: "g1", tag: "v1.2.0" },
      expected: { forge: { kind: "tags" } },
    },
    {
      // A deploy is asked again in HQ, and its record comes back down HQ's stream.
      verb: { kind: "redeploy", groupId: "g1", projectId: "p-stage", service: "api" },
      expected: { forge: null },
    },
  ];

  it.each(cases)("$verb.kind invalidates what it changed", ({ verb, expected }) => {
    expect(flowVerbInvalidations(verb)).toEqual(expected);
  });
});
