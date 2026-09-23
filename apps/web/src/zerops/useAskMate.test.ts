import { EnvironmentId } from "@t3tools/contracts";
import type { CandidateLookup } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { askMateTarget } from "./useAskMate";

const connected = EnvironmentId.make("environment-1");

describe("askMateTarget", () => {
  it.each<{
    readonly name: string;
    readonly lookup: CandidateLookup<{ readonly environmentId?: EnvironmentId }>;
    readonly target: object;
  }>([
    {
      name: "an unread listing sends the ask to the projects screen, which says what it still reads, never parks it unseen",
      lookup: { kind: "pending" },
      target: { kind: "projects" },
    },
    {
      name: "a Mate connected to an environment is asked there",
      lookup: { kind: "found", row: { environmentId: connected } },
      target: { kind: "environment", environmentId: connected },
    },
    {
      name: "a Mate not connected goes to the projects screen",
      lookup: { kind: "found", row: {} },
      target: { kind: "projects" },
    },
    {
      name: "a Mate proven absent goes to the projects screen",
      lookup: { kind: "absent" },
      target: { kind: "projects" },
    },
    {
      name: "a listing that cannot say goes to the projects screen, which says why",
      lookup: { kind: "unknown" },
      target: { kind: "projects" },
    },
  ])("$name", ({ lookup, target }) => {
    expect(askMateTarget(lookup)).toEqual(target);
  });
});
