/**
 * Mates' overviews as the tests make them (`@t3tools/shared/mateLink`).
 *
 * @module test/harness/overviews
 */
import type { ConversationRow } from "@t3tools/contracts";
import type { MateOverview, ThreadDigest } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";

const AT = "2026-10-03T10:00:00.000Z";

/** A chat of the Mate's as its overview lists it. */
export const digest = (id: string, kind: ThreadDigest["kind"] = "idle"): ThreadDigest =>
  ({
    id,
    title: `Chat ${id}`,
    kind,
    turnId: null,
    turnState: null,
    completedAt: null,
  }) as ThreadDigest;

/** An engine conversation as its Mate rows it: `state` and `snippet` over an idle one's. */
export const row = (
  id: string,
  state: ConversationRow["state"] = { kind: "idle" },
  snippet: string | null = null,
): ConversationRow =>
  ({
    conversationId: id,
    agent: null,
    revision: { environmentId: "env-1", epoch: 1, seq: 1 },
    state,
    activeRunId: null,
    latestRun: null,
    subject: `Task ${id}`,
    snippet,
    at: 1_791_000_000_000,
    askedAt: null,
  }) as ConversationRow;

/** A Mate's whole overview: one idle chat, nothing signed in, no crew; `patch` over it. */
export const overviewOf = (patch: Partial<MateOverview> = {}): MateOverview =>
  ({
    identity: { environmentId: "env-1", serverVersion: "0.16.0", update: null },
    main: null,
    threads: { list: [digest("t1")], omitted: 0 },
    logins: {},
    crew: { status: "off" },
    ...patch,
  }) as MateOverview;

/** A main chat at work on a step: what changes with every tool call. */
export const mainAt = (step: string) =>
  ({
    id: "t1",
    title: "Chat t1",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    session: { status: "running", lastError: null },
    latestTurn: null,
    latestUserMessageAt: null,
    updatedAt: AT,
    latestUserMessagePreview: null,
    latestMessagePreview: null,
    planProgress: { step },
    pendingQuestion: null,
    usagePause: null,
    liveStep: null,
  }) as unknown as NonNullable<MateOverview["main"]>;
