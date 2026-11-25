/** The timing of an ended run, derived once from its own event record. */
import type { ConversationId, RunId } from "@t3tools/contracts";
import type * as SqlClient from "effect/sql/SqlClient";

import { bareToolName } from "../domain/mateAsks.ts";

export const RUN_SPAN = "engine.run";

const CLASSES = ["deploy", "browser", "zcp_run", "git", "zcp", "other"] as const;
type ToolClass = (typeof CLASSES)[number];

/** Command input is used only to classify the call, never written to the trace. */
export const toolClass = ({
  step,
  tool,
  input,
}: {
  readonly step: string | null;
  readonly tool: string | null;
  readonly input: string | null;
}): ToolClass => {
  const name = bareToolName(tool ?? "");
  if (name === "zerops_deploy" || name === "zerops_deploy_batch") return "deploy";
  if (name === "zerops_browser") return "browser";
  if (step === "command" && input !== null) {
    if (/(?:^|[\s;&|('"`])zcp\s+run(?=$|[\s;&|)'"`])/u.test(input)) return "zcp_run";
    if (/(?:^|[\s;&|('"`])(?:zcp\s+git|git)(?=$|[\s;&|)'"`])/u.test(input)) return "git";
  }
  if (name.startsWith("zerops_")) return "zcp";
  return "other";
};

/** Only columns needed for the timing; no streamed updates or message text are decoded. */
export interface RunTraceRow {
  readonly type: string;
  readonly at: number;
  readonly item: string | null;
  readonly kind: string | null;
  readonly step: string | null;
  readonly tool: string | null;
  readonly input: string | null;
  readonly marker: string | null;
  readonly trigger: string | null;
  readonly cause: string | null;
}

export const RUN_TRACE_SQL = `
  SELECT type, at,
    json_extract(payload_json, '$.itemId') AS item, json_extract(payload_json, '$.body.kind') AS kind,
    json_extract(payload_json, '$.body.step') AS step, json_extract(payload_json, '$.body.tool.name') AS tool,
    json_extract(payload_json, '$.body.input') AS input, json_extract(payload_json, '$.body.marker.kind') AS marker,
    json_extract(payload_json, '$.trigger.kind') AS trigger, json_extract(payload_json, '$.trigger.cause') AS cause
  FROM engine_event
  WHERE conversation_id = ? AND seq >= (SELECT seq FROM engine_run WHERE run_id = ?) AND run_id = ?
    AND type IN ('RunQueued', 'RunStarted', 'RunWaiting', 'RunResumed', 'RunEnded', 'ItemOpened', 'ItemClosed')
  ORDER BY seq
`;

/** The run's events from its queueing onwards, in record order. */
export const readRunTrace = (
  sql: SqlClient.SqlClient,
  conversation: ConversationId,
  runId: RunId,
) => sql.unsafe<RunTraceRow>(RUN_TRACE_SQL, [conversation, runId, runId]);

type Interval = { readonly start: number; readonly end: number };
type Call = Interval & { readonly class: ToolClass };
type Part = ToolClass | "waiting" | "compaction";

/** The wall time's disjoint parts, and counts derived from the same run. */
export interface RunTiming {
  readonly start: number;
  readonly end: number;
  readonly trigger: string;
  readonly queued: number;
  readonly wall: number;
  readonly model: number;
  readonly waiting: number;
  readonly compaction: number;
  readonly compactions: number;
  readonly roundTrips: number;
  readonly calls: number;
  readonly firstCall?: number;
  readonly tools: Readonly<Record<ToolClass, { readonly ms: number; readonly calls: number }>>;
}

/** Split every millisecond by waiting, call priority, compaction, then model. */
export const runTiming = (rows: ReadonlyArray<RunTraceRow>): RunTiming | undefined => {
  const started = rows.find((row) => row.type === "RunStarted");
  const ended = rows.find((row) => row.type === "RunEnded");
  if (started === undefined || ended === undefined) return undefined;
  const start = started.at;
  const end = Math.max(start, ended.at);
  const clamp = (at: number) => Math.max(start, Math.min(end, at));
  const interval = (from: number, to: number): Interval => {
    const first = clamp(from);
    return { start: first, end: Math.max(first, clamp(to)) };
  };
  const queued = rows.find((row) => row.type === "RunQueued");
  const callsByItem = new Map<string, { opened: RunTraceRow; last: RunTraceRow }>();
  const waits: Interval[] = [];
  const compactions: Interval[] = [];
  let waitingAt: number | undefined;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.type === "ItemOpened" && row.kind === "call" && row.item !== null) {
      callsByItem.set(row.item, { opened: row, last: row });
    } else if (row.type === "ItemClosed" && row.item !== null) {
      const call = callsByItem.get(row.item);
      if (call !== undefined) call.last = row;
    }
    if (row.type === "RunWaiting" && waitingAt === undefined) waitingAt = row.at;
    if (row.type === "RunResumed" && waitingAt !== undefined) {
      waits.push(interval(waitingAt, row.at));
      waitingAt = undefined;
    }
    if (row.type === "ItemOpened" && row.marker === "compacted") {
      let before = index - 1;
      while (before >= 0 && rows[before]!.item === row.item) before -= 1;
      let after = index + 1;
      while (after < rows.length && rows[after]!.item === row.item) after += 1;
      compactions.push(interval(rows[before]?.at ?? start, rows[after]?.at ?? end));
    }
  }
  if (waitingAt !== undefined) waits.push(interval(waitingAt, end));
  const calls: Call[] = Array.from(callsByItem.values(), ({ opened, last }) => ({
    ...interval(opened.at, last === opened ? end : last.at),
    class: toolClass(last),
  }));
  const tools = Object.fromEntries(CLASSES.map((name) => [name, { ms: 0, calls: 0 }])) as Record<
    ToolClass,
    { ms: number; calls: number }
  >;
  for (const call of calls) tools[call.class].calls += 1;

  // Count even an instantaneous call; touching calls are one round-trip.
  let roundTrips = 0;
  let lastCallEnd: number | undefined;
  for (const call of calls.toSorted((a, b) => a.start - b.start)) {
    if (lastCallEnd === undefined || call.start > lastCallEnd) roundTrips += 1;
    lastCallEnd = Math.max(lastCallEnd ?? call.end, call.end);
  }

  // Equal-time boundaries are applied together before assigning the next stretch.
  const boundaries: Array<{ at: number; part: Part; delta: number }> = [];
  const add = (part: Part, span: Interval) => {
    boundaries.push({ at: span.start, part, delta: 1 }, { at: span.end, part, delta: -1 });
  };
  for (const call of calls) add(call.class, call);
  for (const wait of waits) add("waiting", wait);
  for (const compaction of compactions) add("compaction", compaction);
  boundaries.sort((a, b) => a.at - b.at);
  const active: Record<Part, number> = {
    waiting: 0,
    deploy: 0,
    browser: 0,
    zcp_run: 0,
    git: 0,
    zcp: 0,
    other: 0,
    compaction: 0,
  };
  let model = 0;
  let waiting = 0;
  let compaction = 0;
  let previous = start;
  let index = 0;
  while (index < boundaries.length) {
    const at = boundaries[index]!.at;
    const elapsed = at - previous;
    const tool = CLASSES.find((name) => active[name] > 0);
    if (active.waiting > 0) waiting += elapsed;
    else if (tool !== undefined) tools[tool].ms += elapsed;
    else if (active.compaction > 0) compaction += elapsed;
    else model += elapsed;
    while (index < boundaries.length && boundaries[index]!.at === at) {
      const boundary = boundaries[index++]!;
      active[boundary.part] += boundary.delta;
    }
    previous = at;
  }
  model += end - previous;
  const firstCall =
    calls.length === 0
      ? undefined
      : calls.reduce((first, call) => Math.min(first, call.start), end) - start;
  return {
    start,
    end,
    trigger: queued?.trigger === "wake" ? `wake:${queued.cause ?? ""}` : "person",
    queued: Math.max(0, start - (queued?.at ?? start)),
    wall: end - start,
    model,
    waiting,
    compaction,
    compactions: compactions.length,
    roundTrips,
    calls: calls.length,
    ...(firstCall === undefined ? {} : { firstCall }),
    tools,
  };
};

/** The timing's trace attributes; the event supplies its own end and context separately. */
export const timingAttributes = (timing: RunTiming): Record<string, string | number> => ({
  "run.trigger": timing.trigger,
  "run.queued_ms": timing.queued,
  "run.wall_ms": timing.wall,
  "run.model_ms": timing.model,
  "run.waiting_ms": timing.waiting,
  "run.compaction_ms": timing.compaction,
  "run.compactions": timing.compactions,
  "run.round_trips": timing.roundTrips,
  "run.calls": timing.calls,
  ...(timing.firstCall === undefined ? {} : { "run.first_call_ms": timing.firstCall }),
  ...Object.fromEntries(
    CLASSES.flatMap((name) => [
      [`run.tool.${name}_ms`, timing.tools[name].ms],
      [`run.tool.${name}_calls`, timing.tools[name].calls],
    ]),
  ),
});
