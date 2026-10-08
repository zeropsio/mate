import { describe, expect, it } from "vite-plus/test";

import {
  DOOR_MAX_AGE_MS,
  type DoorInput,
  type DoorVerdict,
  checkDoorToken,
  checkDoorTokenShape,
} from "./zeropsDoor.ts";

/** A throwaway as the platform answered for one, 2026-10-02 (`created` 01:16:07Z, read at the same second). */
const CREATED_MS = Date.parse("2026-10-02T01:16:07Z");
const VALID: DoorInput = {
  doorProjectId: "HQ1",
  orgId: "ORG",
  token: {
    orgId: "ORG",
    name: "mate-door:HQ1:n0nce",
    roleCode: "NO_ACCESS",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projectGrants: 0,
    createdMs: CREATED_MS,
    createdByUser: "U1",
  },
  apiNowMs: CREATED_MS,
  members: [
    { userId: "U0", status: "ACTIVE" },
    { userId: "U1", status: "ACTIVE" },
  ],
};

const token = (patch: Partial<DoorInput["token"]>): DoorInput => ({
  ...VALID,
  token: { ...VALID.token, ...patch },
});

describe("checkDoorToken", () => {
  const cases: ReadonlyArray<readonly [string, DoorInput, DoorVerdict]> = [
    ["a fresh NO_ACCESS throwaway named for this HQ", VALID, { kind: "admitted", userId: "U1" }],
    ["another org's token", token({ orgId: "OTHER" }), { kind: "refused", rule: "wrong_org" }],
    ["a role", token({ roleCode: "READ_ONLY" }), { kind: "refused", rule: "has_rights" }],
    ["a project grant", token({ projectGrants: 1 }), { kind: "refused", rule: "has_rights" }],
    [
      "can create projects",
      token({ canCreateProjects: true }),
      { kind: "refused", rule: "has_rights" },
    ],
    ["sees finances", token({ canViewFinances: true }), { kind: "refused", rule: "has_rights" }],
    ["edits finances", token({ canEditFinances: true }), { kind: "refused", rule: "has_rights" }],
    [
      "named for another HQ",
      token({ name: "mate-door:HQ2:n0nce" }),
      { kind: "refused", rule: "wrong_name" },
    ],
    [
      "named without the separator",
      token({ name: "mate-door:HQ1" }),
      { kind: "refused", rule: "wrong_name" },
    ],
    [
      "minted 299 s before the API's clock",
      { ...VALID, apiNowMs: CREATED_MS + 299_000 },
      { kind: "admitted", userId: "U1" },
    ],
    [
      "minted 301 s before",
      { ...VALID, apiNowMs: CREATED_MS + 301_000 },
      { kind: "refused", rule: "stale" },
    ],
    [
      "dated 301 s after",
      { ...VALID, apiNowMs: CREATED_MS - 301_000 },
      { kind: "refused", rule: "stale" },
    ],
    ["no creation time", token({ createdMs: Number.NaN }), { kind: "refused", rule: "stale" }],
    ["no creator", token({ createdByUser: null }), { kind: "refused", rule: "not_member" }],
    [
      "a creator who is no member",
      token({ createdByUser: "U9" }),
      { kind: "refused", rule: "not_member" },
    ],
    [
      "a creator not active",
      { ...VALID, members: [{ userId: "U1", status: "INVITED" }] },
      { kind: "refused", rule: "not_member" },
    ],
    [
      "no clock of the API's",
      { ...VALID, apiNowMs: undefined },
      { kind: "unavailable", reason: "no_api_clock" },
    ],
    [
      "an empty member list",
      { ...VALID, members: [] },
      { kind: "unavailable", reason: "no_members" },
    ],
  ];
  it.each(
    Array.from(cases, ([name, input, verdict]) => ({
      title: `${name}: ${verdict.kind}`,
      input,
      verdict,
    })),
  )("$title", ({ input, verdict }) => {
    expect(checkDoorToken(input)).toEqual(verdict);
  });

  it("allows exactly five minutes", () => {
    expect(DOOR_MAX_AGE_MS).toBe(300_000);
  });
});

describe("checkDoorTokenShape", () => {
  const shape = ({ doorProjectId, token, apiNowMs }: DoorInput) => ({
    doorProjectId,
    token,
    apiNowMs,
  });
  it("judges what the token's own record decides, before any fact of the org is read", () => {
    expect(
      [
        VALID,
        token({ canViewFinances: true }),
        token({ name: "mate-door:HQ2:n0nce" }),
        { ...VALID, apiNowMs: CREATED_MS + 301_000 },
        { ...VALID, apiNowMs: undefined },
        token({ orgId: "OTHER" }),
      ].map((input) => checkDoorTokenShape(shape(input))),
    ).toEqual([
      undefined,
      { kind: "refused", rule: "has_rights" },
      { kind: "refused", rule: "wrong_name" },
      { kind: "refused", rule: "stale" },
      { kind: "unavailable", reason: "no_api_clock" },
      // The org is the caller's fact, judged by the whole check.
      undefined,
    ]);
  });
});
