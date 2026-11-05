// @effect-diagnostics preferSchemaOverJson:off - a fixture writes rows as the projector writes them.
/**
 * A long, old conversation and its neighbours, written straight into the projections the wire
 * reads (`engine_run`, `engine_item`, `engine_item_detail`, `engine_request`,
 * `engine_page_height`) the way the projector writes them: what a Mate holds after months of work,
 * in a second, deterministic to the byte. The conversations themselves are made by the engine
 * (`AssignAgent`), so their actors and headers are real; the record under them is seeded.
 *
 * Each conversation's runs are ordinal `1..runs`: a person's message roots most; every ninth is a
 * wake joining the run before it, every thirteenth a message queued while the run before worked;
 * long messages, long answers (whole in their detail), long tool results (cut on the wire), a
 * published page with its measured heights, answered approvals, and a newest run still working
 * with an open approval and messages loose of any run.
 *
 * @module engine/testing/longHistory
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { ConversationId } from "@t3tools/contracts";

import { makeRng, type Rng } from "./rng.ts";

export interface LongHistoryShape {
  readonly conversation: ConversationId;
  readonly runs: number;
  readonly itemsPerRun: number;
  /** The newest run still works, with an approval open. */
  readonly working?: boolean;
  readonly seed?: number;
  /** Every how many runs an answer is long (whole in its detail); 25 by default. */
  readonly longAnswerEvery?: number;
  /** Every how many runs the person's message is long; 50 by default. */
  readonly longPersonEvery?: number;
}

const T0 = 1_760_000_000_000;
const RUN_SPAN = 600_000;
const SEQ_SPAN = 1_000;

const WORDS = [
  "deploy",
  "service",
  "build",
  "the",
  "api",
  "storefront",
  "worker",
  "queue",
  "migrate",
  "schema",
  "logs",
  "check",
  "branch",
  "review",
  "fix",
  "env",
  "port",
  "cache",
  "route",
  "test",
  "green",
  "failed",
  "retry",
  "config",
  "image",
  "release",
  "rollback",
  "health",
  "ready",
  "pipeline",
];

const words = (rng: Rng, count: number) =>
  Array.from({ length: count }, () => rng.pick(WORDS)).join(" ");

/** Text of about `bytes` bytes, in lines. */
const text = (rng: Rng, bytes: number) => {
  const lines: Array<string> = [];
  let size = 0;
  while (size < bytes) {
    const line = words(rng, rng.int(4, 14));
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join("\n");
};

const digest = (rng: Rng) =>
  Array.from({ length: 64 }, () => "0123456789abcdef"[rng.int(0, 15)]).join("");

type Cell = string | number | null;
type Row = Readonly<Record<string, Cell>>;

type RunRowIn = {
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
};

type ItemRowIn = {
  readonly item_id: string;
  readonly conversation_id: string;
  readonly run_id: string | null;
  readonly kind: string;
  readonly state: string;
  readonly by_json: string;
  readonly body_json: string;
  readonly opened_seq: number;
  readonly rev: number;
  readonly at: number;
  readonly closed_seq: number | null;
};

const PERSON = { kind: "person", subject: "zerops-user:ana" };
const MATE_BY = JSON.stringify({ kind: "mate" });
const PERSON_BY = JSON.stringify({ kind: "person", principal: PERSON });

/** The rows of one conversation's long record. */
export const longHistoryRows = (shape: LongHistoryShape) => {
  const rng = makeRng(shape.seed ?? 7);
  const c = shape.conversation as string;
  const runs: Array<RunRowIn> = [];
  const items: Array<ItemRowIn> = [];
  const details: Array<{ item_id: string; body: string }> = [];
  const requests: Array<Row> = [];
  const heights: Array<Row> = [];
  let previous: { readonly startedAt: number; readonly id: string } | undefined;

  for (let ordinal = 1; ordinal <= shape.runs; ordinal++) {
    const id = `${c}/r/${ordinal}`;
    const working = shape.working === true && ordinal === shape.runs;
    const base = ordinal * SEQ_SPAN;
    const wake = ordinal % 9 === 0 && previous !== undefined;
    const queued = !wake && ordinal % 13 === 0 && previous !== undefined;
    const at = T0 + ordinal * RUN_SPAN;
    const queuedAt = queued ? previous!.startedAt + 1_000 : at;
    const startedAt = at + 100;
    const endedAt = working ? null : at + RUN_SPAN / 2;
    const end = working
      ? null
      : ordinal % 47 === 0
        ? { kind: "usage-limit", resetsAt: null }
        : { kind: "completed" };
    let seq = base;
    let held = 0;
    const next = () => ++seq;
    const open = (
      kind: string,
      body: Record<string, unknown>,
      by: string,
      run: string | null = id,
    ) => {
      const opened = next();
      const closed = working && items.length % 7 === 0 ? null : next();
      const itemId = `${c}/r/${ordinal}/i/${opened - base}`;
      if (run === id) held += 1;
      items.push({
        item_id: itemId,
        conversation_id: c,
        run_id: run,
        kind,
        state: closed === null ? "open" : "closed",
        by_json: by,
        body_json: JSON.stringify({ kind, ...body }),
        opened_seq: opened,
        rev: closed ?? opened,
        at: at + (opened - base) * 500,
        closed_seq: closed,
      });
      return itemId;
    };

    // The message that started it, long now and then.
    const personItem = wake
      ? undefined
      : open(
          "person",
          {
            text:
              ordinal % (shape.longPersonEvery ?? 50) === 0
                ? text(rng, 20 * 1024)
                : words(rng, rng.int(6, 40)),
            attachments: [],
            sendId: `send-${c}-${ordinal}`,
            delivery: { state: "delivered", at: queuedAt },
          },
          PERSON_BY,
        );
    for (let n = 0; held < shape.itemsPerRun; n++) {
      const pick = n % 10;
      if (pick === 0) {
        open(
          "thought",
          { preview: words(rng, 60), length: rng.int(200, 4_000), streaming: false },
          MATE_BY,
        );
      } else if (pick === 1 || pick === 6) {
        open(
          "note",
          { text: words(rng, rng.int(8, 60)), streaming: false, answer: false },
          MATE_BY,
        );
      } else if (pick === 2 || pick === 7) {
        open(
          "call",
          {
            step: "command",
            tool: { name: "Command run" },
            words: "Command run",
            state: "done",
            endedAt: at,
            input: `npm run ${rng.pick(WORDS)} -- --filter ${rng.pick(WORDS)}`,
            shows: { item: { aggregatedOutput: text(rng, rng.int(200, 3_000)) } },
            parts: ["data", "detail"],
          },
          MATE_BY,
        );
      } else if (pick === 3) {
        const resultText = JSON.stringify({
          status: rng.pick(["ACTIVE", "FINISHED", "FAILED"]),
          log: text(rng, rng.int(2_000, 40 * 1024)),
        });
        open(
          "call",
          {
            step: "mcp",
            tool: {
              name: `zerops_${rng.pick(["deploy", "logs", "discover", "verify"])}`,
              server: "zerops",
            },
            words: "MCP tool call",
            state: "done",
            endedAt: at,
            input: `${rng.pick(WORDS)}: ${rng.pick(WORDS)}`,
            shows: { toolName: "mcp__zerops__deploy", input: { serviceHostname: "api" } },
            result: { toolName: "zerops_deploy", resultText },
            parts: ["data", "result"],
          },
          MATE_BY,
        );
      } else if (pick === 4) {
        open(
          "call",
          {
            step: "edit",
            tool: { name: "Write" },
            words: `Write src/${rng.pick(WORDS)}.ts`,
            state: "done",
            endedAt: at,
            shows: {
              input: { file_path: `src/${rng.pick(WORDS)}.ts` },
              wrote: true,
              toolName: "Write",
            },
            parts: ["data"],
          },
          MATE_BY,
        );
      } else if (pick === 5 && n % 20 !== 15) {
        open(
          "call",
          {
            step: "edit",
            tool: { name: "Edit files" },
            words: "Edit files",
            state: "done",
            endedAt: at,
            shows: { files: [{ path: `src/${rng.pick(WORDS)}.ts` }, { path: "README.md" }] },
            parts: ["data"],
          },
          MATE_BY,
        );
      } else if (pick === 5 && n % 20 === 15) {
        // An edit naming no file, and a notebook's.
        open(
          "call",
          {
            step: "edit",
            tool: { name: rng.pick(["NotebookEdit", "apply_patch"]) },
            words: "Edit",
            state: "done",
            endedAt: at,
            shows: n % 40 === 15 ? {} : { input: { notebook_path: "notes/plan.ipynb" } },
            parts: ["data"],
          },
          MATE_BY,
        );
      } else if (pick === 8 && n % 30 === 18) {
        // A helper's own calls: its card counts them, never the Mate's.
        open(
          "call",
          {
            step: rng.pick(["command", "edit", "tool"]),
            tool: { name: rng.pick(["Bash", "Write", "WebSearch"]) },
            words: "Helper call",
            state: "done",
            endedAt: at,
            shows: { input: { file_path: "src/helper.ts" } },
            parts: ["data"],
          },
          JSON.stringify({ kind: "helper", helperId: `${c}/h/${ordinal}` }),
        );
      } else if (pick === 9 && n % 20 === 19) {
        // A generic tool, counted by its name.
        open(
          "call",
          {
            step: "tool",
            tool: { name: rng.pick(["WebSearch", "TodoWrite", "Task", "ÜberTool", "élan"]) },
            words: "Tool call",
            state: rng.pick(["done", "failed"]),
            endedAt: at,
            parts: ["data"],
          },
          MATE_BY,
        );
      } else if (pick === 8 && n % 40 === 8) {
        const call = open(
          "call",
          {
            step: "command",
            tool: { name: "Command run" },
            words: "Command run",
            state: "done",
            endedAt: at,
            input: "npm run dev",
            parts: ["data"],
          },
          MATE_BY,
        );
        open(
          "work",
          {
            work: `${c}/s/1.${ordinal}.w${n}`,
            workKind: "shell",
            status: working ? "running" : "completed",
            title: "Watch the build",
            call,
            ...(working ? {} : { endedAt: at }),
          },
          MATE_BY,
        );
      } else {
        open(
          "call",
          {
            step: "look",
            tool: { name: "Read" },
            words: `Read src/${rng.pick(WORDS)}.ts`,
            state: "done",
            endedAt: at,
            input: `src/${rng.pick(WORDS)}.ts`,
            shows: { input: { file_path: `src/${rng.pick(WORDS)}.ts` }, toolName: "Read" },
            parts: ["data"],
          },
          MATE_BY,
        );
      }
    }
    if (ordinal % 40 === 20) {
      const page = open(
        "call",
        {
          step: "mcp",
          tool: { name: "zerops_publish_page", server: "zerops" },
          words: "MCP tool call",
          state: "done",
          endedAt: at,
          result: {
            toolName: "zerops_publish_page",
            page: {
              asset: {
                id: `page-${ordinal}`,
                threadId: c,
                ownerId: "zerops-user:ana",
                name: "plan.html",
                provenance: "capture",
                original: {
                  status: "ready",
                  digest: digest(rng),
                  mimeType: "text/html",
                  sizeBytes: 4_096,
                },
              },
              title: "Launch plan",
              bytes: 4_096,
              publishedAt: at,
            },
          },
          parts: ["data"],
        },
        MATE_BY,
      );
      heights.push(
        { conversation_id: c, item_id: page, width: 375, height: 1_400, at: 1 },
        { conversation_id: c, item_id: page, width: 720, height: 900, at: 2 },
      );
    }
    // An approval: answered on a run that ended, open on the one still working.
    if (ordinal % 6 === 0 || working) {
      const requestSeq = next();
      const requestId = `${c}/q/${ordinal}`;
      open("request", { requestId }, MATE_BY);
      requests.push({
        request_id: requestId,
        conversation_id: c,
        run_id: id,
        seq: requestSeq,
        rev: working ? requestSeq : requestSeq + 2,
        at: at + 1_000,
        kind: "approval",
        ask_json: JSON.stringify({
          kind: "approval",
          requestKind: "command",
          detail: text(rng, rng.int(100, 9_000)),
        }),
        answerable: working ? 1 : 0,
        state: working ? "open" : "answered",
        principal_json: JSON.stringify(PERSON),
        answer_json: working
          ? null
          : JSON.stringify({ by: PERSON, at: at + 2_000, summary: "Approved" }),
      });
    }
    // Its answer, whole in its detail when long.
    if (!working) {
      const long = ordinal % (shape.longAnswerEvery ?? 25) === 0;
      const whole = long ? text(rng, 24 * 1024) : words(rng, rng.int(20, 120));
      const answer = open(
        "note",
        { text: long ? whole.slice(0, 16 * 1024) : whole, streaming: false, answer: true },
        MATE_BY,
      );
      if (long) details.push({ item_id: answer, body: whole });
    } else {
      open("note", { text: "Working on it", streaming: false, answer: false }, MATE_BY, null);
    }
    if (personItem !== undefined && ordinal === 1) {
      // A marker loose of any run, as a model switch leaves one.
      open("marker", { marker: { kind: "model-switched", model: "m2" } }, MATE_BY, null);
    }
    runs.push({
      run_id: id,
      conversation_id: c,
      ordinal,
      seq: base,
      rev: seq,
      trigger_json: JSON.stringify(
        wake
          ? { kind: "wake", cause: "agent-turn", wakeId: null }
          : { kind: "person", itemId: personItem },
      ),
      joins: wake ? previous!.id : null,
      principal_json: JSON.stringify(PERSON),
      state: working ? "running" : "ended",
      maintenance: 0,
      waiting_on: working ? `${c}/q/${ordinal}` : null,
      stop_asked_json: null,
      end_json: end === null ? null : JSON.stringify(end),
      end_source: end === null ? null : "agent",
      session_id: `${c}/s/1.${ordinal}`,
      provider_turn_id: `T${ordinal}`,
      queued_at: queuedAt,
      admitted_at: queuedAt + 50,
      started_at: startedAt,
      ended_at: endedAt,
      unresponsive_since: null,
    });
    previous = { startedAt, id };
  }
  return { runs, items, details, requests, heights, head: (shape.runs + 1) * SEQ_SPAN };
};

const CHUNK = 400;

/** Writes a long record under a conversation the engine already holds. */
export const seedLongHistory = (shape: LongHistoryShape) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = longHistoryRows(shape);
    const insert = (table: string, all: ReadonlyArray<Row>) =>
      Effect.forEach(
        Array.from({ length: Math.ceil(all.length / CHUNK) }, (_, index) =>
          all.slice(index * CHUNK, (index + 1) * CHUNK),
        ),
        (chunk) => sql`INSERT INTO ${sql(table)} ${sql.insert(chunk)}`,
        { discard: true },
      );
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* insert("engine_run", rows.runs);
        yield* insert("engine_item", rows.items);
        yield* insert("engine_item_detail", rows.details);
        yield* insert("engine_request", rows.requests);
        yield* insert("engine_page_height", rows.heights);
        yield* sql`
          UPDATE engine_conversation SET head_seq = ${rows.head}
          WHERE conversation_id = ${shape.conversation}
        `;
      }),
    );
    return { runs: rows.runs.length, items: rows.items.length, head: rows.head };
  });
