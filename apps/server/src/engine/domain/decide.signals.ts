/**
 * The provider's signals, each routed to its own turn's run, and how a turn's end becomes a run's end.
 *
 * @module engine/domain/decide.signals
 */
import {
  itemId as deriveItemId,
  requestId as deriveRequestId,
  wakeId as deriveWakeId,
  type ItemBody,
  type RunEnd,
  type RunEndDetail,
  type SessionId,
  type TurnHandle,
  isCardAsk,
  WORK_ENDED,
} from "@t3tools/contracts";

import type { ProviderSignal, TurnOutcome } from "./command.ts";
import {
  activeRun,
  contentDigest,
  runOfTurn,
  type ClosedItem,
  type OpenItem,
  type RunRecord,
} from "./state.ts";
import { Rejected, type StepBuilder, isLive } from "./decide.step.ts";
import { BY_THE_PERSON, LOST_HOW, personStopped, noteLostWork } from "./decide.lostWork.ts";
import { turnDueWakeId, expectAgentTurn, closeSession, sessionClosed } from "./decide.sessions.ts";
import {
  WATCHDOG_SILENCE_MS,
  CONTINUE_TEXT,
  type EndFacts,
  admitNext,
  dispatch,
  redispatch,
  endRun,
  settledBody,
  markWaiting,
  markResponsive,
  markStarted,
} from "./decide.runs.ts";
import { agentSchedule } from "./decide.wakes.ts";
import { resetTime, limited } from "./decide.usage.ts";
import {
  sameOriginAddress,
  settleOrigins,
  settleMirrors,
  vaultAskOpen,
  secretAskOpen,
  vaultPlace,
} from "./decide.asks.ts";
import { resumeIfAnswered } from "./decide.questions.ts";
import { sendsAgain } from "./decide.effects.ts";
import {
  selfJoins,
  steerOpened,
  waitingMessage,
  joinOwnTurn,
  selfStarted,
} from "./decide.ownTurns.ts";

/** How a run reads when its own agent interrupted the turn, no Stop asked. */
export const AGENT_STOPPED_ITSELF = "The agent stopped the turn itself.";

/**
 * What a driver's terminal reason says of a run's end: the context outgrew what the model takes,
 * or the provider broke the turn off. Any other reason is the agent's own end.
 */
const END_DETAILS: Readonly<Record<string, RunEndDetail>> = {
  prompt_too_long: "overflow",
  rapid_refill_breaker: "overflow",
  // An ACP agent's turn that ran out of tokens.
  max_tokens: "overflow",
  api_error: "provider-error",
  model_error: "provider-error",
  turn_setup_failed: "provider-error",
};

export const signals = (
  b: StepBuilder,
  sessionId: SessionId,
  batch: ReadonlyArray<ProviderSignal>,
): void => {
  if (b.state.session === null || b.state.session.id !== sessionId) {
    throw new Rejected("stale-session");
  }
  for (const signal of batch) {
    if (b.state.session?.id !== sessionId) break;
    signalOne(b, sessionId, signal);
  }
  // The work the bridge said its closing session lost, told in one note.
  noteLostWork(b);
};

/** A boundary from a live run: one while it is still sending means its turn started. */
const awaken = (b: StepBuilder, run: RunRecord): RunRecord => {
  if (run.state === "sending") markStarted(b, run, null);
  const live = b.run(run.id);
  if (live.unresponsiveSince !== null) markResponsive(b, live);
  return b.run(run.id);
};

/** The run a turn-scoped signal belongs to; a turn the engine does not know has none. */
const routed = (b: StepBuilder, turn: TurnHandle | undefined): RunRecord | undefined => {
  if (turn === undefined) {
    const active = activeRun(b.state);
    return active !== undefined && isLive(active) ? active : undefined;
  }
  return runOfTurn(b.state, turn);
};

const signalOne = (b: StepBuilder, sessionId: SessionId, signal: ProviderSignal): void => {
  switch (signal.kind) {
    case "turn-started": {
      const run = runOfTurn(b.state, signal.turn);
      if (run !== undefined) {
        if (run.state === "sending") markStarted(b, run, signal.providerTurnId, signal.turn);
        return;
      }
      // A steer that met no running turn (its run's turn ended first) opened one of its own: the
      // engine runs it as the agent's own turn on that run's behalf.
      const steered = steerOpened(b, signal.turn);
      if (signal.origin !== "self" && steered === undefined) return;
      const active = activeRun(b.state);
      if (active !== undefined && active.state !== "admitted") return;
      // A person's message waiting for its turn goes into this one, never after it.
      const waiting = steered === undefined ? waitingMessage(b) : undefined;
      if (waiting !== undefined) {
        return joinOwnTurn(b, waiting, signal.turn, signal.providerTurnId);
      }
      const joined = selfJoins(b, signal.reportsOn ?? steered ?? null);
      // Nobody to act for (no run before it): the turn is not the engine's to record as a run.
      if (joined === undefined) return;
      // A run still being prepared has sent nothing: it goes back to the head of the queue and
      // is sent when the agent's own turn ends.
      if (active?.state === "admitted") {
        b.emit({
          _tag: "RunRequeued",
          runId: active.id,
          reason: "the agent started a turn of its own",
        });
      }
      return selfStarted(b, signal.turn, signal.providerTurnId, joined);
    }
    case "activity": {
      const run = routed(b, signal.turn);
      if (run === undefined || !isLive(run)) return;
      const quiet = b.now - (run.lastActivityAt ?? 0) >= WATCHDOG_SILENCE_MS / 2;
      if (run.unresponsiveSince !== null || quiet) {
        if (run.state === "sending") markStarted(b, run, null);
        markResponsive(b, b.run(run.id));
      }
      return;
    }
    case "item-opened":
    case "item-closed":
    case "item-updated": {
      // Idempotent by content: a signal delivered again (a new batch, the same turn, key and body)
      // changes nothing; an item closed before only ever changes in place.
      const closed = b.state.closedItems[signal.key];
      if (closed !== undefined) {
        // Never back to open: only a closing signal, or one after its turn's end, can change it.
        if (signal.kind === "item-closed" || signal.afterEnd === true) {
          updateClosed(b, closed, signal.body, {
            detail: signal.detail,
            data: signal.kind === "item-closed" ? signal.data : undefined,
          });
        }
        return;
      }
      const open = Object.values(b.state.items).find((item) => item.key === signal.key);
      const owner = routed(b, signal.turn);
      if (owner === undefined || (owner.state !== "ended" && !isLive(owner))) return;
      const same = open !== undefined && contentDigest(open.body) === contentDigest(signal.body);
      if (signal.kind !== "item-closed" && same) return;
      if (signal.kind === "item-updated" && (open === undefined || !isLive(owner))) return;
      const run = isLive(owner) ? awaken(b, owner) : owner;
      let id = open?.id;
      if (id === undefined) {
        id = deriveItemId(run.id, run.nextItemOrdinal);
        b.emit({
          _tag: "ItemOpened",
          runId: run.id,
          itemId: id,
          key: signal.key,
          by: (signal.kind === "item-updated" ? undefined : signal.by) ?? { kind: "mate" },
          body: signal.body,
        });
      } else if (!same && signal.kind !== "item-closed") {
        b.emit({ _tag: "ItemUpdated", runId: open!.runId, itemId: id, body: signal.body });
      }
      // A run that has ended never holds an open item: what arrives after its end is filed closed.
      if (signal.kind === "item-closed" || run.state === "ended") {
        b.emit({
          _tag: "ItemClosed",
          runId: run.id,
          itemId: id,
          body: run.end === null ? signal.body : settledBody(signal.body, run.end),
        });
      }
      if (signal.detail !== undefined) {
        b.details.push({ itemId: id, body: signal.detail });
      }
      if (signal.kind === "item-closed" && signal.data !== undefined) {
        b.data.push({ itemId: id, data: signal.data });
        if (
          signal.body.kind === "call" &&
          signal.body.state === "done" &&
          signal.by?.kind !== "helper"
        )
          agentSchedule(b, run, signal.data);
      }
      return;
    }
    case "request-opened": {
      // A request is asked once: one delivered again, open or answered, is the same request.
      if (b.state.askedKeys[signal.key] !== undefined) return;
      // A value asked again for the same vault while its card is open is the one question: the
      // person may already be typing it there (a Mate asked twice for one secret, 2026-10-28).
      if (signal.ask.kind === "vault" && vaultAskOpen(b.state, signal.ask)) return;
      if (signal.ask.kind === "secret" && secretAskOpen(b.state, signal.ask)) return;
      const owner = routed(b, signal.turn);
      if (owner === undefined) return;
      const run = isLive(owner) ? awaken(b, owner) : owner;
      const id = deriveRequestId(run.id, run.nextRequestOrdinal);
      // An origin asked again for the same repository is the one question: the earlier ask
      // needs the person no more.
      if (signal.ask.kind === "origin") {
        const { url, repo } = signal.ask;
        settleOrigins(b, (asked) => asked.repo === repo && sameOriginAddress(asked.url, url));
      }
      // A repository asked again to be connected to GitHub is the one question: the new ask
      // replaces the earlier one.
      if (signal.ask.kind === "mirror") settleMirrors(b, signal.ask.repo);
      const live = isLive(run);
      // Asked by message: the agent does not wait on it, and a message answers it after its turn.
      // An ask on a card is not waited on either: the person answers it there after the turn.
      const byMessage =
        (signal.ask.kind === "question" && signal.ask.dismissible) || isCardAsk(signal.ask.kind);
      // A helper's ask outlives the turn that started its helper: the driver waits on it while
      // the session that asked lives (Milo's final engine run, seg E: helpers hung unasked).
      const byHelper = signal.byHelper === true && !byMessage && b.state.session?.id === sessionId;
      b.emit({
        _tag: "RequestOpened",
        runId: run.id,
        requestId: id,
        key: signal.key,
        ask: signal.ask,
        answerable: (live || byMessage || byHelper) && (signal.answerable ?? true),
        principal: run.principal,
        ...(byHelper ? { byHelper: true as const } : {}),
      });
      // The agent's message that asked it: the request takes its place in the record.
      const asker =
        signal.item === undefined
          ? undefined
          : Object.values(b.state.items).find((item) => item.key === signal.item);
      if (asker !== undefined) {
        b.emit({
          _tag: "ItemClosed",
          runId: asker.runId,
          itemId: asker.id,
          body: { kind: "request", requestId: id },
        });
      }
      if (byMessage || (byHelper && !live)) return;
      if (!live) {
        // Its turn already ended: nothing can take the answer.
        b.emit({ _tag: "RequestClosed", runId: run.id, requestId: id, state: "lapsed" });
        return;
      }
      if (b.run(run.id).state !== "waiting") markWaiting(b, b.run(run.id), id);
      return;
    }
    case "request-closed": {
      const request = Object.values(b.state.requests).find((open) => open.key === signal.key);
      if (request === undefined) return;
      b.emit({
        _tag: "RequestClosed",
        runId: request.runId,
        requestId: request.id,
        state: signal.state,
      });
      resumeIfAnswered(b, request.runId);
      return;
    }
    case "vault-stored": {
      // The agent stored a value it asked the person for (given in the chat, say): the ask is
      // answered saved and the person has nothing left to give. The agent knows already: no word
      // reaches it.
      for (const request of Object.values(b.state.requests)) {
        const vault = request.vault;
        if (vault === undefined || !signal.keys.includes(vault.key)) continue;
        const { scope } = vault;
        const sameVault =
          scope.kind === "shared"
            ? signal.scope.kind === "shared"
            : signal.scope.kind === "service" && signal.scope.hostname === scope.hostname;
        if (!sameVault) continue;
        b.emit({
          _tag: "RequestAnswered",
          runId: request.runId,
          requestId: request.id,
          by: b.envelope.principal,
          summary: `Saved to ${vaultPlace(vault)}`,
        });
      }
      return;
    }
    case "origin-settled": {
      // zcp found the asked address already an origin in HQ for the repository that call asked
      // about, or the agent withdrew the ask of one repository, or of every repository asked
      // about the address. The agent knows already: no word reaches it.
      const { url, repo } = signal;
      settleOrigins(
        b,
        (asked) => sameOriginAddress(asked.url, url) && (repo === undefined || asked.repo === repo),
      );
      return;
    }
    case "mirror-settled": {
      // zcp found the repository already on GitHub in HQ, or the agent withdrew its ask. The
      // agent knows already: no word reaches it.
      settleMirrors(b, signal.repo);
      return;
    }
    case "turn-ended": {
      const run = runOfTurn(b.state, signal.turn);
      if (run === undefined || !isLive(run)) return;
      if (signal.outcome.kind === "undelivered" && sendsAgain(b, run, signal.outcome.words)) return;
      // A turn that ends before it was seen to start still started: the message reached the agent.
      if (run.state === "sending") markStarted(b, run, null, signal.turn);
      const live = b.run(run.id);
      const end = turnEnd(live, signal.outcome, refusedBy(b, live));
      endRun(b, live, end, signal.source, undefined, endFacts(signal));
      if (end.kind === "usage-limit") limited(b, live, end.resetsAt);
      admitNext(b);
      expectAgentTurn(b);
      return;
    }
    case "work-upserted": {
      // Work a person's Stop ended (its session's close cut it, or the driver stopped it as the
      // session went) was stopped by the person, not lost.
      const byPerson =
        (signal.status === "lost" || signal.status === "stopped") && personStopped(b.state);
      // The call that started it, by its key: still open, or closed in a run the state keeps.
      const call =
        signal.call === undefined
          ? undefined
          : (b.state.closedItems[signal.call]?.itemId ??
            Object.values(b.state.items).find((item) => item.key === signal.call)?.id);
      const body: ItemBody = {
        kind: "work",
        work: signal.work,
        workKind: signal.workKind,
        status: byPerson ? "stopped" : signal.status,
        title: signal.title ?? null,
        ...(call === undefined ? {} : { call }),
        ...(signal.report === undefined ? {} : { report: signal.report }),
      };
      const ends = WORK_ENDED.has(signal.status);
      const closed = b.state.closedItems[signal.work];
      // A word on work that already ended keeps the time it ended.
      if (closed !== undefined)
        return updateClosed(
          b,
          closed,
          body.kind === "work" && closed.endedAt !== undefined
            ? { ...body, endedAt: closed.endedAt }
            : body,
        );
      const open = Object.values(b.state.items).find((item) => item.key === signal.work);
      if (open !== undefined) {
        if (ends) {
          b.emit({
            _tag: "ItemClosed",
            runId: open.runId,
            itemId: open.id,
            body: { ...body, endedAt: b.now },
          });
          expectAgentTurn(b);
          // The bridge's word that the work's session is closing: asked, for the reason asked;
          // else it died.
          if (byPerson || body.status === "lost") {
            b.lost.push({
              title: body.title,
              runId: open.runId,
              how: byPerson ? BY_THE_PERSON : LOST_HOW[b.state.closing?.reason ?? "exited"],
            });
          }
          // A run held for a setting the live work stood against goes now.
          return redispatch(b);
        } else if (contentDigest(open.body) !== contentDigest(body)) {
          b.emit({ _tag: "ItemUpdated", runId: open.runId, itemId: open.id, body });
        }
        return;
      }
      // Under the run whose turn started it; a driver that cannot say files it under the latest.
      const owner =
        signal.origin === "unknown"
          ? b.state.latestRunId === null
            ? undefined
            : b.state.runs[b.state.latestRunId]
          : runOfTurn(b.state, signal.origin);
      if (owner === undefined || owner.state === "queued" || owner.state === "admitted") return;
      const id = deriveItemId(owner.id, owner.nextItemOrdinal);
      const by: OpenItem["by"] =
        signal.helper === undefined
          ? { kind: "mate" }
          : { kind: "helper", helperId: signal.helper };
      b.emit({
        _tag: "ItemOpened",
        runId: owner.id,
        itemId: id,
        key: signal.work,
        // A helper's own work is the helper's, as its calls are.
        by,
        body,
      });
      if (ends) {
        b.emit({
          _tag: "ItemClosed",
          runId: owner.id,
          itemId: id,
          body: { ...body, endedAt: b.now },
        });
        expectAgentTurn(b);
      }
      return;
    }
    case "agent-caught-up": {
      // One turn may take several results (Claude folds what finished into the turn that runs,
      // and hands a batch over at once): its word that nothing waits ends every one still due.
      const due = b.state.wakes[turnDueWakeId(b)];
      if (b.state.reportsDue === 0 && due === undefined) return;
      b.emit({ _tag: "ReportsTaken", reason: "the agent took every finished result" });
      if (due !== undefined)
        b.emit({ _tag: "WakeCancelled", wakeId: due.id, reason: "the agent took every result" });
      return;
    }
    case "usage-reset-known": {
      // A limit whose reset was unknown: its probe gives way to a resume at the known time.
      const probe = Object.values(b.state.wakes).find((wake) => wake.kind === "usage-probe");
      if (b.state.pausedUntil !== "unknown" || probe === undefined) return;
      b.emit({ _tag: "WakeCancelled", wakeId: probe.id, reason: "the reset is known" });
      b.emit({ _tag: "UsagePauseLifted", reason: "the reset is known" });
      b.emit({
        _tag: "WakeArmed",
        wakeId: deriveWakeId(b.state.conversationId, "usage-resume", probe.joins ?? "limit"),
        kind: "usage-resume",
        dueAt: signal.resetsAt,
        cron: null,
        principal: probe.principal,
        joins: probe.joins,
        text: CONTINUE_TEXT,
      });
      admitNext(b);
      return;
    }
    case "usage-limit": {
      const run = routed(b, signal.turn);
      if (run !== undefined && isLive(run)) {
        endRun(b, run, limitEnd(signal.resetsAt, refusedBy(b, run), signal.window), "agent");
        limited(b, run, signal.resetsAt);
        // A parked turn (Claude) sits in its session until the reset: close it; the resume
        // reopens the session with its resume cursor and sends explicitly.
        if (signal.parks === true && b.state.session?.id === run.sessionId) {
          closeSession(b, "usage-limit");
        }
      }
      admitNext(b);
      return;
    }
    case "session-exited": {
      const run = activeRun(b.state);
      if (run !== undefined && isLive(run) && run.sessionId === sessionId) {
        if (run.stopAsked !== null) {
          endRun(b, run, { kind: "stopped", by: run.stopAsked.by }, "inferred-from-crash");
        } else {
          endRun(b, run, { kind: "crashed", reason: signal.reason }, "inferred-from-crash");
        }
      }
      sessionClosed(b, sessionId, "exited");
      // A run held for a setting the lost work stood against goes on a new session now.
      const admitted = activeRun(b.state);
      if (admitted?.state === "admitted") return dispatch(b, admitted);
      admitNext(b);
      return;
    }
  }
};

/**
 * A closed item's key again: the same content changes nothing, new content updates it in place,
 * and what comes beside its body is kept as an open item's would be — its words whole, a closing
 * call's own record (a helper's call that came back after its run ended).
 */
const updateClosed = (
  b: StepBuilder,
  closed: ClosedItem,
  body: ItemBody,
  beside: { readonly detail?: string | undefined; readonly data?: unknown } = {},
): void => {
  const run = closed.runId === null ? undefined : b.state.runs[closed.runId];
  const settled = run?.end == null ? body : settledBody(body, run.end);
  if (beside.detail !== undefined) b.details.push({ itemId: closed.itemId, body: beside.detail });
  if (beside.data !== undefined) b.data.push({ itemId: closed.itemId, data: beside.data });
  if (contentDigest(settled) === closed.digest) return;
  b.emit({ _tag: "ItemUpdated", runId: closed.runId, itemId: closed.itemId, body: settled });
};

/** What a turn's end carries onto its run's: its cost, the context it left, why it broke off. */
const endFacts = (signal: Extract<ProviderSignal, { readonly kind: "turn-ended" }>): EndFacts => {
  const reason =
    signal.outcome.kind === "completed" || signal.outcome.kind === "failed"
      ? signal.outcome.reason
      : undefined;
  const detail = reason === undefined ? undefined : END_DETAILS[reason];
  return {
    ...(signal.costUsd === undefined ? {} : { costUsd: signal.costUsd }),
    ...(signal.context === undefined ? {} : { context: signal.context }),
    ...(detail === undefined ? {} : { detail }),
  };
};

/** The driver of the session `run` ran on, while it is the open one: whose limit refused it. */
const refusedBy = (b: StepBuilder, run: RunRecord): string | undefined => {
  const session = b.state.session;
  return session !== null && session.id === run.sessionId ? session.driver : undefined;
};

/**
 * A usage limit's end names whose limit it was, so a later switch of agent never renames it, and
 * the window that refused, when the driver named one.
 */
const limitEnd = (
  resetsAt: number | null,
  driver: string | undefined,
  window: string | undefined,
): RunEnd => ({
  kind: "usage-limit",
  resetsAt,
  ...(driver === undefined ? {} : { driver }),
  ...(window === undefined ? {} : { window }),
});

/** What a turn's outcome makes of its run, said in one place; the source is always the bridge's. */
const turnEnd = (run: RunRecord, outcome: TurnOutcome, driver: string | undefined): RunEnd => {
  const stoppedBy = run.stopAsked?.by;
  switch (outcome.kind) {
    case "completed":
      return { kind: "completed" };
    case "interrupted":
      return stoppedBy !== undefined
        ? { kind: "stopped", by: stoppedBy }
        : { kind: "failed", reason: AGENT_STOPPED_ITSELF, next: null };
    case "failed":
    case "unknown":
    case "undelivered":
      return { kind: "failed", reason: outcome.words, next: null };
    case "usage-limited":
      return limitEnd(resetTime(outcome.resetsAt), driver, outcome.window);
    case "cut":
      return stoppedBy !== undefined
        ? { kind: "stopped", by: stoppedBy }
        : { kind: "crashed", reason: outcome.words ?? outcome.cause };
  }
};
