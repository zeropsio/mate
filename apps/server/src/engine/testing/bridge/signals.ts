/**
 * Test helpers for the bridge: a one-line reading of each signal, so a test
 * pins the stream as sentences, and the integrity checks every stream must
 * pass whatever the driver.
 */
import type { DriverSignal, TurnOutcome } from "../../bridge/spi3.ts";

const outcomeLine = (outcome: TurnOutcome): string => {
  switch (outcome.kind) {
    case "completed":
      return outcome.reason === undefined ? "completed" : `completed (${outcome.reason})`;
    case "failed":
      return `failed: ${outcome.class}`;
    case "usage-limited":
      return `usage-limited until ${outcome.resetsAt}`;
    case "cut":
      return `cut: ${outcome.cause}`;
    default:
      return outcome.kind;
  }
};

/** One line per signal; appends are left out (see `textOf`). */
export function signalLine(signal: DriverSignal): string | undefined {
  switch (signal.type) {
    case "session.opened":
      return `session ${signal.session} opened${signal.resumed === true ? ", resumed" : ""}${signal.implicit ? ", on its own" : ""}`;
    case "session.cursor":
      return `session ${signal.session} cursor`;
    case "session.closed":
      return `session ${signal.session} closed: ${signal.cause}`;
    case "send.accepted":
      return `${signal.turn} accepted: ${signal.as}${signal.into === undefined ? "" : ` into ${signal.into}`}`;
    case "send.refused":
      return `${signal.turn} refused, undelivered: ${String(signal.undelivered)}`;
    case "turn.opened":
      return `${signal.turn} opened by ${signal.origin}`;
    case "turn.ended":
      return `${signal.turn} ended ${outcomeLine(signal.outcome)} — ${signal.source}`;
    case "item.upsert": {
      const body = signal.body.kind === "tool" ? `tool ${signal.body.toolKind}` : signal.body.kind;
      return [
        `${signal.item} ${body} ${signal.status}`,
        signal.afterEnd ? "after end" : undefined,
        signal.helper === undefined ? undefined : `for ${signal.helper}`,
        signal.response === undefined ? undefined : `in ${signal.response}`,
      ]
        .filter((part) => part !== undefined)
        .join(", ");
    }
    case "item.append":
      return undefined;
    case "work.upsert":
      return `${signal.work} ${signal.kind} ${signal.status}, from ${signal.origin}`;
    case "request.opened":
      return `${signal.request} asks: ${signal.ask.kind}${signal.turn === undefined ? "" : ` in ${signal.turn}`}`;
    case "request.closed":
      return `${signal.request} closed: ${signal.how}`;
    case "usage.context":
      return "context usage";
    case "usage.limit":
      return `usage limit ${signal.effect}${signal.turn === undefined ? "" : ` ${signal.turn}`} until ${signal.resetsAt}`;
    case "context.compacted":
      return `compacted, automatic: ${String(signal.automatic)}`;
    case "plan.updated":
      return `${signal.turn} plan`;
    case "notice":
      return `notice ${signal.level}${signal.class === undefined ? "" : ` ${signal.class}`}`;
  }
}

/** The stream as lines, a run of identical lines folded into one with its count. */
export function signalLines(signals: ReadonlyArray<DriverSignal>): ReadonlyArray<string> {
  const lines: Array<string> = [];
  let last: string | undefined;
  let count = 0;
  const flush = () => {
    if (last !== undefined) lines.push(count > 1 ? `${last} ×${count}` : last);
  };
  for (const signal of signals) {
    const line = signalLine(signal);
    if (line === undefined) continue;
    if (line === last) {
      count += 1;
      continue;
    }
    flush();
    last = line;
    count = 1;
  }
  flush();
  return lines;
}

/** An item's text as its appends build it, per stream. */
export function textOf(
  signals: ReadonlyArray<DriverSignal>,
  item: string,
  stream = "text",
): string {
  return signals
    .filter(
      (signal): signal is Extract<DriverSignal, { type: "item.append" }> =>
        signal.type === "item.append" && signal.item === item && signal.stream === stream,
    )
    .map((signal) => signal.text)
    .join("");
}

/**
 * What holds for every stream, whatever the driver; returns the first breach in words.
 * - seq strictly increases;
 * - every turn opens at most once and ends at most once, and never ends before it opened;
 * - nothing about a turn arrives after its end unless it says so (`afterEnd`);
 * - every append starts where the item's text so far ends.
 */
export function integrityBreach(signals: ReadonlyArray<DriverSignal>): string | undefined {
  let seq = 0;
  const opened = new Set<string>();
  const ended = new Set<string>();
  const offsets = new Map<string, number>();
  for (const signal of signals) {
    if (signal.seq <= seq) return `seq ${signal.seq} after ${seq}`;
    seq = signal.seq;
    switch (signal.type) {
      case "turn.opened":
        if (opened.has(signal.turn)) return `${signal.turn} opened twice`;
        opened.add(signal.turn);
        break;
      case "turn.ended":
        if (!opened.has(signal.turn)) return `${signal.turn} ended without opening`;
        if (ended.has(signal.turn)) return `${signal.turn} ended twice`;
        ended.add(signal.turn);
        break;
      case "item.upsert":
        if (ended.has(signal.turn) && !signal.afterEnd)
          return `${signal.item} arrived after ${signal.turn} ended without saying so`;
        break;
      case "item.append": {
        const key = `${signal.item}/${signal.stream}`;
        const at = offsets.get(key) ?? 0;
        if (signal.at !== at) return `${key} appended at ${signal.at}, its text ends at ${at}`;
        offsets.set(key, at + signal.text.length);
        break;
      }
    }
  }
  return undefined;
}
