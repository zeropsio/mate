import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { HqReleaseTarget } from "@t3tools/shared/hqRelease";
import { HQ_FIRST_COMMIT } from "@t3tools/shared/hqChanges";
import { rangeChanges, releaseNavigationOffer } from "./releaseNavigation.ts";

const decodeAttachment = Schema.decodeUnknownSync(HqReleaseTarget);

const candidate = {
  head: "a".repeat(40),
  suggestion: "v0.1.1",
  summary: { subjects: ["Make the bakery greeting dynamic"], total: 1, more: 0, atLeast: false },
};
const ready = { permission: { allow: true }, hasProduction: true, inFlight: null } as const;

describe("HQ navigation release offer", () => {
  it.each([
    ["landed code", candidate, ready, { allow: true }],
    [
      "no production",
      candidate,
      { ...ready, hasProduction: false },
      { allow: false, reason: "There is no production to release to." },
    ],
    [
      "person refused",
      candidate,
      { ...ready, permission: { allow: false, reason: "production_not_writable" } },
      { allow: false, reason: "production_not_writable" },
    ],
    [
      "accepted release",
      candidate,
      { ...ready, inFlight: "v0.1.1" },
      { allow: false, reason: "Releasing v0.1.1…" },
    ],
    [
      "production caught up",
      { ...candidate, summary: { ...candidate.summary, total: 0 } },
      ready,
      { allow: false, reason: "Production already runs what is merged." },
    ],
    [
      "no recipe head",
      { ...candidate, head: null },
      ready,
      { allow: false, reason: "Nothing is merged to release." },
    ],
  ] as const)("%s", (_label, source, input, gate) => {
    const offer = releaseNavigationOffer(source, input);
    expect(offer).toEqual({ ...source, gate, inFlight: input.inFlight });
  });
  it("does not invent a release from incomplete source coverage", () => {
    expect(releaseNavigationOffer(null, ready)).toBeNull();
  });
});

it("Git navigation consumes the accepted attachment and the shared hand-over blocker", () => {
  const releaseTarget = decodeAttachment({
    environmentId: "git-production",
    createdAt: "2026-10-14T00:00:00Z",
    target: { kind: "git", branch: "main", delivery: "direct" },
  });
  const gitCandidate = { ...candidate, releaseTarget };
  expect(releaseNavigationOffer(gitCandidate, { ...ready, hasProduction: false })?.gate).toEqual({
    allow: true,
  });
  const blocked = {
    ...gitCandidate,
    readiness: { allow: false, reason: "Releasing v0.1.0…" } as const,
  };
  expect(releaseNavigationOffer(blocked, ready)).toEqual({
    ...gitCandidate,
    gate: { allow: false, reason: "Releasing v0.1.0…" },
    inFlight: null,
  });
  expect(
    releaseNavigationOffer(blocked, {
      ...ready,
      permission: { allow: false, reason: "not_releaser" },
    })?.gate,
  ).toEqual({ allow: false, reason: "not_releaser" });
});

// The onboarding run: the card and the menu said "2 changes ready to release" where the release's
// own review listed one, because a first release's range from the root held HQ's empty first commit.
describe("what a release's range counts", () => {
  const commit = (sha: string, message: string, name = "Acme Builder") => ({
    sha: sha.repeat(40),
    message,
    author: { name, email: "builder@example.invalid" },
    parents: [],
    committedAt: "2026-10-16T09:00:00Z",
  });
  it.each([
    {
      case: "every change the range lists",
      items: [commit("b", "Add the tea list"), commit("c", "Search teas by name")],
      total: 2,
      changes: ["Add the tea list", "Search teas by name"],
      unlisted: 0,
    },
    {
      case: "a first release from the root: never HQ's empty first commit",
      items: [
        commit("b", "Add the tea list\n\nBody"),
        commit("a", HQ_FIRST_COMMIT.subject, HQ_FIRST_COMMIT.authorName),
      ],
      total: 2,
      changes: ["Add the tea list"],
      unlisted: 0,
    },
    {
      case: "a commit of someone else's with the same words",
      items: [commit("a", HQ_FIRST_COMMIT.subject)],
      total: 1,
      changes: [HQ_FIRST_COMMIT.subject],
      unlisted: 0,
    },
    {
      case: "a range cut short: the ones it did not list",
      items: [commit("b", "Add the tea list")],
      total: 5,
      changes: ["Add the tea list"],
      unlisted: 4,
    },
  ])("counts $case", ({ items, total, changes, unlisted }) => {
    const counted = rangeChanges({ items, total, truncated: total > items.length });
    expect([[...counted.listed.values()], counted.unlisted]).toEqual([changes, unlisted]);
  });
});
