import { EnvironmentId } from "@t3tools/contracts";
import type { ChangeLandedEvent, FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { changeLandedEventsFor, conversationLandings } from "./useZeropsChangeLandedEvents";

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

const giteaOrigin = "https://git.shop.example";

const landing = (repository: string, number: number, landedAt: string): ChangeLandedEvent => ({
  key: `change-landed:${repository}#${String(number)}`,
  repository,
  number,
  title: `Change ${String(number)}`,
  line: `${repository} #${String(number)}`,
  landedAt,
});

const said = (text: string, createdAt = "2026-09-20T09:00:00Z") => ({ text, createdAt });

describe("conversationLandings", () => {
  const titandev7 = landing("titandev", 7, "2026-09-20T10:00:00Z");

  it.each<{
    readonly name: string;
    readonly messages: ReadonlyArray<{ readonly text: string; readonly createdAt: string }>;
    readonly untold?: true;
    readonly placed: ReadonlyArray<ChangeLandedEvent>;
  }>([
    {
      name: "a change this conversation linked",
      messages: [said(`Opened ${giteaOrigin}/shop/titandev/pulls/7 for review.`)],
      placed: [titandev7],
    },
    {
      name: "a change linked in markdown",
      messages: [said(`See [the change](${giteaOrigin}/shop/titandev/pulls/7).`)],
      placed: [titandev7],
    },
    {
      name: "a change another conversation linked",
      messages: [said(`Opened ${giteaOrigin}/shop/titandev/pulls/8.`)],
      placed: [],
    },
    {
      name: "a change on another forge",
      messages: [said("Opened https://github.com/shop/titandev/pulls/7.")],
      placed: [],
    },
    {
      name: "a change on a forge the app was not told of",
      messages: [said(`Opened ${giteaOrigin}/shop/titandev/pulls/7.`)],
      untold: true,
      placed: [],
    },
    {
      name: "a change that landed before the first loaded message",
      messages: [
        said(`${giteaOrigin}/shop/titandev/pulls/7 already landed.`, "2026-09-20T11:00:00Z"),
      ],
      placed: [],
    },
    { name: "an empty conversation", messages: [], placed: [] },
  ])("places $name accordingly", ({ messages, untold, placed }) => {
    const origin = untold ? undefined : giteaOrigin;
    expect(conversationLandings([titandev7], messages, origin)).toEqual(placed);
  });
});
