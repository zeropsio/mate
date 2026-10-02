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
      // A change merges, and closes, in HQ, and comes back down HQ's stream: nothing is read again.
      verb: { kind: "merge", groupId: "g1", repository: "appdev", number: 4 },
      expected: { releases: false },
    },
    {
      verb: { kind: "close", groupId: "g1", repository: "group", number: 2 },
      expected: { releases: false },
    },
    {
      // A release, and a rollback, is made in HQ, which its stream does not carry: the
      // application's releases are read again.
      verb: { kind: "release", groupId: "g1" },
      expected: { releases: true },
    },
    {
      verb: { kind: "roll-back", groupId: "g1", tag: "v1.2.0" },
      expected: { releases: true },
    },
    {
      // A deploy is asked again in HQ, and its record comes back down HQ's stream.
      verb: { kind: "redeploy", groupId: "g1", projectId: "p-stage", service: "api" },
      expected: { releases: false },
    },
  ];

  it.each(cases)("$verb.kind invalidates what it changed", ({ verb, expected }) => {
    expect(flowVerbInvalidations(verb)).toEqual(expected);
  });
});
