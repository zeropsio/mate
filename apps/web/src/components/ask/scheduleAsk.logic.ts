/**
 * A schedule a Mate proposes in its answer, as a `schedule-ask` fence: recurring work its
 * project's automated Mates get as a task each time it is due ("every night: update the
 * dependencies and run the tests"). The card reads it as HQ's schedule would hold it: a name, the
 * brief each task carries, and when it repeats. Its press makes that schedule through the
 * Automation section's own write (`schedule-make`), and the card reads the result back from the
 * project's schedules HQ lists, never from the press.
 */
import type { HqScheduleRequest, HqScheduleRule, HqScheduleView } from "@t3tools/shared/hqIntake";

import type { ChatMessage } from "~/types";
import { askKeyOf } from "./ask.logic";

/** HQ's caps on a schedule (`mate-hq spec/protocol.md` § Automation and issue intake). */
const LONGEST_NAME = 80;
const LONGEST_BRIEF = 16_000;
const LONGEST_LINE = 240;
const LONGEST_ZONE = 64;

/** A weekday as a fence names it, as HQ counts it: 0 Sunday … 6 Saturday. */
const DAYS: Readonly<Record<string, number>> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const EVERY = new Set<string>(["day", "weekday", "week"]);
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/u;
/** An IANA zone's shape ("Europe/Prague", "UTC", "America/Argentina/Buenos_Aires"); HQ checks it. */
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u;

export interface ScheduleAsk {
  /** The ask's name in its conversation: the same fence is the same ask. */
  readonly key: string;
  /** A verb and its subject: "Update the dependencies every night". */
  readonly title: string;
  readonly why: string | undefined;
  /** The schedule's name in Automation. */
  readonly name: string;
  /** What each task asks of the automated Mate that takes it. */
  readonly brief: string;
  /** When it repeats, but where: the zone is the Mate's, or the person's at the press. */
  readonly rule: Omit<HqScheduleRule, "timeZone">;
  readonly timeZone: string | undefined;
}

function text(value: unknown, longest: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > longest ? undefined : trimmed;
}

/** One line of words: its breaks folded into spaces. */
const line = (value: unknown, longest: number): string | undefined =>
  text(typeof value === "string" ? value.replace(/\s+/gu, " ") : value, longest);

function dayOf(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : undefined;
  return typeof value === "string" ? DAYS[value.trim().toLowerCase()] : undefined;
}

/** "3:00" → "03:00": the clock HQ takes, 24-hour. */
function clockOf(value: unknown): string | undefined {
  const match = typeof value === "string" ? CLOCK.exec(value.trim()) : null;
  return match === null ? undefined : `${match[1]!.padStart(2, "0")}:${match[2]!}`;
}

/** The schedule a `schedule-ask` fence proposes, or `null` for words that propose none. */
export function parseScheduleAsk(source: string): ScheduleAsk | null {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const title = line(fields.title, LONGEST_LINE);
  const name = line(fields.name, LONGEST_NAME);
  const brief = text(fields.brief, LONGEST_BRIEF);
  const every = typeof fields.every === "string" ? fields.every.trim().toLowerCase() : "";
  const at = clockOf(fields.at);
  if (title === undefined || name === undefined || brief === undefined || at === undefined)
    return null;
  if (!EVERY.has(every)) return null;
  const day = every === "week" ? dayOf(fields.day) : undefined;
  if (every === "week" && day === undefined) return null;
  const zone = line(fields.timeZone, LONGEST_ZONE);
  if (zone !== undefined && !ZONE.test(zone)) return null;
  return {
    key: askKeyOf(source.trim()),
    title,
    why: text(fields.why, LONGEST_BRIEF),
    name,
    brief,
    rule: {
      every: every as HqScheduleRule["every"],
      ...(day === undefined ? {} : { day }),
      at,
    },
    timeZone: zone,
  };
}

/** The schedule as HQ takes it: in the Mate's zone, else the zone of the person who presses. */
export function scheduleAskRequest(ask: ScheduleAsk, localZone: string): HqScheduleRequest {
  return {
    name: ask.name,
    brief: ask.brief,
    rule: { ...ask.rule, timeZone: ask.timeZone ?? localZone },
  };
}

/** The schedule HQ lists for it: the one by its name, the person's own edit of the brief kept. */
export function scheduleAskMade(
  ask: Pick<ScheduleAsk, "name">,
  schedules: ReadonlyArray<HqScheduleView>,
): HqScheduleView | undefined {
  const name = ask.name.toLowerCase();
  return schedules.find((schedule) => schedule.name.trim().toLowerCase() === name);
}

/** What the Mate is told of a Not now: the schedule it proposed, by its name. */
export function scheduleAskNotNowWords(ask: Pick<ScheduleAsk, "name">): string {
  return `Not now: no schedule for “${ask.name}”.`;
}

const FENCE = /```schedule-ask[^\n]*\n([\s\S]*?)```/gu;
const asked = new WeakMap<ChatMessage, ReadonlyArray<ScheduleAsk>>();

/** The schedule asks a Mate's message proposes. */
function asksIn(message: ChatMessage): ReadonlyArray<ScheduleAsk> {
  let asks = asked.get(message);
  if (asks === undefined) {
    asks = [...message.text.matchAll(FENCE)].flatMap((match) => {
      const ask = parseScheduleAsk(match[1] ?? "");
      return ask === null ? [] : [ask];
    });
    asked.set(message, asks);
  }
  return asks;
}

/**
 * The asks the person said Not now to: a message of theirs after the ask that opens with the words
 * the card sends (`scheduleAskNotNowWords`). Writing about anything else keeps an ask open.
 */
export function scheduleAsksSetAside(messages: ReadonlyArray<ChatMessage>): ReadonlySet<string> {
  const setAside = new Set<string>();
  const open = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const ask of asksIn(message)) open.set(scheduleAskNotNowWords(ask), ask.key);
      continue;
    }
    if (message.role !== "user" || open.size === 0) continue;
    const key = open.get(message.text.trim().split("\n", 1)[0] ?? "");
    if (key !== undefined) setAside.add(key);
  }
  return setAside;
}
