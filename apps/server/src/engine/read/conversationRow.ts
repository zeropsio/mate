/**
 * The menu row (`ConversationRow`): what the sidebar, the face and HQ's relayed row read of a
 * conversation, from its view. Its subject is the person's latest message's first line, its
 * snippet the agent's latest words, its state the run's — and a run a restart cut says why and
 * whether it carries on. Pure; texts masked and cut to what a row shows.
 *
 * @module engine/read/conversationRow
 */
import {
  isCardAsk,
  type BackgroundWork,
  type ConversationRow,
  type ConversationRowState,
  type RunEnd,
} from "@t3tools/contracts";
import { maskSecrets, messagePreviewText } from "@t3tools/shared/messagePreview";
import { attachmentsLabel, userAskOf, type UserAskSource } from "@t3tools/shared/userAsk";

import { runStatusOf, turnStateOf } from "./runState.ts";

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
 * The first line of the person's ask that has words, quoted as V1's row quotes a message (`userAskPreviewText`):
 * a picture's label is no word they wrote, a message of pictures alone reads as their count.
 */
const subjectOf = (person: UserAskSource): string | null => {
  const ask = userAskOf(person);
  if (ask === null) return null;
  if (ask.kind === "attachments") return rowText(attachmentsLabel(ask));
  // The first line that still has words once its markdown is read: a rule or a fence has none.
  for (const line of ask.text.split("\n")) {
    const words = rowText(messagePreviewText(line));
    if (words !== null) return words;
  }
  return null;
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
    case "origin":
      return rowText(ask.reason ?? ask.url);
    default:
      return null;
  }
};

const WAITS_ON = ["approval", "question", "vault", "origin", "plan"] as const;
type WaitsOn = (typeof WAITS_ON)[number];
const waitsOn = (kind: string): kind is WaitsOn =>
  (WAITS_ON as ReadonlyArray<string>).includes(kind);

/**
 * Asked of the person on a card (a value, an origin): it outlives the turn that asked, so the
 * conversation waits on the person once nothing runs.
 */
const cardAsk = (view: ConversationView): ViewRequest | undefined =>
  view.openRequests.find((request) => isCardAsk(request.ask.kind));

/**
 * A helper's ask after the run that started it ended: the only approval or question the agent
 * waits on that outlives its run (one asked by message is answered by a message, never waited on).
 */
const helperWaitsOn = (request: ViewRequest): boolean =>
  request.answerable &&
  (request.ask.kind === "approval" ||
    (request.ask.kind === "question" && request.ask.dismissible !== true));

/**
 * How many pieces of each kind of background work a row names — the card lists five on rows of
 * their own, as the helpers panel does; the rest it counts.
 */
export const ROW_WORK_NAMED = 5;

/** A row's title of a piece of background work: shorter than a message's, it shares a line. */
const WORK_TITLE_MAX = 120;

/**
 * What the conversation waits on after its turn, by name: the first few of its helpers and the
 * first few of its own jobs, oldest first — the one it started first is what the others wait on —
 * how many in all, and how many of them are its helpers', so neither kind is read as the other
 * (Eli, 2026-10-14: three helpers and two jobs read as "and 4 more — Its helpers").
 */
const workOf = (view: ConversationView): BackgroundWork => {
  const work = view.work ?? [];
  const helpers = work.filter((item) => item.of === "helper");
  const jobs = work.filter((item) => item.of !== "helper");
  return {
    items: [...helpers.slice(0, ROW_WORK_NAMED), ...jobs.slice(0, ROW_WORK_NAMED)]
      .toSorted((left, right) => work.indexOf(left) - work.indexOf(right))
      .map((item) => ({ ...item, title: rowText(item.title, WORK_TITLE_MAX) })),
    count: work.length,
    helpers: helpers.length,
  };
};

/**
 * The row's state: a question first, then the run on, an ask on a card, the queue, a
 * pause, a failure, rest.
 */
export const rowStateOf = (view: ConversationView): ConversationRowState => {
  const active = view.activeRun;
  const asked = view.openRequests.find(
    (request) =>
      waitsOn(request.ask.kind) && (request.runId === active?.id || helperWaitsOn(request)),
  );
  if (asked !== undefined && waitsOn(asked.ask.kind)) {
    return { kind: "waiting", on: asked.ask.kind, words: askWords(asked) };
  }
  // A person's Stop in force says so on the row, whichever control or device sent it.
  const stopping = view.stopping === true ? { stopping: true as const } : {};
  if (active !== null && (active.state === "running" || active.state === "waiting")) {
    return {
      kind: "working",
      since: active.startedAt ?? active.queuedAt,
      waitsOnHelpers: false,
      ...stopping,
    };
  }
  const card = cardAsk(view);
  if (card !== undefined && waitsOn(card.ask.kind)) {
    return { kind: "waiting", on: card.ask.kind, words: askWords(card) };
  }
  if (view.pausedUntil !== null) {
    return { kind: "paused", resetsAt: view.pausedUntil === "unknown" ? null : view.pausedUntil };
  }
  const waiting = active ?? view.queued[0];
  if (waiting !== undefined) return { kind: "queued", since: waiting.queuedAt };
  // A run due at once (an answered value's word to the agent, a crash's note): the commit that
  // ended what came before armed it, so the row goes on working into it, never through idle
  // (Milo's run 9). It reads as the turn a finished job is due, the one way every reader takes as
  // going on with no run on: one that read "not waiting" flashed idle for a frame (recheck).
  if (view.runDue === true) {
    return {
      kind: "working",
      since: view.updatedAt,
      waitsOnHelpers: true,
      turnDue: true,
      work: workOf(view),
    };
  }
  if (view.background === "working" || view.turnDue === true) {
    return {
      kind: "working",
      since: view.lastEnded?.endedAt ?? view.updatedAt,
      waitsOnHelpers: true,
      ...(view.background !== "working" ? { turnDue: true as const } : {}),
      ...stopping,
      work: workOf(view),
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

/**
 * The agent's words that answer the person's latest ask: none where they came before it — a Stop
 * before the Mate said anything left the row reading "now" over its answer to the ask before.
 */
const answerOf = (view: ConversationView): ConversationView["lastAgent"] =>
  view.lastAgent !== null && view.lastAsked !== null && view.lastAgent.at < view.lastAsked.at
    ? null
    : view.lastAgent;

/** The menu row of a conversation, at the revision its environment and epoch give it. */
export const conversationRowOf = (
  view: ConversationView,
  revision: { readonly environmentId: string; readonly epoch: number },
): ConversationRow => {
  const latest = latestOf(view);
  const state = rowStateOf(view);
  const asked =
    view.openRequests.find((request) => request.runId === view.activeRun?.id) ??
    (state.kind === "waiting" && isCardAsk(state.on) ? cardAsk(view) : undefined);
  return {
    conversationId: view.conversationId,
    agent: view.agent,
    revision: { ...revision, seq: view.seq },
    state,
    runStatus: runStatusOf(view),
    activeRunId: view.activeRun?.id ?? null,
    latestRun:
      latest === null
        ? null
        : {
            id: latest.id,
            end: latest.end,
            endedAt: latest.endedAt,
            turnState: turnStateOf(latest),
          },
    subject: view.lastAsked === null ? null : subjectOf(view.lastAsked),
    snippet: rowText(answerOf(view)?.text),
    at: view.updatedAt,
    askedAt: asked?.at ?? null,
    ...(view.runtimeMode == null ? {} : { runtimeMode: view.runtimeMode }),
    ...(view.lease == null ? {} : { lease: view.lease }),
  };
};
