/**
 * The wire's encoder budgets (`ENGINE_WIRE_BUDGETS`): every record is cut to its budget before it
 * leaves (an item names the part it cut, read whole on demand), a `changes` frame over its budget
 * is split, streamed text goes in frames no larger than a live frame's budget. Pure.
 *
 * @module engine/wire/budget
 */
import {
  ENGINE_WIRE_BUDGETS,
  type EngineConversationFrame,
  type Item,
  type ItemId,
  type Request,
  type RunRecord,
} from "@t3tools/contracts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 bytes of a value as the wire writes it. */
export const bytesOf = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

export const utf8Length = (text: string): number => encoder.encode(text).length;

/** The longest start of `text` within `max` UTF-8 bytes, never splitting a character. */
export const cutUtf8 = (text: string, max: number): string => {
  const bytes = encoder.encode(text);
  if (bytes.length <= max) return text;
  return decoder.decode(bytes.subarray(0, max)).replace(/�+$/u, "");
};

/** UTF-8 byte range of a text: `[from, from + bytes)`, never splitting a character. */
export const sliceUtf8 = (text: string, from: number, bytes: number) => {
  const all = encoder.encode(text);
  const start = Math.min(Math.max(0, from), all.length);
  const slice = decoder.decode(all.subarray(start, start + bytes)).replace(/�+$/u, "");
  return { text: slice, from: start, to: start + utf8Length(slice), total: all.length };
};

const SHORT = 280;
const LINE = 1024;

const short = (text: string, max = SHORT) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** What a call's row shows may take this much of its item's budget. */
const SHOWS_BYTES = ENGINE_WIRE_BUDGETS.itemBytes / 2;
/** What a row can do without, first to last: the long input, a driver's own item, the output. */
const SHOWS_SPARED = ["input", "item", "result", "rawOutput", "files", "command"] as const;

/** What a call's row shows within its share of the budget, its heaviest facts left out first. */
const fitShows = (shows: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  let fitted: Record<string, unknown> = { ...shows };
  for (const key of SHOWS_SPARED) {
    if (bytesOf(fitted) <= SHOWS_BYTES) break;
    const { [key]: _spared, ...rest } = fitted;
    fitted = rest;
  }
  return fitted;
};

/** An item within its budget: its words cut, the cut part named with its whole length. */
export const fitItem = (item: Item): Item => {
  switch (item.kind) {
    case "person":
    case "note": {
      const total = utf8Length(item.text);
      if (total <= ENGINE_WIRE_BUDGETS.itemTextBytes) return item;
      return {
        ...item,
        text: cutUtf8(item.text, ENGINE_WIRE_BUDGETS.itemTextBytes),
        cut: { part: "text", total },
      };
    }
    case "thought":
      return item.preview.length <= SHORT ? item : { ...item, preview: short(item.preview) };
    case "call": {
      const fitted = {
        ...item,
        step: short(item.step, 64),
        tool: {
          name: short(item.tool.name, SHORT),
          ...(item.tool.server === undefined ? {} : { server: short(item.tool.server, SHORT) }),
        },
        words: item.words === null ? null : cutUtf8(item.words, LINE),
        ...(item.input === undefined ? {} : { input: cutUtf8(item.input, LINE) }),
        ...(item.shows === undefined ? {} : { shows: fitShows(item.shows) }),
      };
      const resultText = item.result?.resultText;
      if (resultText === undefined) return fitted;
      const total = utf8Length(resultText);
      if (total <= ENGINE_WIRE_BUDGETS.itemTextBytes) return fitted;
      // A result is a document its card decodes whole: never half of it, the whole on demand.
      const { resultText: _cut, ...result } = item.result!;
      return { ...fitted, result, cut: { part: "result", total } };
    }
    case "work":
      return { ...item, title: item.title === null ? null : short(item.title) };
    case "context":
      return { ...item, notes: item.notes.slice(0, 16).map((note) => cutUtf8(note, LINE)) };
    case "marker":
      return {
        ...item,
        marker: {
          ...item.marker,
          ...(item.marker.reason === undefined
            ? {}
            : { reason: cutUtf8(item.marker.reason, LINE) }),
        },
      };
    case "unknown":
      return { ...item, summary: item.summary === null ? null : short(item.summary) };
    default:
      return item;
  }
};

const cutEnd = (end: RunRecord["end"]): RunRecord["end"] => {
  switch (end?.kind) {
    case "failed":
      return { ...end, reason: cutUtf8(end.reason, LINE) };
    case "crashed":
      return { ...end, reason: cutUtf8(end.reason, LINE) };
    case "cut-by-restart":
      return {
        ...end,
        ...(end.words === undefined ? {} : { words: cutUtf8(end.words, LINE) }),
        ...(end.notContinued === undefined
          ? {}
          : { notContinued: cutUtf8(end.notContinued, LINE) }),
      };
    default:
      return end;
  }
};

/** A run within its budget: the words of its end cut; its counts beyond the budget dropped. */
export const fitRun = (run: RunRecord): RunRecord => {
  const fitted = { ...run, end: cutEnd(run.end) };
  if (bytesOf(fitted) <= ENGINE_WIRE_BUDGETS.runBytes) return fitted;
  const calls = Object.entries(fitted.summary.calls)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 16);
  return { ...fitted, summary: { ...fitted.summary, calls: Object.fromEntries(calls) } };
};

/** A request within its budget: what an approval shows cut to it. */
export const fitRequest = (request: Request): Request => {
  if (request.ask.kind !== "approval") return request;
  return {
    ...request,
    ask: { ...request.ask, detail: cutUtf8(request.ask.detail, ENGINE_WIRE_BUDGETS.itemBytes) },
  };
};

export interface Records {
  readonly runs: ReadonlyArray<RunRecord>;
  readonly items: ReadonlyArray<Item>;
  readonly requests: ReadonlyArray<Request>;
}

export const fitRecords = (records: Records): Records => ({
  runs: records.runs.map(fitRun),
  items: records.items.map(fitItem),
  requests: records.requests.map(fitRequest),
});

type Changes = Extract<EngineConversationFrame, { readonly type: "changes" }>;

/**
 * The changes in `(from, to]` as frames within the budget: one when they fit, else parts that
 * share `from`, all but the last saying `to = from`, so a cursor moves only with the last part.
 * Runs go first, then requests, then items: a part never names a run a later part brings.
 */
export const changesFrames = (
  base: Omit<Changes, "type" | "runs" | "items" | "requests">,
  records: Records,
  budget: number = ENGINE_WIRE_BUDGETS.changesBytes,
): ReadonlyArray<Changes> => {
  const whole: Changes = { type: "changes", ...base, ...fitRecords(records) };
  if (bytesOf(whole) <= budget) return [whole];
  const fitted = fitRecords(records);
  const entries = [
    ...fitted.runs.map((record) => ({ key: "runs" as const, record })),
    ...fitted.requests.map((record) => ({ key: "requests" as const, record })),
    ...fitted.items.map((record) => ({ key: "items" as const, record })),
  ];
  const parts: Array<Changes> = [];
  let part = {
    runs: [] as Array<RunRecord>,
    items: [] as Array<Item>,
    requests: [] as Array<Request>,
  };
  let size = bytesOf({ type: "changes", ...base, runs: [], items: [], requests: [] });
  const empty = size;
  const flush = () => {
    parts.push({ type: "changes", ...base, to: base.from, ...part });
    part = { runs: [], items: [], requests: [] };
    size = empty;
  };
  for (const entry of entries) {
    const cost = bytesOf(entry.record) + 1;
    if (size + cost > budget && size > empty) flush();
    (part[entry.key] as Array<unknown>).push(entry.record);
    size += cost;
  }
  flush();
  const last = parts.at(-1)!;
  parts[parts.length - 1] = { ...last, to: base.to };
  // Only the first part carries the header.
  return parts.map((frame, index) => {
    if (index === 0 || frame.header === undefined) return frame;
    const { header: _header, ...rest } = frame;
    return rest;
  });
};

type Live = Extract<EngineConversationFrame, { readonly type: "live.open" | "live.append" }>;

/**
 * An item's streamed text as live frames within the budget: the text so far opens the stream
 * (`live.open`, replacing what a subscriber held), the rest follows as appends at their offsets.
 */
export const liveFrames = (
  itemId: ItemId,
  stream: string,
  text: string,
  options: { readonly open: boolean; readonly offset?: number },
  budget: number = ENGINE_WIRE_BUDGETS.liveFrameBytes,
): ReadonlyArray<Live> => {
  const frames: Array<Live> = [];
  let rest = text;
  let offset = options.offset ?? 0;
  let first = true;
  do {
    const chunk = cutUtf8(rest, budget) || rest.slice(0, 1);
    frames.push(
      first && options.open
        ? { type: "live.open", itemId, stream, text: chunk }
        : { type: "live.append", itemId, stream, offset, text: chunk },
    );
    offset += chunk.length;
    rest = rest.slice(chunk.length);
    first = false;
  } while (rest.length > 0);
  return frames;
};
