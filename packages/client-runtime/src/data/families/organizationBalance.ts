/**
 * An organization's balance as billing answers it (`GET /billing/client/{id}/status`, its `credit`
 * and `promoCredit`): Zerops refuses a project after an unverified organization's free one only
 * while it holds no credit, promo credit included. Sampled while a create dialog is open, read again
 * on every new demand; a viewer billing refuses reads nothing.
 *
 * @module data/families/organizationBalance
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface OrganizationBalanceValue {
  /** Credit the organization topped up. */
  readonly credit: number;
  /** Credit Zerops granted it: Zerops spends it like topped-up credit. */
  readonly promoCredit: number;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationBalance: OrganizationBalanceValue;
  }
}

const Amount = Schema.optionalKey(Schema.NullOr(Schema.Finite));
const Answer = Schema.Struct({ credit: Amount, promoCredit: Amount });
const decodeAnswer = Schema.decodeUnknownOption(Answer);

export const organizationBalanceFamily: FamilySpec<"organizationBalance"> = {
  family: "organizationBalance",
  authority: "zerops",
  scope: { source: "zerops", suffix: "balance", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/billing/client/${encodeURIComponent(ownerId)}/status`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        // One amount missing reads as none of it; both missing is an answer that says nothing.
        onSome: ({ credit, promoCredit }) =>
          credit == null && promoCredit == null
            ? null
            : { credit: credit ?? 0, promoCredit: promoCredit ?? 0 },
      }),
    freshMs: 0,
  },
};

export const balanceScope = (orgId: string): ScopeKey =>
  scopeOf(organizationBalanceFamily, orgId, orgId);
