import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { HqReleaseTarget } from "@t3tools/shared/hqRelease";
import { releaseNavigationOffer } from "./releaseNavigation.ts";

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
