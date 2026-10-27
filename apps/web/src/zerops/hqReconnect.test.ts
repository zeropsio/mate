import {
  hqMateOverview,
  hqNavigation,
  makeAccountStore,
  mateAttention,
  readsOfState,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import {
  graceOver,
  hqConfirms,
  hqDrops,
  hqSegmentEnds,
  seedHqNavigation,
} from "@t3tools/client-runtime/data/fixtures";
import { ConversationRow, MateAttention } from "@t3tools/contracts";
import { MateLiveView } from "@t3tools/shared/hqMates";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { mateRowReading } from "../components/zerops/SidebarMateRow.logic";
import { hqOutage } from "./hqNavigation";
import { attentionActivity } from "./mateActivity";

const ORG = "org";
const ASKED = "2026-10-09T13:00:00.000Z";
const DONE = "2026-10-09T13:05:00.000Z";
const NAMES = { vera: "Vera", rosa: "Rosa" } as const;
const decodeMate = Schema.decodeUnknownSync(MateLiveView);
const decodeRow = Schema.decodeUnknownSync(ConversationRow);
const decodeAttention = Schema.decodeUnknownSync(MateAttention);

/** A Mate on the engine, online, its main conversation's row as HQ relays it. */
const mate = (environmentId: string, state: Record<string, unknown>) =>
  decodeMate({
    presence: { online: true, since: ASKED, overview: "live" },
    identity: { environmentId, serverVersion: "0.15.12", update: null },
    main: {
      id: "t1",
      title: "Ship the release",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      interactionMode: "default",
      backgroundLiveness: null,
      session: { status: "ready", lastError: null },
      latestTurn: null,
      latestUserMessageAt: ASKED,
      updatedAt: DONE,
      latestUserMessagePreview: { text: "Ship the release" },
      latestMessagePreview: { role: "assistant", text: "Released." },
      planProgress: null,
      pendingQuestion: null,
      usagePause: null,
      liveStep: null,
    },
    conversations: [
      decodeRow({
        conversationId: "t1",
        agent: { instanceId: "codex", driver: "codex", model: null, profile: { kind: "mate" } },
        revision: { environmentId, epoch: 1, seq: 9 },
        state,
        activeRunId: null,
        latestRun: null,
        subject: "Ship the release",
        snippet: "Released.",
        at: Date.parse(DONE),
        askedAt: null,
      }),
    ],
    threads: { list: [], omitted: 0 },
    logins: {},
    crew: { status: "off" },
  });

const attention = (environmentId: string) =>
  decodeAttention({
    source: { environmentId, epoch: 1, incarnation: "m1", revision: 4 },
    mainThreadId: "t1",
    lastThreadId: "t1",
    working: 0,
    waiting: 0,
    results: [],
    questions: [],
    truncated: false,
  });

/** Vera at rest after her last answer; Rosa paused at her provider's usage limit. */
const seeded = (): AccountStore => {
  const store = makeAccountStore(AtomRegistry.make());
  seedHqNavigation(store, ORG, {
    mates: {
      vera: mate("env-vera", { kind: "idle" }),
      rosa: mate("env-rosa", { kind: "paused", resetsAt: null }),
    },
    attention: { vera: attention("env-vera"), rosa: attention("env-rosa") },
  });
  return store;
};

/** What the top bar under the logo and each menu row show, from what the store holds. */
const surfaces = (store: AccountStore, nowMs: number) => {
  const reads = readsOfState(store.state());
  const navigation = hqNavigation.derive(reads, ORG);
  const rows = Object.fromEntries(
    (Object.keys(NAMES) as Array<keyof typeof NAMES>).map((projectId) => {
      const key = { orgId: ORG, projectId };
      const read = mateAttention.derive(reads, key);
      const activity =
        read.attention === null
          ? undefined
          : attentionActivity({
              attention: read.attention,
              live: read.live,
              unseen: read.unseen,
              environmentId: read.attention.source.environmentId,
              overview: hqMateOverview.derive(reads, key) ?? undefined,
              shells: [],
              lastVisitedAtById: {},
            });
      const view = mateRowReading({
        name: NAMES[projectId],
        connected: false,
        activity,
        mine: true,
      });
      return [projectId, { state: view.state, face: view.face, reply: view.reply }];
    }),
  );
  return {
    topBar: hqOutage(navigation, navigation.downSince ?? null, "24-hour", nowMs)?.line ?? null,
    rows,
  };
};

describe("HQ's planned segment end, as the menu shows it", () => {
  it("a planned HQ reconnect moves nothing in the menu: every row and the top bar keep what they showed", () => {
    const store = seeded();
    const before = surfaces(store, 100_000);
    expect(before.topBar).toBeNull();
    expect(before.rows.rosa).toMatchObject({ state: "paused", face: "sleep" });
    expect(before.rows.vera?.reply).toMatchObject({ kind: "words", text: "Released." });
    hqSegmentEnds(store, ORG, 100_000);
    expect(surfaces(store, 100_100)).toEqual(before);
    hqConfirms(store, ORG, 100_200);
    expect(surfaces(store, 100_200)).toEqual(before);
  });

  it("a dropped HQ socket that comes back within its grace moves nothing either", () => {
    const store = seeded();
    const before = surfaces(store, 60_000);
    hqDrops(store, ORG, 60_000);
    expect(surfaces(store, 61_000)).toEqual(before);
  });

  it("HQ gone past its grace: the top bar says it is not reachable since it went away, the rows what HQ last said", () => {
    const store = seeded();
    const wentAway = Date.parse("2026-10-09T13:27:00.000Z");
    hqDrops(store, ORG, wentAway);
    for (const input of graceOver(store.state())) store.dispatch(input);
    const after = surfaces(store, wentAway + 60_000);
    const since = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(wentAway);
    expect(after.topBar).toContain(`HQ is not reachable since ${since}`);
    expect(after.rows.vera?.reply).toMatchObject({ lastKnown: true });
  });
});
