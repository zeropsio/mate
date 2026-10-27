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
    turnState:
      patch.turnState !== undefined
        ? patch.turnState
        : patch.state !== undefined && patch.state !== "ended"
          ? patch.state === "queued" || patch.state === "unknown"
            ? null
            : "running"
          : patch.end?.kind === "unknown"
            ? null
            : patch.end?.kind === "failed" || patch.end?.kind === "crashed"
              ? "error"
              : patch.end?.kind === "stopped" ||
                  patch.end?.kind === "usage-limit" ||
                  patch.end?.kind === "cut-by-restart"
                ? "interrupted"
                : "completed",
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
  patch: Partial<Omit<ConversationHeader, "runStatus">> & {
    readonly runStatus?: ConversationHeader["runStatus"] | undefined;
  } = {},
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
    runStatus: "ready",
    activeRunId: null,
    latestRunId: null,
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
    runStatus:
      patch.runStatus ??
      (patch.state?.kind === "working" ||
      patch.state?.kind === "waiting" ||
      patch.state?.kind === "queued"
        ? "running"
        : patch.state?.kind === "failed" && patch.latestRun?.end?.kind !== "cut-by-restart"
          ? "error"
          : "ready"),
  }) as ConversationRow;

const itemBase = (runId: string, ordinal: number) => ({
  id: `${runId}/i/${ordinal}`,
  conversationId: runId.split("/r/")[0]!,
  runId,
  seq: ordinal,
  rev: ordinal,
  at: at + ordinal,
});

export const callItem = (
  runId: string,
  ordinal: number,
  patch: Partial<Extract<Item, { kind: "call" }>> = {},
): Item =>
  ({
    ...itemBase(runId, ordinal),
    by: { kind: "mate" },
    kind: "call",
    step: "command",
    tool: { name: "Bash" },
    words: "Ran command",
    state: "done",
    endedAt: at + ordinal + 500,
    ...patch,
  }) as Item;

export const thoughtItem = (
  runId: string,
  ordinal: number,
  preview: string,
  patch: Partial<Extract<Item, { kind: "thought" }>> = {},
): Item =>
  ({
    ...itemBase(runId, ordinal),
    by: { kind: "mate" },
    kind: "thought",
    preview,
    length: preview.length,
    streaming: false,
    ...patch,
  }) as Item;

export const workItem = (
  runId: string,
  ordinal: number,
  patch: Partial<Extract<Item, { kind: "work" }>> = {},
): Item =>
  ({
    ...itemBase(runId, ordinal),
    by: { kind: "mate" },
    kind: "work",
    work: `work-${ordinal}`,
    workKind: "helper",
    status: "running",
    title: "Review the api",
    ...patch,
  }) as Item;

export const markerItem = (
  runId: string,
  ordinal: number,
  marker: Extract<Item, { kind: "marker" }>["marker"],
): Item =>
  ({
    ...itemBase(runId, ordinal),
    by: { kind: "engine" },
    kind: "marker",
    marker,
  }) as Item;

export const unknownItem = (runId: string, ordinal: number, summary: string | null): Item =>
  ({
    ...itemBase(runId, ordinal),
    by: { kind: "engine" },
    kind: "unknown",
    type: "plan-v2",
    summary,
  }) as Item;
