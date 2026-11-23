import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { HqAccessOperation } from "@t3tools/shared/hqAccessOperation";
import { recorded } from "../__fixtures__/recorded.ts";
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
    failure: { step: "grants", code: "token_expired", at, origin: "hq" },
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
    failure: { step: "invite", code: "names_required", at, origin: "hq" },
  },
};

// witness: packages/client-runtime/src/data/projections/accessOperations.ts | return [...values] → return values.filter(({ operation }) => operation?.failure !== undefined)
it("PJ126: A person's running access change is shown until HQ ends it, one waiting for its maker offers Continue and Delete, and a failed one offers Delete with its reason in words", () => {
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
      details: null,
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
      details: null,
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
          failure: { step: "search", code: "invitation_moved", at, origin: "hq" },
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
    details: null,
    mine: false,
  });
  // HQ's own frame of a change it has just accepted reads as running.
  const frame = recorded("scope-values", "mate-hq/navigation.access-change.running");
  const accepted = Schema.decodeUnknownSync(HqAccessOperation)(frame.values[0]?.value);
  expect(accessOperationRows([accepted], "ada")[0]).toMatchObject({
    kind: "projects",
    state: "running",
  });
});

const decodeAccessOperation = Schema.decodeUnknownSync(HqAccessOperation);
const rowFor = (failure: unknown) =>
  accessOperationRows(
    [
      decodeAccessOperation({
        id: "op-remove",
        change: { kind: "remove", userId: "eva" },
        operation: { kind: "access", phase: "removal_requested", at, acceptedAt, failure },
      }),
    ],
    "ada",
  )[0]!;

// witness: packages/client-runtime/src/data/projections/accessOperations.ts | details: operationFailureDetails(failure) → details: JSON.stringify(failure, null, 2)
it("PJ130: An access change's row says its failure by who stopped it and holds Zerops' answer only for a refusal by Zerops; breaks: a person reads a machine code although Zerops said what to do first, or support gets no answer to look at", () => {
  const code = "deleteExistingApplicationTokens";
  const refusal = {
    step: "remove",
    code,
    at,
    origin: "zerops",
    zerops: { words: "M", status: 409, error: { code, message: "M" }, request: null },
  };
  const refused = rowFor(refusal);
  expect(refused.failure).toContain("M");
  expect(refused.failure).not.toContain(code);
  expect(refused.details).toContain("M");
  expect(refused.details).toContain(code);

  const withoutWords = rowFor({ ...refusal, zerops: { ...refusal.zerops, words: null } });
  expect(withoutWords.failure).toContain(code);

  const stoppedByHq = rowFor({ step: "search", code: "not_member", at, origin: "hq" });
  expect(stoppedByHq.failure).not.toContain("not_member");
  expect(stoppedByHq.details).toBeNull();
});
