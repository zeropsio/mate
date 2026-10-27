// @effect-diagnostics globalDate:off -- calendar days of a time zone, and the read's window built when the sampled read runs, are wall-clock arithmetic.
/**
 * What every project of the organization cost on Zerops, day by day over the last 30 days, as
 * billing answers it (`POST /transaction-debit/group-by-search`, grouped by project, by the day in
 * the viewer's time zone). One read serves every project: the overview's cards and a project's page
 * share it. Cost moves by the hour, so a new demand reads it again only once the last read is an
 * hour old, and a screen holding it reads nothing more often than that. A viewer billing refuses
 * holds no figure: unknown, never zero.
 *
 * @module data/families/projectSpend
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** A calendar day, `YYYY-MM-DD`, in the time zone the read asked for. */
export type SpendDay = string;

export interface ProjectSpendValue {
  /** The window's first and last day (today, when it was read), in the read's time zone. */
  readonly firstDay: SpendDay;
  readonly lastDay: SpendDay;
  /** Each project's cost by day, in dollars; a day it has no row for cost nothing. */
  readonly byProject: Readonly<Record<string, Readonly<Record<SpendDay, number>>>>;
  /**
   * Whether the answer held every row it counted (`totalHits`): a project missing from a partial
   * answer is unknown, never free.
   */
  readonly complete: boolean;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly projectSpend: ProjectSpendValue;
  }
}

/** The window read: 30 days, today the last of them. */
export const SPEND_DAYS = 30;
/** Cost moves by the hour: a read younger than this answers a new demand. */
export const SPEND_FRESH_MS = 3_600_000;

const DAY = /^\d{4}-\d{2}-\d{2}/u;
const DAY_MS = 86_400_000;

/** The calendar day an instant falls on in a time zone. */
export function dayIn(at: number, timeZone: string): SpendDay {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** A day `count` days after (or before) another. */
export function addDays(day: SpendDay, count: number): SpendDay {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

/** How far a time zone's clock runs ahead of UTC at an instant, in milliseconds. */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wall - (at - (at % 1000));
}

/** The instant a day begins in a time zone (its midnight, across a daylight-saving change too). */
export function midnightIn(day: SpendDay, timeZone: string): number {
  const wall = Date.parse(`${day}T00:00:00.000Z`);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/**
 * The read's window, in the viewer's zone: from the midnight 29 days before today to the midnight
 * that ends today. Billing answers today's partial bucket only for a window that reaches the start
 * of tomorrow (measured live: a `till` of 23:59:59 today answers 29 buckets).
 */
export function spendWindow(now: number, timeZone: string) {
  const today = dayIn(now, timeZone);
  return {
    from: new Date(midnightIn(addDays(today, 1 - SPEND_DAYS), timeZone)).toISOString(),
    till: new Date(midnightIn(addDays(today, 1), timeZone)).toISOString(),
  };
}

/** The window's last day: a `till` at midnight ends the day before it. */
const lastDayOf = (till: string): SpendDay =>
  /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(till)
    ? addDays(till.slice(0, 10), -1)
    : till.slice(0, 10);

const Item = Schema.Struct({
  projectId: Schema.NonEmptyString,
  from: Schema.String.check(Schema.isPattern(DAY)),
  sumTotalPrice: Schema.Finite,
});
const Answer = Schema.Struct({
  items: Schema.Array(Schema.Unknown),
  totalHits: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  from: Schema.String.check(Schema.isPattern(DAY)),
  till: Schema.String.check(Schema.isPattern(DAY)),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const decodeItem = Schema.decodeUnknownOption(Item);

/**
 * The answer as a screen needs it. A bucket's day is the date its `from` names as Zerops wrote it,
 * in the zone asked (`2026-09-18T00:00:00+02:00` is the 18th), never that instant's UTC date.
 */
export function decodeProjectSpend(answer: unknown): ProjectSpendValue | null {
  return Option.match(decodeAnswer(answer), {
    onNone: () => null,
    onSome: (listing) => {
      const byProject: Record<string, Record<SpendDay, number>> = {};
      let read = 0;
      for (const raw of listing.items) {
        const item = Option.getOrNull(decodeItem(raw));
        if (item === null) continue;
        read += 1;
        const day = item.from.slice(0, 10);
        const days = (byProject[item.projectId] ??= {});
        days[day] = (days[day] ?? 0) + item.sumTotalPrice;
      }
      return {
        firstDay: listing.from.slice(0, 10),
        lastDay: lastDayOf(listing.till),
        byProject,
        complete:
          read === listing.items.length &&
          (listing.totalHits == null || listing.totalHits <= listing.items.length),
      };
    },
  });
}

/** The search: the organization's whole spend, by project and day (`clientId` is required). */
export function projectSpendSearch(orgId: string, now: number, timeZone: string) {
  return {
    search: [{ name: "clientId", operator: "eq", value: orgId }],
    receiverId: orgId,
    subscriptionName: "project-spend",
    groupBy: "projectId",
    timeGroupBy: "1d",
    timeZone,
    ...spendWindow(now, timeZone),
  };
}

export const projectSpendFamily: FamilySpec<"projectSpend"> = {
  family: "projectSpend",
  authority: "zerops",
  scope: { source: "zerops", suffix: "project-spend", leaving: "removed", demand: "detail" },
  sampled: {
    path: () => "/transaction-debit/group-by-search",
    search: ({ ownerId }) =>
      projectSpendSearch(ownerId, Date.now(), new Intl.DateTimeFormat().resolvedOptions().timeZone),
    decode: decodeProjectSpend,
    freshMs: SPEND_FRESH_MS,
  },
};

/** The organization's spend, demanded with the organization's id as its owner. */
export const projectSpendScope = (orgId: string): ScopeKey =>
  scopeOf(projectSpendFamily, orgId, orgId);
