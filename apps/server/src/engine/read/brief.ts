/**
 * The brief: what another agent taking a started conversation over is told of it, read from the
 * record — the person's messages, the previous agent's words and a line per call, oldest first,
 * cut to the latest part that fits. Nothing of the previous session carries over, so this is
 * all the new agent knows of what came before.
 *
 * @module engine/read/brief
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ItemBody, type ConversationId } from "@t3tools/contracts";

/** The brief's whole size, in characters: about six thousand tokens. */
export const BRIEF_MAX = 24_000;
/** One message's share of it: a long one keeps its start. */
const MESSAGE_MAX = 4_000;
/** One call's line. */
const CALL_MAX = 200;
/** The newest items read: more than any brief that fits holds. */
const ITEMS_READ = 800;

const HEAD =
  "You are taking this conversation over from another agent; nothing of its session carries over. Below is the conversation so far as its record keeps it — the person's messages, the previous agent's words and one line per tool call, oldest first. Read it as what came before; the person's new message follows it.";

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** One item of the record as the brief says it, or nothing for one it leaves out. */
export const briefLine = (body: ItemBody): string | null => {
  switch (body.kind) {
    case "person": {
      // A message not yet delivered goes to the new agent as its own; a refused one never went.
      if (body.delivery.state === "queued" || body.delivery.state === "refused") return null;
      const text = body.text.trim();
      if (text === "") return null;
      return `${body.mateMessage === undefined ? "Person" : "Another Mate"}: ${cut(text, MESSAGE_MAX)}`;
    }
    case "note": {
      const text = body.text.trim();
      return text === "" ? null : `Agent: ${cut(text, MESSAGE_MAX)}`;
    }
    case "call": {
      const input = body.input?.replace(/\s+/gu, " ").trim();
      return cut(`  · ${body.tool.name}${input ? `: ${input}` : ""}`, CALL_MAX);
    }
    default:
      return null;
  }
};

/**
 * The brief from the record's lines, newest last: the latest that fit in `BRIEF_MAX`, saying
 * so when earlier ones are left out. Empty when there is nothing to tell.
 */
export const briefOf = (lines: ReadonlyArray<string>): string => {
  const kept: string[] = [];
  let size = HEAD.length + 64;
  let index = lines.length - 1;
  for (; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (size + line.length + 1 > BRIEF_MAX) break;
    kept.push(line);
    size += line.length + 1;
  }
  if (kept.length === 0) return "";
  kept.reverse();
  if (index >= 0) kept.unshift("(earlier conversation left out)");
  return `${HEAD}\n\n<conversation>\n${kept.join("\n")}\n</conversation>`;
};

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(ItemBody));

/**
 * The brief of the conversation's record: all of it, the previous agent's last turn too, even when
 * it ran on after the person picked the new agent.
 */
export const readBrief = (sql: SqlClient.SqlClient, conversation: ConversationId) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly body_json: string }>`
      SELECT body_json FROM engine_item
      WHERE conversation_id = ${conversation} AND kind IN ('person', 'note', 'call')
      ORDER BY opened_seq DESC LIMIT ${ITEMS_READ}
    `;
    const lines: string[] = [];
    for (const row of rows.toReversed()) {
      const body = decodeBody(row.body_json);
      if (body._tag === "None") continue;
      const line = briefLine(body.value);
      if (line !== null) lines.push(line);
    }
    return briefOf(lines);
  });
