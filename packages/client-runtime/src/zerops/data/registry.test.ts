import { describe, expect, it } from "vite-plus/test";

import type { AbsenceEvidence, Known } from "../knowledge/known.ts";
import { selectRegistry } from "./registry.ts";

const AS_OF = { ordinal: 3, atMs: 1_800_000_000_000 };

const known = <T>(value: T): Known<T> => ({
  state: "known",
  value,
  asOf: AS_OF,
  coverage: "complete",
  freshness: { kind: "live" },
});

const gone = (evidence: AbsenceEvidence): Known<unknown> => ({
  state: "gone",
  evidence,
  asOf: AS_OF,
});

const TAGS = known([
  "mate:tool:gitea",
  "mate:gn:g1:acme",
  "mate:gm:g1:p-live:mate",
  "mate:gm:g1:p-deleted:stage",
  "mate:gm:g1:p-unread:production",
]);

describe("selectRegistry", () => {
  it("an entry whose project is gone (with evidence) is marked stale", () => {
    const projects: Record<string, Known<unknown>> = {
      "p-live": known({}),
      "p-deleted": gone("direct-not-found"),
      "p-unread": { state: "unread", waitingFor: null },
    };

    const registry = selectRegistry(TAGS, (projectId) => projects[projectId]!);

    expect(registry).toMatchObject({ state: "known", coverage: "complete", asOf: AS_OF });
    if (registry.state !== "known") return;
    // Kept, never dropped, and never shown as a member that is there.
    expect(registry.value.groups[0]?.projects).toEqual([
      { projectId: "p-live", kind: "mate", standing: { kind: "present" } },
      {
        projectId: "p-deleted",
        kind: "stage",
        standing: { kind: "stale", evidence: "direct-not-found" },
      },
      { projectId: "p-unread", kind: "production", standing: { kind: "unknown" } },
    ]);
  });

  it.each<{ readonly name: string; readonly tags: Known<ReadonlyArray<string>> }>([
    { name: "unread", tags: { state: "unread", waitingFor: "access-grant" } },
    { name: "being read", tags: { state: "reading", sinceMs: 1, attempt: 1 } },
    {
      name: "failed",
      tags: {
        state: "failed",
        failure: { kind: "offline" },
        atMs: 1,
        attempt: 1,
        retryAtMs: null,
      },
    },
    { name: "gone", tags: { state: "gone", evidence: "direct-forbidden", asOf: AS_OF } },
  ])("is $name while the Gitea project's tags are, never an empty registry", ({ tags }) => {
    expect(selectRegistry(tags, () => known({}))).toEqual(tags);
  });

  it("is as current as the tags it was read from", () => {
    const tags: Known<ReadonlyArray<string>> = {
      ...TAGS,
      state: "known",
      value: ["mate:gn:g1:acme"],
      freshness: { kind: "paused", by: "background" },
    } as Known<ReadonlyArray<string>>;

    expect(selectRegistry(tags, () => known({}))).toMatchObject({
      state: "known",
      freshness: { kind: "paused", by: "background" },
      value: { groups: [{ groupId: "g1", slug: "acme", projects: [] }], leaving: [] },
    });
  });
});
