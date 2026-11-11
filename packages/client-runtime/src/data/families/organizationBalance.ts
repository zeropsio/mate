/**
 * An organization's balance as Zerops keeps it live (`client-status`, listed and pushed for the
 * organization, as the Zerops GUI observes it): its topped-up `credit` and `promoCredit`, which
 * Zerops spends alike, its automatic top-up, and its status. Zerops pushes every change — an hourly
 * charge, a top-up, a promo code — so a top-up made in Zerops shows here before the person is back.
 * A member Zerops shows no finances to is refused this scope alone (`refusedAlone`), and sees no
 * figure. Measured 2026-11-11: one row per organization, `{id, clientId, credit, promoCredit,
 * autoTopUp, status, _version}`, `autoTopUp`'s amounts as decimal strings.
 *
 * @module data/families/organizationBalance
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { PublicRead, ScopeKey } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** Below `threshold`, Zerops charges `amount`, at most `monthlyLimit` a calendar month (UTC). */
export interface AutoTopUp {
  readonly threshold: number;
  readonly amount: number;
  readonly monthlyLimit: number;
}

export interface OrganizationBalanceValue {
  /** The organization the row belongs to: rows are Zerops's own, under their own ids. */
  readonly organizationId: string;
  /** Credit the organization topped up. */
  readonly credit: number;
  /** Credit Zerops granted it: Zerops spends it like topped-up credit. */
  readonly promoCredit: number;
  /** `null`: no automatic top-up is set. */
  readonly autoTopUp: AutoTopUp | null;
  /** The organization's status as billing says it, e.g. `ACTIVE`; `null` where unstated. */
  readonly status: string | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly organizationBalance: OrganizationBalanceValue;
  }
}

/** The index from an organization to its balance row. */
const BALANCE_OF = "balance-of-organization";

const Amount = Schema.optionalKey(Schema.NullOr(Schema.Finite));
const Decimal = Schema.Union([Schema.String, Schema.Finite]);
const Frame = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  credit: Amount,
  promoCredit: Amount,
  autoTopUp: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({ threshold: Decimal, amount: Decimal, calendarMonthlyLimit: Decimal }),
    ),
  ),
  status: Schema.optionalKey(Schema.NullOr(Schema.String)),
  _version: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
});
const decodeFrame = Schema.decodeUnknownOption(Frame);

const amountOf = (value: string | number): number | null => {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
};

function readAutoTopUp(
  value:
    | {
        readonly threshold: string | number;
        readonly amount: string | number;
        readonly calendarMonthlyLimit: string | number;
      }
    | null
    | undefined,
): AutoTopUp | null {
  if (value == null) return null;
  const threshold = amountOf(value.threshold);
  const amount = amountOf(value.amount);
  const monthlyLimit = amountOf(value.calendarMonthlyLimit);
  return threshold === null || amount === null || monthlyLimit === null
    ? null
    : { threshold, amount, monthlyLimit };
}

export const organizationBalanceFamily: FamilySpec<"organizationBalance"> = {
  family: "organizationBalance",
  authority: "zerops",
  scope: { source: "zerops", suffix: "balance", leaving: "removed", demand: "navigation" },
  indexes: [
    {
      name: BALANCE_OF,
      keyOf: (value, listed) => (listed === "removed" ? null : value.organizationId),
    },
  ],
  zerops: {
    entity: "client-status",
    membership: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    updates: ({ orgId }) => [{ name: "clientId", operator: "eq", value: orgId }],
    decode: (raw) =>
      Option.match(decodeFrame(raw), {
        onNone: () => null,
        // Held under the row's own id, as listed; `balanceOf` finds an organization's.
        onSome: ({ id, clientId, credit, promoCredit, autoTopUp, status, _version }) =>
          credit == null && promoCredit == null
            ? null
            : {
                id,
                value: {
                  organizationId: clientId,
                  credit: credit ?? 0,
                  promoCredit: promoCredit ?? 0,
                  autoTopUp: readAutoTopUp(autoTopUp),
                  status: status ?? null,
                },
                version: _version ?? null,
              },
      }),
    // A member Zerops shows no finances to keeps everything else, however Zerops refuses them.
    refusedAlone: "any-refusal",
  },
};

export const balanceScope = (orgId: string): ScopeKey => scopeOf(organizationBalanceFamily, orgId);

const UNKNOWN: PublicRead<OrganizationBalanceValue> = { kind: "unknown" };

/** The organization's balance, by its row: unknown until Zerops listed it. */
export function balanceOf(
  read: ProjectionReads,
  orgId: string,
): PublicRead<OrganizationBalanceValue> {
  for (const id of read.index(BALANCE_OF, orgId)) return read.fact("organizationBalance", id);
  return UNKNOWN;
}
