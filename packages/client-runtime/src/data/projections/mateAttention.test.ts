import type { MateAttention } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attention } from "../__fixtures__/mateAttention.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { hqMateAttentionScope, mateAttentionScope } from "../families/mateAttention.ts";
import { emptyAccount, linkKeys, type AccountState, type StreamKey } from "../model.ts";
import { reduceAccount, streamOf, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { matesAttention } from "./mateAttention.ts";

const ORG = "org";
const P = "ada";
const hqRevision = (revision: number) => ({ kind: "hq", incarnation: "a1", revision }) as const;

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((next, input) => reduceAccount(next, input).state, state);
const stream = (key: StreamKey, event: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event,
});
const goLive = (key: StreamKey): ReadonlyArray<AccountInput> => [
  stream(key, { kind: "demand", demanded: true }),
  stream(key, { kind: "attempt" }),
  stream(key, { kind: "handshake" }),
  stream(key, { kind: "baseline-committed" }),
];
const fault = (key: StreamKey) =>
  stream(key, {
    kind: "fault",
    fault: { outcome: "transient", message: "The socket broke." },
    jitter: 0,
  });

/** An open Mate's own link, live, having said `value`. */
const direct = (value: MateAttention): ReadonlyArray<AccountInput> => [
  ...goLive(linkKeys.mate(P)),
  ...goLive(mateAttentionScope(P)),
  {
    kind: "rows",
    scope: mateAttentionScope(P),
    generation: 1,
    method: "baseline",
    via: "mate-direct",
    rows: [
      {
        family: "mateAttention",
        id: P,
        value,
        revision: {
          kind: "mate-attention",
          environmentId: value.source.environmentId,
          epoch: value.source.epoch,
          incarnation: value.source.incarnation,
          revision: value.source.revision,
          live: true,
        },
      },
    ],
  },
];

/** HQ's link live, relaying `value` with the Mate's link to HQ `state`. */
const relay = (
  value: MateAttention,
  state: "live" | "stored" = "live",
  revision = 1,
): ReadonlyArray<AccountInput> => [
  ...goLive(linkKeys.hq(ORG)),
  ...goLive(hqMateScope(ORG, P)),
  ...goLive(hqMateAttentionScope(ORG, P)),
  {
    kind: "hq-delivery",
    scopes: [
      { scope: hqMateScope(ORG, P), generation: 1 },
      { scope: hqMateAttentionScope(ORG, P), generation: 1 },
    ],
    reset: revision === 1,
    rows: [
      {
        family: "hqMate",
        id: P,
        revision: hqRevision(revision),
        value: {
          presence: { online: state === "live", since: "2026-10-06T00:00:00Z", overview: state },
          overview: null,
          attention: value,
          attentionState: state,
        },
      },
      {
        family: "mateAttention",
        id: P,
        revision: {
          kind: "mate-attention",
          environmentId: value.source.environmentId,
          epoch: value.source.epoch,
          incarnation: value.source.incarnation,
          revision: value.source.revision,
          live: state === "live",
        },
        value,
      },
    ],
    removals: [],
  },
];

const placed = (unseen: number | null): ReadonlyArray<AccountInput> => [
  ...goLive(placementsScope(ORG)),
  {
    kind: "hq-delivery",
    scopes: [{ scope: placementsScope(ORG), generation: 1 }],
    reset: true,
    rows: [
      {
        family: "placement",
        id: P,
        revision: { kind: "hq", incarnation: "n1", revision: 1 },
        value: {
          projectId: P,
          appId: null,
          name: P,
          kind: "mate",
          mate: null,
          person: {
            role: "DEVELOPER",
            mayWrite: true,
            mine: true,
            ownerUserId: null,
            waitsOnViewer: false,
            unseen,
          },
          signedInNow: {},
          everSignedIn: {},
        },
      },
    ],
    removals: [],
  },
];

const read = (inputs: ReadonlyArray<AccountInput>) =>
  matesAttention.derive(readsOfState(apply(emptyAccount, inputs)), {
    orgId: ORG,
    projectIds: [P],
  })[P];

describe("matesAttention", () => {
  it.each([
    {
      name: "nothing said of a Mate yet",
      inputs: [],
      expected: { attention: null, live: false, unseen: null },
    },
    {
      name: "an open Mate saying it straight",
      inputs: direct(attention("m1", 3, 1)),
      expected: { attention: attention("m1", 3, 1), live: true, unseen: null },
    },
    {
      name: "a Mate HQ relays while its link to HQ is up",
      inputs: relay(attention("m1", 3)),
      expected: { attention: attention("m1", 3), live: true, unseen: null },
    },
    {
      name: "HQ live, the Mate's link to HQ down: its last word, not live",
      inputs: relay(attention("m1", 3), "stored"),
      expected: { attention: attention("m1", 3), live: false, unseen: null },
    },
    {
      name: "a Mate HQ relays, HQ's link down",
      inputs: [...relay(attention("m1", 3)), fault(linkKeys.hq(ORG))],
      expected: { attention: attention("m1", 3), live: false, unseen: null },
    },
    {
      name: "an open Mate closed again, HQ relaying the same revision live",
      inputs: [
        ...direct(attention("m1", 5, 1)),
        stream(linkKeys.mate(P), { kind: "demand", demanded: false }),
        ...relay(attention("m1", 5, 1)),
      ],
      expected: { attention: attention("m1", 5, 1), live: true, unseen: null },
    },
    {
      name: "an open Mate closed again, HQ's relay behind it",
      inputs: [
        ...direct(attention("m1", 5, 1)),
        stream(linkKeys.mate(P), { kind: "demand", demanded: false }),
        ...relay(attention("m1", 4)),
      ],
      expected: { attention: attention("m1", 5, 1), live: false, unseen: null },
    },
    {
      name: "what HQ counts the person has not seen",
      inputs: [...placed(2), ...relay(attention("m1", 3))],
      expected: { attention: attention("m1", 3), live: true, unseen: 2 },
    },
  ])("$name", ({ inputs, expected }) => {
    expect(read(inputs)).toEqual(expected);
  });

  it("reads each Mate it is asked for, one outage apart from another", () => {
    const state = apply(emptyAccount, direct(attention("m1", 1)));
    expect(streamOf(state, mateAttentionScope(P)).phase).toBe("live");
    expect(
      matesAttention.derive(readsOfState(state), { orgId: ORG, projectIds: [P, "bea"] }),
    ).toEqual({
      [P]: { attention: attention("m1", 1), live: true, unseen: null },
      bea: { attention: null, live: false, unseen: null },
    });
  });
});
