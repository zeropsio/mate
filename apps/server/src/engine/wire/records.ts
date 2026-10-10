/**
 * The wire's reads of the record: runs (with their summary), items and requests as the clients
 * draw them, by window, by change since a cursor, by page, and an item's whole part. Read from the
 * projections the store writes in each step's transaction; nothing here writes.
 *
 * @module engine/wire/records
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  ENGINE_WIRE_BUDGETS,
  Item,
  ItemId,
  Request,
  RunRecord,
  type ConversationId,
  type EngineWindow,
  type RequestId,
  type RunId,
} from "@t3tools/contracts";

import { turnStateOf } from "../read/runState.ts";

const decodeRun = Schema.decodeUnknownEffect(RunRecord);
const decodeItem = Schema.decodeUnknownEffect(Item);
const decodeRequest = Schema.decodeUnknownEffect(Request);

interface RunRow {
  readonly run_id: string;
  readonly conversation_id: string;
  readonly ordinal: number;
  readonly seq: number;
  readonly rev: number;
  readonly trigger_json: string;
  readonly joins: string | null;
  readonly principal_json: string;
  readonly state: string;
  readonly maintenance: number;
  readonly waiting_on: string | null;
  readonly stop_asked_json: string | null;
  readonly end_json: string | null;
  readonly end_source: string | null;
  readonly session_id: string | null;
  readonly provider_turn_id: string | null;
  readonly queued_at: number;
  readonly admitted_at: number | null;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly unresponsive_since: number | null;
}

export interface ItemRow {
  readonly item_id: string;
  readonly conversation_id: string;
  readonly run_id: string | null;
  readonly kind: string;
  readonly by_json: string;
  readonly body_json: string;
  readonly opened_seq: number;
  readonly rev: number;
  readonly at: number;
}

interface RequestRow {
  readonly request_id: string;
  readonly conversation_id: string;
  readonly run_id: string;
  readonly seq: number;
  readonly rev: number;
  readonly at: number;
  readonly ask_json: string;
  readonly answerable: number;
  readonly state: string;
  readonly principal_json: string;
  readonly answer_json: string | null;
}

const parse = (text: string | null): unknown => (text === null ? null : JSON.parse(text));

export const itemOfRow = (row: ItemRow) =>
  decodeItem({
    ...(parse(row.body_json) as object),
    id: row.item_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    seq: row.opened_seq,
    rev: row.rev,
    at: row.at,
    by: parse(row.by_json),
  });

const requestOfRow = (row: RequestRow) =>
  decodeRequest({
    id: row.request_id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    seq: row.seq,
    rev: row.rev,
    at: row.at,
    ask: parse(row.ask_json),
    state: row.state,
    answerable: row.answerable === 1,
    ...(row.answer_json === null ? {} : { answer: parse(row.answer_json) }),
    principal: parse(row.principal_json),
  });

/** A record this build cannot read is left out (and logged), never the whole read. */
const readable = <Row, A, E>(rows: ReadonlyArray<Row>, read: (row: Row) => Effect.Effect<A, E>) =>
  Effect.forEach(rows, (row) =>
    read(row).pipe(
      Effect.map((value) => [value]),
      Effect.catchCause((cause) =>
        Effect.logWarning("Mate engine wire: a record could not be read", cause).pipe(
          Effect.as([] as Array<A>),
        ),
      ),
    ),
  ).pipe(Effect.map((all) => all.flat()));

/**
 * The files a run's edits changed, each once, and one for each edit naming none: what V1's card
 * counts as "files edited" (`activityCounts`).
 */
const editedOf = (
  rows: ReadonlyArray<{ readonly item_id: string; readonly path: string | null }>,
): number => {
  const files = new Set<string>();
  const named = new Set<string>();
  const edits = new Set<string>();
  for (const row of rows) {
    edits.add(row.item_id);
    if (row.path === null || row.path.trim() === "") continue;
    files.add(row.path.trim());
    named.add(row.item_id);
  }
  return files.size + (edits.size - named.size);
};

export const makeRecords = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /** The runs with what they hold counted: items, calls by step, the agent's answer. */
  const withSummaries = (rows: ReadonlyArray<RunRow>) =>
    Effect.gen(function* () {
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.run_id);
      // A run's own calls: what its helpers ran is the helpers' (their card counts it), never the
      // Mate's (a reload read "15 commands" of a run whose Mate ran 7).
      const ownCall = sql.literal("json_extract(by_json, '$.kind') IS NOT 'helper'");
      const counts = yield* sql<{
        readonly run_id: string;
        readonly items: number;
        readonly last_seq: number;
      }>`
        SELECT run_id, COUNT(*) AS items, MAX(opened_seq) AS last_seq FROM engine_item
        WHERE ${sql.in("run_id", ids)} GROUP BY run_id
      `;
      const calls = yield* sql<{
        readonly run_id: string;
        readonly step: string | null;
        readonly n: number;
      }>`
        SELECT run_id, json_extract(body_json, '$.step') AS step, COUNT(*) AS n FROM engine_item
        WHERE ${sql.in("run_id", ids)} AND kind = 'call' AND ${ownCall} GROUP BY run_id, step
      `;
      const tools = yield* sql<{
        readonly run_id: string;
        readonly tool: string | null;
        readonly n: number;
      }>`
        SELECT run_id, json_extract(body_json, '$.tool.name') AS tool, COUNT(*) AS n
        FROM engine_item
        WHERE ${sql.in("run_id", ids)} AND kind = 'call' AND ${ownCall}
          AND json_extract(body_json, '$.step') IN ('tool', 'mcp')
        GROUP BY run_id, tool
      `;
      // The files an edit names where V1's row reads them (`collectChangedFiles`' keys), and where
      // Claude's Write and Edit name theirs (`file_path`, a notebook's `notebook_path`).
      const edits = yield* sql<{
        readonly run_id: string;
        readonly item_id: string;
        readonly path: string | null;
      }>`
        SELECT edit.run_id AS run_id, edit.item_id AS item_id, named.path AS path
        FROM engine_item AS edit
        LEFT JOIN (
          SELECT item.item_id AS item_id, tree.value AS path
          FROM engine_item AS item, json_tree(item.body_json, '$.shows') AS tree
          WHERE ${sql.in("item.run_id", ids)} AND item.kind = 'call'
            AND json_extract(item.body_json, '$.step') = 'edit' AND tree.type = 'text'
            AND tree.key IN (
              'path', 'filePath', 'file_path', 'notebook_path', 'relativePath', 'filename',
              'newPath', 'oldPath'
            )
        ) AS named ON named.item_id = edit.item_id
        WHERE ${sql.in("edit.run_id", ids)} AND edit.kind = 'call'
          AND json_extract(edit.by_json, '$.kind') IS NOT 'helper'
          AND json_extract(edit.body_json, '$.step') = 'edit'
      `;
      const answers = yield* sql<{ readonly run_id: string; readonly item_id: string }>`
        SELECT run_id, item_id FROM engine_item
        WHERE ${sql.in("run_id", ids)} AND kind = 'note' AND state = 'closed'
          AND json_extract(by_json, '$.kind') = 'mate'
        ORDER BY opened_seq
      `;
      const summaryOf = (id: string) => {
        const count = counts.find((row) => row.run_id === id);
        const answer = answers.findLast((row) => row.run_id === id);
        return {
          items: count?.items ?? 0,
          calls: Object.fromEntries(
            calls
              .filter((row) => row.run_id === id)
              .map((row) => [row.step ?? "tool", row.n] as const),
          ),
          tools: Object.fromEntries(
            tools
              .filter((row) => row.run_id === id)
              .map((row) => [row.tool ?? "tool", row.n] as const),
          ),
          edited: editedOf(edits.filter((row) => row.run_id === id)),
          answerItemId: answer === undefined ? null : ItemId.make(answer.item_id),
          lastItemSeq: count?.last_seq ?? null,
        };
      };
      return yield* readable(rows, (row) =>
        decodeRun({
          id: row.run_id,
          conversationId: row.conversation_id,
          ordinal: row.ordinal,
          seq: row.seq,
          rev: row.rev,
          trigger: parse(row.trigger_json),
          joins: row.joins,
          principal: parse(row.principal_json),
          state: row.state,
          maintenance: row.maintenance === 1,
          waitingOn:
            row.waiting_on === null ? null : { kind: "request", requestId: row.waiting_on },
          stopAsked: parse(row.stop_asked_json),
          end: parse(row.end_json),
          endSource: row.end_source,
          sessionId: row.session_id,
          providerTurnId: row.provider_turn_id,
          queuedAt: row.queued_at,
          admittedAt: row.admitted_at,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          unresponsiveSince: row.unresponsive_since,
          summary: summaryOf(row.run_id),
        }),
      ).pipe(Effect.map((runs) => runs.map((run) => ({ ...run, turnState: turnStateOf(run) }))));
    });

  const runsById = (conversation: ConversationId, ids: ReadonlyArray<string>) =>
    ids.length === 0
      ? Effect.succeed([])
      : sql<RunRow>`
          SELECT * FROM engine_run WHERE conversation_id = ${conversation} AND ${sql.in("run_id", ids)}
          ORDER BY ordinal
        `.pipe(Effect.flatMap(withSummaries));

  const items = (rows: ReadonlyArray<ItemRow>) => readable(rows, itemOfRow);
  const requests = (rows: ReadonlyArray<RequestRow>) => readable(rows, requestOfRow);

  /** The sequence space the tables were made in. */
  const origin = sql<{
    readonly origin: string;
  }>`SELECT origin FROM engine_origin WHERE id = 1`.pipe(
    Effect.map((rows) => rows[0]?.origin ?? "none"),
  );

  const head = (conversation: ConversationId) =>
    sql<{ readonly head_seq: number }>`
      SELECT head_seq FROM engine_conversation WHERE conversation_id = ${conversation}
    `.pipe(Effect.map((rows) => rows[0]?.head_seq ?? 0));

  /**
   * Run groups, the newest first: a run that joins none roots a group (a person's message, a
   * wake of its own), and every run that joins into it belongs to it.
   */
  const groups = (conversation: ConversationId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly run_id: string;
        readonly ordinal: number;
        readonly joins: string | null;
      }>`
        SELECT run_id, ordinal, joins FROM engine_run WHERE conversation_id = ${conversation}
        ORDER BY ordinal
      `;
      const byId = new Map(rows.map((row) => [row.run_id, row]));
      const rootOf = (id: string): { readonly run_id: string; readonly ordinal: number } => {
        let row = byId.get(id)!;
        for (let hops = 0; row.joins !== null && byId.has(row.joins) && hops < 1_000; hops++) {
          row = byId.get(row.joins)!;
        }
        return row;
      };
      const members = new Map<string, { ordinal: number; runs: Array<string> }>();
      for (const row of rows) {
        const root = rootOf(row.run_id);
        const group = members.get(root.run_id) ?? { ordinal: root.ordinal, runs: [] };
        group.runs.push(row.run_id);
        members.set(root.run_id, group);
      }
      return [...members.values()].sort((a, b) => b.ordinal - a.ordinal);
    });

  /** The groups a window or a page holds, and whether older ones exist before them. */
  const pickGroups = (
    all: ReadonlyArray<{ readonly ordinal: number; readonly runs: ReadonlyArray<string> }>,
    count: number,
    beforeOrdinal?: number,
  ) => {
    const older = beforeOrdinal === undefined ? all : all.filter((g) => g.ordinal < beforeOrdinal);
    const picked = older.slice(0, Math.max(1, count));
    const oldestOrdinal = picked.at(-1)?.ordinal ?? null;
    const window: EngineWindow = {
      oldestOrdinal,
      earlier: oldestOrdinal !== null && all.some((group) => group.ordinal < oldestOrdinal),
    };
    return { runIds: picked.flatMap((group) => group.runs), window };
  };

  /**
   * What a window shows of its runs: the runs, every person message, request and answer, every
   * open request (wherever it was asked), and the newest items of each run not ended.
   */
  const windowOf = (
    conversation: ConversationId,
    runIds: ReadonlyArray<string>,
    window: EngineWindow,
  ) =>
    Effect.gen(function* () {
      const runs = yield* runsById(conversation, runIds);
      const answers = runs.flatMap((run) =>
        run.summary.answerItemId === null ? [] : [run.summary.answerItemId],
      );
      const openRequests = yield* sql<RequestRow>`
        SELECT * FROM engine_request WHERE conversation_id = ${conversation} AND state = 'open'
        ORDER BY seq
      `;
      const runRequests =
        runIds.length === 0
          ? []
          : yield* sql<RequestRow>`
              SELECT * FROM engine_request
              WHERE conversation_id = ${conversation} AND ${sql.in("run_id", runIds)}
                AND state != 'open'
              ORDER BY seq
            `;
      const shown =
        runIds.length === 0
          ? []
          : yield* sql<ItemRow>`
              SELECT * FROM engine_item WHERE conversation_id = ${conversation}
                AND ${sql.in("run_id", runIds)}
                AND (kind IN ('person', 'request')
                  ${answers.length === 0 ? sql`` : sql`OR ${sql.in("item_id", answers)}`})
            `;
      const asked =
        openRequests.length === 0
          ? []
          : yield* sql<ItemRow>`
              SELECT * FROM engine_item WHERE conversation_id = ${conversation} AND kind = 'request'
                AND json_extract(body_json, '$.requestId') IN ${sql.in(
                  openRequests.map((row) => row.request_id),
                )}
            `;
      const tails: Array<ItemRow> = [];
      for (const run of runs) {
        if (run.state === "ended") continue;
        tails.push(
          ...(yield* sql<ItemRow>`
            SELECT * FROM engine_item WHERE run_id = ${run.id}
            ORDER BY opened_seq DESC LIMIT ${ENGINE_WIRE_BUDGETS.liveTailItems}
          `),
        );
      }
      const floor = runs[0]?.seq;
      const loose =
        floor === undefined
          ? []
          : yield* sql<ItemRow>`
              SELECT * FROM engine_item WHERE conversation_id = ${conversation}
                AND run_id IS NULL AND opened_seq >= ${floor}
            `;
      const unique = new Map<string, ItemRow>();
      for (const row of [...shown, ...asked, ...tails, ...loose]) unique.set(row.item_id, row);
      const requestRows = new Map<string, RequestRow>();
      for (const row of [...runRequests, ...openRequests]) requestRows.set(row.request_id, row);
      return {
        runs,
        items: yield* items([...unique.values()].sort((a, b) => a.opened_seq - b.opened_seq)),
        requests: yield* requests([...requestRows.values()].sort((a, b) => a.seq - b.seq)),
        window,
      };
    });

  return {
    origin,
    head,
    groups,
    pickGroups,
    windowOf,
    runsById,
    /** How many records changed past a cursor: a resume carries no more than its budget. */
    changedCount: (conversation: ConversationId, after: number) =>
      sql<{ readonly n: number }>`
        SELECT
          (SELECT COUNT(*) FROM engine_run WHERE conversation_id = ${conversation} AND rev > ${after})
          + (SELECT COUNT(*) FROM engine_item WHERE conversation_id = ${conversation} AND rev > ${after})
          + (SELECT COUNT(*) FROM engine_request
             WHERE conversation_id = ${conversation} AND rev > ${after}) AS n
      `.pipe(Effect.map((rows) => rows[0]?.n ?? 0)),
    /**
     * Every record that changed past a cursor, whole, and every run one of whose items did (its
     * summary moved with them).
     */
    changedSince: (conversation: ConversationId, after: number) =>
      Effect.gen(function* () {
        const itemRows = yield* sql<ItemRow>`
          SELECT * FROM engine_item WHERE conversation_id = ${conversation} AND rev > ${after}
          ORDER BY rev, opened_seq
        `;
        const requestRows = yield* sql<RequestRow>`
          SELECT * FROM engine_request WHERE conversation_id = ${conversation} AND rev > ${after}
          ORDER BY rev, seq
        `;
        const runIds = yield* sql<{ readonly run_id: string }>`
          SELECT run_id FROM engine_run WHERE conversation_id = ${conversation} AND rev > ${after}
        `;
        const touched = new Set([
          ...runIds.map((row) => row.run_id),
          ...itemRows.flatMap((row) => (row.run_id === null ? [] : [row.run_id])),
        ]);
        return {
          runs: yield* runsById(conversation, [...touched]),
          items: yield* items(itemRows),
          requests: yield* requests(requestRows),
          to: Math.max(
            after,
            ...itemRows.map((row) => row.rev),
            ...requestRows.map((row) => row.rev),
          ),
        };
      }),
    /**
     * A run's items, the newest page; `more` when older ones exist before it. After `afterSeq`,
     * the oldest page; `more` when later ones exist. `only: "outcome"`: the items a closed card
     * draws its result from — its background work with the calls that started it, which its line
     * of jobs is drawn from.
     */
    runPage: (
      conversation: ConversationId,
      runId: RunId,
      options: {
        readonly beforeSeq?: number;
        readonly afterSeq?: number;
        readonly only?: "outcome";
        readonly limit: number;
      },
    ) =>
      Effect.gen(function* () {
        const forward = options.afterSeq !== undefined;
        const rows = yield* sql<ItemRow>`
          SELECT * FROM engine_item WHERE conversation_id = ${conversation} AND run_id = ${runId}
            ${options.beforeSeq === undefined ? sql`` : sql`AND opened_seq < ${options.beforeSeq}`}
            ${options.afterSeq === undefined ? sql`` : sql`AND opened_seq > ${options.afterSeq}`}
            ${
              options.only === "outcome"
                ? sql`AND (kind = 'work' OR (kind = 'call' AND (
                    json_extract(body_json, '$.result') IS NOT NULL
                    OR json_extract(body_json, '$.step') = 'look'
                    OR item_id IN (
                      SELECT json_extract(body_json, '$.call') FROM engine_item
                      WHERE conversation_id = ${conversation} AND run_id = ${runId}
                        AND kind = 'work'))))`
                : sql``
            }
          ORDER BY opened_seq ${forward ? sql`ASC` : sql`DESC`} LIMIT ${options.limit + 1}
        `;
        const page = forward
          ? rows.slice(0, options.limit)
          : rows.slice(0, options.limit).toReversed();
        const requestRows = yield* sql<RequestRow>`
          SELECT * FROM engine_request WHERE conversation_id = ${conversation} AND run_id = ${runId}
          ORDER BY seq
        `;
        return {
          runs: yield* runsById(conversation, [runId]),
          items: yield* items(page),
          requests: yield* requests(requestRows),
          more: rows.length > options.limit,
        };
      }),
    /** An item's whole part, as stored; none when it has no such part. */
    part: (conversation: ConversationId, itemId: ItemId, part: string) =>
      Effect.gen(function* () {
        switch (part) {
          case "text": {
            const [row] = yield* sql<{ readonly body_json: string }>`
              SELECT body_json FROM engine_item
              WHERE conversation_id = ${conversation} AND item_id = ${itemId}
            `;
            const body =
              row === undefined ? undefined : (parse(row.body_json) as { text?: unknown });
            return typeof body?.text === "string" ? body.text : undefined;
          }
          case "result": {
            const [row] = yield* sql<{ readonly body_json: string }>`
              SELECT body_json FROM engine_item
              WHERE conversation_id = ${conversation} AND item_id = ${itemId}
            `;
            const body =
              row === undefined
                ? undefined
                : (parse(row.body_json) as { result?: { resultText?: unknown } });
            return typeof body?.result?.resultText === "string"
              ? body.result.resultText
              : undefined;
          }
          case "detail": {
            const [row] = yield* sql<{ readonly body: string }>`
              SELECT d.body FROM engine_item_detail d JOIN engine_item i ON i.item_id = d.item_id
              WHERE i.conversation_id = ${conversation} AND d.item_id = ${itemId}
            `;
            return row?.body;
          }
          case "data": {
            const [row] = yield* sql<{ readonly data_json: string }>`
              SELECT data_json FROM engine_item_data
              WHERE conversation_id = ${conversation} AND item_id = ${itemId}
            `;
            return row?.data_json;
          }
          default:
            return undefined;
        }
      }),
    /** The keys the live plane names the conversation's open items by. */
    openItemKeys: (conversation: ConversationId) =>
      sql<{ readonly item_id: string; readonly live_key: string | null }>`
        SELECT i.item_id, json_extract(e.payload_json, '$.key') AS live_key
        FROM engine_item i
        JOIN engine_event e ON e.conversation_id = i.conversation_id AND e.seq = i.opened_seq
        WHERE i.conversation_id = ${conversation} AND i.state = 'open'
      `,
    /** The stored receipt of a command; none while it is unsettled or was never taken. */
    receipt: (conversation: ConversationId, commandId: string) =>
      sql<{ readonly result_json: string | null }>`
        SELECT result_json FROM engine_receipt
        WHERE conversation_id = ${conversation} AND command_id = ${commandId}
      `.pipe(Effect.map((rows) => rows[0]?.result_json ?? null)),
  };
});

export type Records = Effect.Success<typeof makeRecords>;
export type { RequestId };
