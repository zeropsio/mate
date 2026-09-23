import { EnvironmentId } from "@t3tools/contracts";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { changeLandedEventsFor } from "./useZeropsChangeLandedEvents";

const environmentId = EnvironmentId.make("environment-1");

const mate: CandidateRow = {
  key: "mate-1:zcp",
  project: { id: "mate-1", name: "Shop - Fen", status: "ACTIVE", tagList: [] },
  group: "connected",
  environmentId,
  presence: "known",
};

const landed = {
  repository: "appdev",
  number: 4,
  title: "Cache the link previews",
  line: "appdev #4",
  merged: true,
  mergedAt: "2026-09-20T10:00:00Z",
  mateProjectId: "mate-1",
} as FlowPullRequest;

const flows = new Map([["shop", { merged: [landed] }]]);

const known = (value: ReadonlyArray<CandidateRow>): Known<ReadonlyArray<CandidateRow>> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 10 },
  coverage: "complete",
  freshness: { kind: "live" },
});

describe("changeLandedEventsFor", () => {
  it("places the landings of the Mate that lives in the environment", () => {
    expect(changeLandedEventsFor(known([mate]), environmentId, flows)).toEqual([
      {
        key: "change-landed:appdev#4",
        repository: "appdev",
        number: 4,
        title: "Cache the link previews",
        line: "appdev #4",
        landedAt: "2026-09-20T10:00:00Z",
      },
    ]);
  });

  it.each<{ readonly name: string; readonly listing: Known<ReadonlyArray<CandidateRow>> }>([
    { name: "unread", listing: { state: "unread", waitingFor: null } },
    { name: "being read", listing: { state: "reading", sinceMs: 5, attempt: 1 } },
    {
      name: "failed",
      listing: {
        state: "failed",
        failure: { kind: "transport", detail: "gateway" },
        atMs: 5,
        attempt: 1,
        retryAtMs: null,
      },
    },
  ])("a listing that is $name places no landing until it names the Mate", ({ listing }) => {
    expect(changeLandedEventsFor(listing, environmentId, flows)).toEqual([]);
  });
});
