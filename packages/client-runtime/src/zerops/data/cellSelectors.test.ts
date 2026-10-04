import { describe, expect, it } from "@effect/vitest";

import type { ZeropsLocation, ZeropsOrganizationMember } from "../api.ts";
import type { Shown } from "../knowledge/index.ts";
import { selectLocationChoice, selectMembers, settledValue } from "./cellSelectors.ts";

const PRAGUE: ZeropsLocation = { id: "prg1", name: "Prague", pingUrl: "https://ping.test" };
const FAILURE = { kind: "transport", detail: "Zerops did not answer." } as const;

/** Every state a broker resource can be shown in, around `value`. */
function everyState<T>(value: T): ReadonlyArray<readonly [string, Shown<T>]> {
  const known = (freshness: Extract<Shown<T>, { state: "known" }>["freshness"]): Shown<T> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness,
  });
  return [
    ["unread", { state: "unread", waitingFor: null }],
    ["reading", { state: "reading", sinceMs: 0, attempt: 1 }],
    ["failed", { state: "failed", failure: FAILURE, atMs: 0, attempt: 1, retryAtMs: 2_000 }],
    ["known settled", known({ kind: "settled" })],
    ["known revalidating", known({ kind: "revalidating", sinceMs: 1 })],
    [
      "known stale",
      known({
        kind: "stale",
        reason: { kind: "revalidation-failed", failure: FAILURE, attempt: 1, retryAtMs: 2_000 },
        sinceMs: 1,
      }),
    ],
    ["withheld", { state: "withheld", reason: "access-lapsed", cause: null }],
  ];
}

describe("selectLocationChoice", () => {
  const expected: Readonly<Record<string, ReturnType<typeof selectLocationChoice>>> = {
    unread: { status: "loading", locations: [] },
    reading: { status: "loading", locations: [] },
    failed: { status: "failed", locations: [] },
    "known settled": { status: "ready", locations: [PRAGUE] },
    "known revalidating": { status: "ready", locations: [PRAGUE] },
    "known stale": { status: "ready", locations: [PRAGUE] },
    withheld: { status: "loading", locations: [] },
  };
  it.each(everyState<ReadonlyArray<ZeropsLocation>>([PRAGUE]))("%s", (name, shown) => {
    expect(selectLocationChoice(shown)).toEqual(expected[name]);
  });
});

describe("settledValue", () => {
  // Only a read that settled the resource and succeeded answers a one-shot reader.
  const expected: Readonly<Record<string, ReturnType<typeof settledValue<string>>>> = {
    unread: null,
    reading: null,
    failed: null,
    "known settled": { value: "v1" },
    "known revalidating": null,
    "known stale": null,
    withheld: null,
  };
  it.each(everyState("v1"))("%s", (name, shown) => {
    expect(settledValue(shown)).toEqual(expected[name]);
  });
});

describe("selectMembers", () => {
  const members = [{ id: "member-1" }] as unknown as ReadonlyArray<ZeropsOrganizationMember>;
  const expected: Readonly<Record<string, ReturnType<typeof selectMembers>>> = {
    unread: { status: "loading", members: [] },
    reading: { status: "loading", members: [] },
    failed: { status: "failed", members: [] },
    "known settled": { status: "ready", members },
    "known revalidating": { status: "ready", members },
    "known stale": { status: "ready", members },
    withheld: { status: "failed", members: [] },
  };
  it.each(everyState(members))("%s", (name, shown) => {
    expect(selectMembers(shown)).toEqual(expected[name]);
  });
});
