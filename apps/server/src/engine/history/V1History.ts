/**
 * The V1 thread's record, read for the import: its turns and the light columns of everything they
 * hold, then the bodies of one slice at a time. Read-only: V1's tables stay as they are, so the
 * Mate can flip back to V1 and find its conversation where it left it.
 *
 * @module engine/history/V1History
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import type { Entry, V1ActivityHead, V1Bodies, V1Skeleton } from "./v1.ts";

/** The kinds whose payload the plan reads whole: small, and what places or ends a record. */
const LIGHT = `kind NOT IN ('tool.started', 'tool.updated', 'tool.completed', 'tool.progress')
  AND kind NOT LIKE 'task.%'`;
/** How many ids one body read asks for. */
const CHUNK = 400;

const parse = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const chunks = <A>(all: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> => {
  const out: Array<ReadonlyArray<A>> = [];
  for (let at = 0; at < all.length; at += CHUNK) out.push(all.slice(at, at + CHUNK));
  return out;
};

/** The thread's turns and the light columns of its messages, activities and proposed plans. */
export const readSkeleton = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const turns = yield* sql<{
      readonly turn_id: string | null;
      readonly pending_message_id: string | null;
      readonly state: string;
      readonly requested_at: string;
      readonly started_at: string | null;
      readonly completed_at: string | null;
    }>`
      SELECT turn_id, pending_message_id, state, requested_at, started_at, completed_at
      FROM projection_turns WHERE thread_id = ${threadId}
    `;
    const messages = yield* sql<{
      readonly message_id: string;
      readonly role: string;
      readonly turn_id: string | null;
      readonly created_at: string;
    }>`
      SELECT message_id, role, turn_id, created_at FROM projection_thread_messages
      WHERE thread_id = ${threadId}
    `;
    const activities = yield* sql<{
      readonly activity_id: string;
      readonly kind: string;
      readonly summary: string;
      readonly turn_id: string | null;
      readonly call_id: string | null;
      readonly task_id: string | null;
      readonly created_at: string;
      readonly sequence: number | null;
      readonly payload_json: string | null;
    }>`
      SELECT activity_id, kind, summary, turn_id, call_id, task_id, created_at, sequence,
        CASE WHEN ${sql.unsafe(LIGHT)} THEN payload_json END AS payload_json
      FROM projection_thread_activities WHERE thread_id = ${threadId}
    `;
    const plans = yield* sql<{
      readonly plan_id: string;
      readonly turn_id: string | null;
      readonly plan_markdown: string;
      readonly created_at: string;
    }>`
      SELECT plan_id, turn_id, plan_markdown, created_at FROM projection_thread_proposed_plans
      WHERE thread_id = ${threadId}
    `;
    return {
      turns: turns.map((row) => ({
        key: row.turn_id ?? `pending:${row.pending_message_id ?? row.requested_at}`,
        turnId: row.turn_id,
        pendingMessageId: row.pending_message_id,
        state: row.state,
        requestedAt: row.requested_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
      })),
      messages: messages.map((row) => ({
        id: row.message_id,
        role: row.role,
        turnId: row.turn_id,
        createdAt: row.created_at,
      })),
      activities: [
        ...activities.map((row): V1ActivityHead => ({
          id: row.activity_id,
          kind: row.kind,
          summary: row.summary,
          turnId: row.turn_id,
          callId: row.call_id,
          taskId: row.task_id,
          createdAt: row.created_at,
          sequence: row.sequence,
          payload: parse(row.payload_json),
        })),
        ...plans.map((row): V1ActivityHead => ({
          id: `plan:${row.plan_id}`,
          kind: "proposed-plan",
          summary: "Proposed plan",
          turnId: row.turn_id,
          callId: null,
          taskId: null,
          createdAt: row.created_at,
          sequence: null,
          payload: { planMarkdown: row.plan_markdown },
        })),
      ],
    } satisfies V1Skeleton;
  });

/** The words and payloads one slice of the plan draws on. */
export const readBodies = (entries: ReadonlyArray<Entry>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const messageIds = entries.flatMap((entry) => (entry.kind === "message" ? [entry.id] : []));
    const activityIds = entries.flatMap((entry) =>
      entry.kind === "call" || entry.kind === "work" ? entry.ids : [],
    );
    const messages: Map<string, { text: string; attachments: ReadonlyArray<unknown> }> = new Map();
    for (const ids of chunks(messageIds)) {
      const rows = yield* sql<{
        readonly message_id: string;
        readonly text: string;
        readonly attachments_json: string | null;
      }>`
        SELECT message_id, text, attachments_json FROM projection_thread_messages
        WHERE ${sql.in("message_id", ids)}
      `;
      for (const row of rows) {
        const attachments = parse(row.attachments_json);
        messages.set(row.message_id, {
          text: row.text,
          attachments: Array.isArray(attachments) ? attachments : [],
        });
      }
    }
    const activities: Map<string, { kind: string; summary: string; payload: unknown }> = new Map();
    for (const ids of chunks(activityIds)) {
      const rows = yield* sql<{
        readonly activity_id: string;
        readonly kind: string;
        readonly summary: string;
        readonly payload_json: string;
      }>`
        SELECT activity_id, kind, summary, payload_json FROM projection_thread_activities
        WHERE ${sql.in("activity_id", ids)}
      `;
      for (const row of rows) {
        activities.set(row.activity_id, {
          kind: row.kind,
          summary: row.summary,
          payload: parse(row.payload_json),
        });
      }
    }
    return { messages, activities } satisfies V1Bodies;
  });
