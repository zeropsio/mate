/** Engine records as the wire carries them, for the engine conversation's tests. */
import type {
  ConversationHeader,
  ConversationRow,
  Item,
  Request,
  RequestAsk,
  RunRecord,
} from "@t3tools/contracts";

const at = 1_760_000_000_000;

export const engineRun = (
  conversationId: string,
  ordinal: number,
  patch: Partial<RunRecord> = {},
): RunRecord =>
  ({
    id: `${conversationId}/r/${ordinal}`,
    conversationId,
    ordinal,
    seq: ordinal,
    rev: ordinal,
    trigger: { kind: "person", itemId: `${conversationId}/r/${ordinal}/i/1` },
    joins: null,
    principal: { kind: "person", subject: "user-ada" },
    state: "ended",
    maintenance: false,
    waitingOn: null,
    stopAsked: null,
    end: { kind: "completed" },
    endSource: "agent",
    sessionId: null,
    providerTurnId: null,
    queuedAt: at,
    admittedAt: at,
    startedAt: at,
    endedAt: at + 1_000,
    unresponsiveSince: null,
    summary: { items: 0, calls: {}, answerItemId: null, lastItemSeq: null },
    ...patch,
  }) as RunRecord;

export const personItem = (
  runId: string,
  ordinal: number,
  text: string,
  patch: Partial<Extract<Item, { kind: "person" }>> = {},
): Item =>
  ({
    id: `${runId}/i/${ordinal}`,
    conversationId: runId.split("/r/")[0]!,
    runId,
    seq: ordinal,
    rev: ordinal,
    at: at + ordinal,
    by: { kind: "person", principal: { kind: "person", subject: "user-ada" } },
    kind: "person",
    text,
    attachments: [],
    sendId: `send-${runId}-${ordinal}`,
    delivery: { state: "delivered", at: at + ordinal },
    ...patch,
  }) as Item;

export const noteItem = (
  runId: string,
  ordinal: number,
  text: string,
  patch: Partial<Extract<Item, { kind: "note" }>> = {},
): Item =>
  ({
    id: `${runId}/i/${ordinal}`,
    conversationId: runId.split("/r/")[0]!,
    runId,
    seq: ordinal,
    rev: ordinal,
    at: at + ordinal,
    by: { kind: "mate" },
    kind: "note",
    text,
    streaming: false,
    answer: true,
    ...patch,
  }) as Item;

export const engineRequest = (
  runId: string,
  ordinal: number,
  ask: RequestAsk,
  patch: Partial<Request> = {},
): Request =>
  ({
    id: `${runId}/q/${ordinal}`,
    conversationId: runId.split("/r/")[0]!,
    runId,
    seq: ordinal,
    rev: ordinal,
    at: at + ordinal,
    ask,
    state: "open",
    answerable: true,
    principal: { kind: "person", subject: "user-ada" },
    ...patch,
  }) as Request;

export const engineHeader = (
  conversationId: string,
  patch: Partial<ConversationHeader> = {},
): ConversationHeader =>
  ({
    conversationId,
    agent: {
      instanceId: "claudeAgent",
      driver: "claudeAgent",
      model: "claude-sonnet-4-5",
      profile: { kind: "mate" },
    },
    archived: false,
    model: "claude-sonnet-4-5",
    session: null,
    pausedUntil: null,
    queued: 0,
    ...patch,
  }) as ConversationHeader;

export const engineRow = (
  environmentId: string,
  conversationId: string,
  patch: Partial<ConversationRow> = {},
): ConversationRow =>
  ({
    conversationId,
    agent: engineHeader(conversationId).agent,
    revision: { environmentId, epoch: 1, seq: 1 },
    state: { kind: "idle" },
    activeRunId: null,
    latestRun: null,
    subject: null,
    snippet: null,
    at,
    askedAt: null,
    ...patch,
  }) as ConversationRow;
