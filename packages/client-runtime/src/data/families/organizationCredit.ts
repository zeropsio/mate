/**
 * Whether an organization is verified (`GET /client/{id}`, its `verifiedByTopUp` and
 * `verifiedManually`): Zerops makes a new organization's first project free and refuses any after it
 * until a first top-up — or Zerops itself — verifies the organization. Sampled while a create dialog
 * is open, read again on every new demand; a viewer Zerops refuses the record reads nothing.
 *
 * @module data/families/organizationCredit
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface OrganizationCreditValue {
  /** A top-up or Zerops verified it: it may make more than its one free project. */
  readonly verified: boolean;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationCredit: OrganizationCreditValue;
  }
}

const Answer = Schema.Struct({
  verifiedByTopUp: Schema.Boolean,
  verifiedManually: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);

export const organizationCreditFamily: FamilySpec<"organizationCredit"> = {
  family: "organizationCredit",
  authority: "zerops",
  scope: { source: "zerops", suffix: "credit", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/client/${encodeURIComponent(ownerId)}`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        onSome: ({ verifiedByTopUp, verifiedManually }) => ({
          verified: verifiedByTopUp || verifiedManually === true,
        }),
      }),
    freshMs: 0,
  },
};

export const creditScope = (orgId: string): ScopeKey =>
  scopeOf(organizationCreditFamily, orgId, orgId);
