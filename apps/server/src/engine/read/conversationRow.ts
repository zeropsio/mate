/**
 * The menu row (`ConversationRow`): what the sidebar, the face and HQ's relayed row read of a
 * conversation, from its view. Its subject is the person's latest message's first line, its
 * snippet the agent's latest words, its state the run's — and a run a restart cut says why and
 * whether it carries on. Pure; texts masked and cut to what a row shows.
 *
 * @module engine/read/conversationRow
 */
import type { ConversationRow, ConversationRowState, RunEnd } from "@t3tools/contracts";
import { maskSecrets, messagePreviewText } from "@t3tools/shared/messagePreview";
import { attachmentsLabel, userAskOf, type UserAskSource } from "@t3tools/shared/userAsk";

import type { ConversationView, ViewRequest, ViewRun } from "./conversationView.ts";

/** The longest text a row carries (wire.md §2.3). */
export const ROW_TEXT_MAX = 280;

/** A text as a row carries it: its credentials masked, trimmed, cut; none where nothing is left. */
export const rowText = (value: string | null | undefined, max = ROW_TEXT_MAX): string | null => {
  const text = maskSecrets(value ?? "").trim();
  if (text.length === 0) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

/**
 * The first line of the person's ask, quoted as V1's row quotes a message (`userAskPreviewText`):
 * a picture's label is no word they wrote, a message of pictures alone reads as their count.
 */
const subjectOf = (person: UserAskSource): string | null => {
  const ask = userAskOf(person);
  if (ask === null) return null;
  if (ask.kind === "attachments") return rowText(attachmentsLabel(ask));
  const line = ask.text.split("\n").find((candidate) => candidate.trim().length > 0);
  return line === undefined ? null : rowText(messagePreviewText(line));
};

/**
 * A run a restart cut, for the person: what the platform said happened, and whether the run
 * carries on by itself or waits for them.
 */
export const restartLine = (end: Extract<RunEnd, { readonly kind: "cut-by-restart" }>): string => {
  const words = end.words ?? "The Mate restarted.";
  return end.notContinued === undefined
    ? `${words} The run was cut and carries on where it stopped.`
    : `${words} The run was cut and not continued (${end.notContinued}): send a message to go on.`;
};

/** Why a run broke off, in the words a row shows; none for an end that is no failure. */
export const brokeOffLine = (end: RunEnd | null): string | null => {
  switch (end?.kind) {
    case "failed":
      return end.reason;
    case "crashed":
      return end.reason;
    case "cut-by-restart":
      return end.continuedBy === null && end.notContinued !== undefined ? restartLine(end) : null;
    default:
      return null;
  }
};

/** What a request asks, in a row's words. */
const askWords = (request: ViewRequest): string | null => {
  const ask = request.ask;
  switch (ask.kind) {
    case "approval":
      return rowText(ask.detail);
    case "question": {
      const first = ask.questions[0] as { readonly question?: unknown } | undefined;
      return typeof first?.question === "string" ? rowText(first.question) : null;
    }
    case "vault":
      return rowText(ask.reason ?? ask.key);
    default:
      return null;
  }
};

const WAITS_ON = ["approval", "question", "vault", "plan"] as const;
type WaitsOn = (typeof WAITS_ON)[number];
const waitsOn = (kind: string): kind is WaitsOn =>
  (WAITS_ON as ReadonlyArray<string>).includes(kind);

/** The row's state: a question first, then the run on, the queue, a pause, a failure, rest. */
export const rowStateOf = (view: ConversationView): ConversationRowState => {
  const active = view.activeRun;
  const asked = view.openRequests.find(
    (request) => request.runId === active?.id && waitsOn(request.ask.kind),
  );
  if (asked !== undefined && waitsOn(asked.ask.kind)) {
    return { kind: "waiting", on: asked.ask.kind, words: askWords(asked) };
  }
  if (active !== null && (active.state === "running" || active.state === "waiting")) {
    return { kind: "working", since: active.startedAt ?? active.queuedAt, waitsOnHelpers: false };
  }
  if (view.pausedUntil !== null) {
    return { kind: "paused", resetsAt: view.pausedUntil === "unknown" ? null : view.pausedUntil };
  }
  const waiting = active ?? view.queued[0];
  if (waiting !== undefined) return { kind: "queued", since: waiting.queuedAt };
  if (view.background === "working") {
    return {
      kind: "working",
      since: view.lastEnded?.endedAt ?? view.updatedAt,
      waitsOnHelpers: true,
    };
  }
  const brokeOff = brokeOffLine(view.lastEnded?.end ?? null);
  if (brokeOff !== null) return { kind: "failed", errorLine: rowText(brokeOff) ?? "…" };
  return { kind: "idle" };
};

const latestOf = (view: ConversationView): ViewRun | null =>
  [view.activeRun, ...view.queued, view.lastEnded]
    .filter((run): run is ViewRun => run !== null)
    .reduce<ViewRun | null>(
      (latest, run) => (latest === null || run.ordinal > latest.ordinal ? run : latest),
      null,
    );

/** The menu row of a conversation, at the revision its environment and epoch give it. */
export const conversationRowOf = (
  view: ConversationView,
  revision: { readonly environmentId: string; readonly epoch: number },
): ConversationRow => {
  const latest = latestOf(view);
  const asked = view.openRequests.find((request) => request.runId === view.activeRun?.id);
  return {
    conversationId: view.conversationId,
    agent: view.agent,
    revision: { ...revision, seq: view.seq },
    state: rowStateOf(view),
    activeRunId: view.activeRun?.id ?? null,
    latestRun: latest === null ? null : { id: latest.id, end: latest.end, endedAt: latest.endedAt },
    subject: view.lastPerson === null ? null : subjectOf(view.lastPerson),
    snippet: rowText(view.lastAgent?.text),
    at: view.updatedAt,
    askedAt: asked?.at ?? null,
  };
};
