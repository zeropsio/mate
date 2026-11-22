import { expect, it } from "vite-plus/test";
import type { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";
import { accessOperationRows } from "./accessOperations.ts";

const acceptedAt = "2026-11-21T10:00:00.000Z";
const at = "2026-11-21T10:00:05.000Z";
const running: HqAccessOperation = {
  id: "op-role",
  change: { kind: "role", userId: "eva" },
  operation: { kind: "access", phase: "role_requested", at, acceptedAt },
};
const waiting: HqAccessOperation = {
  id: "op-projects",
  change: { kind: "projects", userId: "jan", projectIds: ["p1"] },
  operation: {
    kind: "access",
    phase: "grants_requested",
    at,
    acceptedAt: "2026-11-21T10:01:00.000Z",
    failure: { step: "grants", code: "token_expired", at },
    continueBy: "ada",
  },
};
const failed: HqAccessOperation = {
  id: "op-resend",
  change: { kind: "resend", userId: "iva" },
  operation: {
    kind: "access",
    phase: "invite_requested",
    at,
    acceptedAt: "2026-11-21T10:02:00.000Z",
    failure: { step: "invite", code: "names_required", at },
  },
};

// witness: packages/client-runtime/src/data/projections/accessOperations.ts | mine: continueBy === viewer → mine: continueBy !== undefined
it("PJ+1: A person's running access change is shown until HQ ends it, one waiting for its maker offers Continue and Delete, and a failed one offers Delete with its reason in words", () => {
  expect(accessOperationRows([failed, waiting, running], "ada")).toEqual([
    {
      id: "op-role",
      kind: "role",
      userId: "eva",
      state: "running",
      phase: "Changing their role",
      mine: false,
    },
    {
      id: "op-projects",
      kind: "projects",
      userId: "jan",
      projectIds: ["p1"],
      state: "waiting",
      phase: "Giving their project access",
      failure: "Your Zerops sign-in ran out before it finished.",
      continueBy: "ada",
      mine: true,
    },
    {
      id: "op-resend",
      kind: "resend",
      userId: "iva",
      state: "failed",
      phase: "Sending the invitation",
      failure:
        "Zerops has no account for this address any more and needs their first and last name. Invite them again.",
      invitationLost: true,
      mine: false,
    },
  ]);
  // Waiting for someone else's sign-in is no Continue of the viewer's.
  expect(accessOperationRows([waiting], "eva")[0]).toMatchObject({ state: "waiting", mine: false });
  // A Send again that stopped before withdrawing anything lost no invitation.
  const [moved] = accessOperationRows(
    [
      {
        ...failed,
        operation: {
          ...failed.operation!,
          phase: "accepted",
          failure: { step: "search", code: "invitation_moved", at },
        },
      },
    ],
    "ada",
  );
  expect(moved).toEqual({
    id: "op-resend",
    kind: "resend",
    userId: "iva",
    state: "failed",
    phase: "Sending the invitation again",
    failure: "Their invitation changed in Zerops after this started, so nothing was sent again.",
    mine: false,
  });
  // Zerops' own code is named with the step it refused.
  expect(
    accessOperationRows(
      [
        {
          ...failed,
          operation: { ...failed.operation!, failure: { step: "remove", code: "forbidden", at } },
        },
      ],
      "ada",
    )[0]?.failure,
  ).toBe("Zerops refused to remove them (forbidden).");
});
