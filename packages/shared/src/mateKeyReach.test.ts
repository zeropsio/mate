import { describe, expect, it } from "vite-plus/test";

import { mateKeyReach } from "./mateKeyReach.ts";

// ADR 0003's fallout, one definition for HQ and the client's harden: a Mate's key reaches its own
// project alone ("own"), or an earlier client widened it with READ_ONLY on siblings ("wider"),
// which Finish setup takes off. Anything else is no Mate's key to touch.
describe("mateKeyReach — what a key of a Mate's project reaches", () => {
  const OWN = { projectId: "p-mate", roleCode: "BASIC_USER" };
  it.each([
    { case: "its own project alone, lowered", grants: [OWN], want: "own" },
    {
      case: "its own project alone, as minted",
      grants: [{ projectId: "p-mate", roleCode: "ADMIN" }],
      want: "own",
    },
    {
      case: "READ_ONLY on siblings beside it",
      grants: [OWN, { projectId: "p-prod", roleCode: "READ_ONLY" }],
      want: "wider",
    },
    {
      case: "a sibling it may write",
      grants: [OWN, { projectId: "p-prod", roleCode: "BASIC_USER" }],
      want: "none",
    },
    {
      case: "READ_ONLY on its own project: no Mate's role",
      grants: [{ projectId: "p-mate", roleCode: "READ_ONLY" }],
      want: "none",
    },
    {
      case: "siblings and not its own",
      grants: [{ projectId: "p-prod", roleCode: "READ_ONLY" }],
      want: "none",
    },
    { case: "nothing", grants: [], want: "none" },
  ])("$case: $want", ({ grants, want }) => {
    expect(mateKeyReach(grants, "p-mate")).toBe(want);
  });
});
