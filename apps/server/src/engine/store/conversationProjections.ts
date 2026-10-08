/**
 * A conversation's projections: what each of its events changes in the tables its clients read
 * (`engine_run`, `engine_item`, `engine_request`, `engine_session`), written by the store in the
 * step's transaction. The outbox's settled rows and the wakes are the store's, for every owner.
 *
 * @module engine/store/conversationProjections
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { KnownEngineEvent, RunId } from "@t3tools/contracts";

import type { ConversationState } from "../domain/state.ts";

const json = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

const upsertRun = (
  sql: SqlClient.SqlClient,
  state: ConversationState,
  id: RunId | null,
  rev: number,
) => {
  const run = id === null ? undefined : state.runs[id];
  if (run === undefined) return Effect.void;
  return sql`
    INSERT INTO engine_run (
      run_id, conversation_id, ordinal, seq, rev, trigger_json, joins, principal_json, state,
      maintenance, waiting_on, stop_asked_json, end_json, end_source, session_id,
      provider_turn_id, queued_at, admitted_at, started_at, ended_at, unresponsive_since
    ) VALUES (
      ${run.id}, ${state.conversationId}, ${run.ordinal}, ${run.seq}, ${rev},
      ${JSON.stringify(run.trigger)}, ${run.joins}, ${JSON.stringify(run.principal)}, ${run.state},
      ${run.maintenance ? 1 : 0}, ${run.waitingOn}, ${json(run.stopAsked)}, ${json(run.end)},
      ${run.endSource}, ${run.sessionId}, ${run.providerTurnId}, ${run.queuedAt},
      ${run.admittedAt}, ${run.startedAt}, ${run.endedAt}, ${run.unresponsiveSince}
    )
    ON CONFLICT (run_id) DO UPDATE SET
      rev = excluded.rev, state = excluded.state, waiting_on = excluded.waiting_on,
      stop_asked_json = excluded.stop_asked_json, end_json = excluded.end_json,
      end_source = excluded.end_source, session_id = excluded.session_id,
      provider_turn_id = excluded.provider_turn_id, admitted_at = excluded.admitted_at,
      started_at = excluded.started_at, ended_at = excluded.ended_at,
      unresponsive_since = excluded.unresponsive_since
  `.pipe(Effect.asVoid);
};

/** Writes what one of a conversation's events changes in its projections. */
export const projectConversation = (event: KnownEngineEvent, state: ConversationState) =>
  Effect.gen(function* () {
    return yield* projectWith(yield* SqlClient.SqlClient, event, state);
  });

const projectWith = (
  sql: SqlClient.SqlClient,
  event: KnownEngineEvent,
  state: ConversationState,
) => {
  const c = event.conversationId;
  switch (event._tag) {
    case "RunQueued":
      return Effect.andThen(
        upsertRun(sql, state, event.runId, event.seq),
        upsertRun(sql, state, event.joins, event.seq),
      );
    case "RunAdmitted":
    case "RunSending":
    case "RunStarted":
    case "RunWaiting":
    case "RunResumed":
    case "RunStopAsked":
    case "RunEnded":
    case "RunNotContinued":
    case "RunRequeued":
    case "RunUnresponsive":
    case "RunResponsive":
      return upsertRun(sql, state, event.runId, event.seq);
    case "ItemOpened":
      return sql`
        INSERT INTO engine_item (
          item_id, conversation_id, run_id, kind, state, by_json, body_json, opened_seq, rev, at
        ) VALUES (
          ${event.itemId}, ${c}, ${event.runId}, ${event.body.kind}, 'open',
          ${JSON.stringify(event.by)}, ${JSON.stringify(event.body)}, ${event.seq}, ${event.seq},
          ${event.at}
        )
      `.pipe(Effect.asVoid);
    case "ItemUpdated":
      return sql`
        UPDATE engine_item SET kind = ${event.body.kind}, body_json = ${JSON.stringify(event.body)},
          rev = ${event.seq}
        WHERE item_id = ${event.itemId}
      `.pipe(Effect.asVoid);
    case "ItemClosed":
      return sql`
        UPDATE engine_item SET kind = ${event.body.kind}, body_json = ${JSON.stringify(event.body)},
          state = 'closed', closed_seq = ${event.seq}, rev = ${event.seq}
        WHERE item_id = ${event.itemId}
      `.pipe(Effect.asVoid);
    case "RequestOpened":
      return sql`
        INSERT INTO engine_request (
          request_id, conversation_id, run_id, seq, rev, at, kind, ask_json, answerable, state,
          principal_json
        ) VALUES (
          ${event.requestId}, ${c}, ${event.runId}, ${event.seq}, ${event.seq}, ${event.at},
          ${event.ask.kind}, ${JSON.stringify(event.ask)}, ${event.answerable ? 1 : 0}, 'open',
          ${JSON.stringify(event.principal)}
        )
      `.pipe(Effect.asVoid);
    case "RequestAnswered":
      return sql`
        UPDATE engine_request SET state = 'answered', rev = ${event.seq},
          answer_json = ${JSON.stringify({
            by: event.by,
            at: event.at,
            summary: event.summary,
            ...(event.answers === undefined ? {} : { answers: event.answers }),
            ...(event.attachmentsByQuestionId === undefined
              ? {}
              : { attachmentsByQuestionId: event.attachmentsByQuestionId }),
          })}
        WHERE request_id = ${event.requestId}
      `.pipe(Effect.asVoid);
    case "RequestReopened":
      return sql`
        UPDATE engine_request SET state = 'open', answerable = 1, answer_json = NULL,
          rev = ${event.seq}
        WHERE request_id = ${event.requestId}
      `.pipe(Effect.asVoid);
    case "RequestClosed":
      return sql`
        UPDATE engine_request SET state = ${event.state}, answerable = 0, rev = ${event.seq}
        WHERE request_id = ${event.requestId} AND state IN ('open', 'answered')
      `.pipe(Effect.asVoid);
    case "SessionOpened":
      return sql`
        INSERT INTO engine_session (
          session_id, conversation_id, driver, model, native_ref, capabilities_json, state,
          rotated_from, opened_at
        ) VALUES (
          ${event.sessionId}, ${c}, ${event.driver}, ${event.model}, ${event.nativeRef},
          ${JSON.stringify(event.capabilities)}, 'open', ${event.rotatedFrom}, ${event.at}
        )
        ON CONFLICT (session_id) DO UPDATE SET state = 'open', closed_at = NULL, close_reason = NULL
      `.pipe(Effect.asVoid);
    case "SessionClosed":
      return sql`
        UPDATE engine_session SET state = 'closed', closed_at = ${event.at},
          close_reason = ${event.reason}
        WHERE session_id = ${event.sessionId}
      `.pipe(Effect.asVoid);
    case "RunImported":
      return sql`
        INSERT INTO engine_run (
          run_id, conversation_id, ordinal, seq, rev, trigger_json, joins, principal_json, state,
          maintenance, end_json, end_source, queued_at, started_at, ended_at
        ) VALUES (
          ${event.runId}, ${c}, ${event.ordinal}, ${event.seq}, ${event.seq},
          ${JSON.stringify(event.trigger)}, NULL, ${JSON.stringify(event.principal)}, 'ended', 0,
          ${JSON.stringify(event.end)}, ${event.source}, ${event.happenedAt}, ${event.startedAt},
          ${event.endedAt}
        )
      `.pipe(Effect.asVoid);
    case "ItemImported":
      return sql`
        INSERT INTO engine_item (
          item_id, conversation_id, run_id, kind, state, by_json, body_json, opened_seq, rev, at,
          closed_seq
        ) VALUES (
          ${event.itemId}, ${c}, ${event.runId}, ${event.body.kind}, 'closed',
          ${JSON.stringify(event.by)}, ${JSON.stringify(event.body)}, ${event.seq}, ${event.seq},
          ${event.happenedAt}, ${event.seq}
        )
      `.pipe(Effect.asVoid);
    case "RequestImported":
      return sql`
        INSERT INTO engine_request (
          request_id, conversation_id, run_id, seq, rev, at, kind, ask_json, answerable, state,
          principal_json, answer_json
        ) VALUES (
          ${event.requestId}, ${c}, ${event.runId}, ${event.seq}, ${event.seq},
          ${event.happenedAt}, ${event.ask.kind}, ${JSON.stringify(event.ask)}, 0, ${event.state},
          ${JSON.stringify(event.principal)},
          ${event.answer === undefined ? null : JSON.stringify(event.answer)}
        )
      `.pipe(Effect.asVoid);
    case "HistoryImportStarted":
    case "HistoryBatchImported":
    case "HistoryImportEnded":
    case "AgentAssigned":
    case "SessionClosing":
    case "SessionRotated":
    case "ModelSwitched":
    case "UsagePauseLifted":
    case "ConversationArchived":
    case "ConversationUnarchived":
    case "EffectRequested":
    case "EffectOutcomeRecorded":
    case "WakeArmed":
    case "WakeFired":
    case "WakeCancelled":
      // The store writes these for every owner kind.
      return Effect.void;
  }
};
