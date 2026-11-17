import type { WorkLogEntry } from "../../session-logic";

/**
 * Every driver's name for a tool, in Claude's: OpenCode's own tools and an
 * ACP agent's kinds (`read`, `edit`, `search`, `execute`, `fetch`, ...).
 * Claude's own names read the same, lowercased.
 */
const TOOL_NAMES: Readonly<Record<string, string>> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  multiedit: "Edit",
  patch: "Edit",
  apply_patch: "Edit",
  delete: "Edit",
  move: "Edit",
  bash: "Bash",
  execute: "Bash",
  grep: "Grep",
  search: "Grep",
  codesearch: "Grep",
  glob: "Glob",
  list: "Glob",
  ls: "Glob",
  webfetch: "WebFetch",
  fetch: "WebFetch",
  websearch: "WebSearch",
  todowrite: "TodoWrite",
  todoread: "TodoWrite",
  task: "Task",
  skill: "Skill",
  question: "AskUserQuestion",
};

/** An ACP agent's kinds that name no tool: the call's title says what it is. */
const UNNAMED_KINDS: ReadonlySet<string> = new Set(["other", "think", "switch_mode"]);

/**
 * The tool a call ran, in Claude's words: where its detail names it — a call
 * the runtime knows only as a "Tool call" carries its name and arguments as
 * "AskUserQuestion: {…}", the name is for people, the arguments never are —
 * else the name the server gives every driver's call (`toolName`): an MCP
 * tool by its own name, its server dropped; OpenCode's tools and an ACP
 * agent's kinds as Claude's.
 */
export function namedToolCall(
  entry: Pick<WorkLogEntry, "itemType" | "label" | "detail" | "toolName">,
): string | null {
  if (
    entry.itemType === "dynamic_tool_call" ||
    entry.itemType === "collab_agent_tool_call" ||
    entry.label === "Tool call"
  ) {
    const match = /^([A-Za-z][\w-]*):\s*[{[]/.exec(entry.detail ?? "");
    if (match?.[1] !== undefined) return match[1];
  }
  const name = entry.toolName?.trim();
  if (name === undefined || name.length === 0 || UNNAMED_KINDS.has(name)) return null;
  if (name.startsWith("mcp__")) return name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
  return TOOL_NAMES[name.toLowerCase()] ?? name;
}

/** The file a file tool call names in its arguments, by its name alone. */
function calledFileName(detail: string | undefined): string | null {
  const path = /"file_path"\s*:\s*"([^"]+)"/.exec(detail ?? "")?.[1];
  return path === undefined ? null : (path.split("/").findLast(Boolean) ?? null);
}

const FILE_TOOL_VERB: Readonly<Record<string, string>> = {
  Read: "Reading",
  Edit: "Editing",
  MultiEdit: "Editing",
  Write: "Writing",
  NotebookEdit: "Editing",
};

const TOOL_CALL_WORDS: Readonly<Record<string, string>> = {
  AskUserQuestion: "Waiting for your answer",
  Read: "Reading a file",
  Edit: "Editing a file",
  MultiEdit: "Editing a file",
  Write: "Writing a file",
  NotebookEdit: "Editing a notebook",
  Grep: "Searching the code",
  Glob: "Looking for files",
  Bash: "Running a command",
  WebFetch: "Reading a web page",
  WebSearch: "Searching the web",
  Task: "Starting a helper",
  Agent: "Starting a helper",
  Skill: "Using a skill",
  ToolSearch: "Looking up a tool",
  TodoWrite: "Updating its list",
  ExitPlanMode: "Finishing the plan",
  // The wakes Claude's agent sets for itself; no other driver has such a tool.
  CronCreate: "Scheduling a wake",
  CronDelete: "Cancelling a wake",
  CronList: "Checking its wakes",
};

/** The clock a wake's time is read on: now, and the person's time zone (theirs when not given). */
interface WakeClock {
  readonly now?: number;
  readonly timeZone?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a wake's cron fires, on the person's clock: "16:35" today, "16:35 on 12 Oct" another day.
 * Claude's container keeps UTC; its one-off names minute, hour, day and month ("35 16 11 10 *"),
 * a daily one minute and hour ("0 9 * * *"). Anything else names no one time.
 */
function wakeTime(detail: string | undefined, clock: WakeClock = {}): string | null {
  const cron = /"cron"\s*:\s*"([^"]+)"/
    .exec(detail ?? "")?.[1]
    ?.trim()
    .split(/\s+/);
  if (cron?.length !== 5 || cron[4] !== "*") return null;
  const [minute, hour, day, month] = cron.map(Number);
  const daily = cron[2] === "*" && cron[3] === "*";
  const numbers = daily ? [minute, hour] : [minute, hour, day, month];
  if (!numbers.every((value) => Number.isInteger(value))) return null;
  if (
    hour! > 23 ||
    minute! > 59 ||
    (!daily && (day! < 1 || day! > 31 || month! < 1 || month! > 12))
  )
    return null;
  const now = clock.now ?? Date.now();
  const today = new Date(now);
  let at = daily
    ? Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, minute)
    : Date.UTC(today.getUTCFullYear(), month! - 1, day, hour, minute);
  // A date long gone this year is next year's.
  if (!daily && at < now - DAY_MS)
    at = Date.UTC(today.getUTCFullYear() + 1, month! - 1, day, hour, minute);
  const zone = clock.timeZone === undefined ? {} : { timeZone: clock.timeZone };
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...zone,
  }).format(at);
  if (daily) return time;
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...zone });
  return date.format(at) === date.format(now) ? time : `${time} on ${date.format(at)}`;
}

/**
 * What a named tool call is doing, in words: "Reading package.json",
 * "Reading a web page", "Using some new tool" — a file by its name, never
 * the rest of the arguments.
 */
export function toolCallWords(name: string, detail?: string, clock?: WakeClock): string {
  const verb = FILE_TOOL_VERB[name];
  const file = verb === undefined ? null : calledFileName(detail);
  if (verb !== undefined && file !== null) return `${verb} ${file}`;
  const known = TOOL_CALL_WORDS[name];
  if (name === "CronCreate") {
    const time = wakeTime(detail, clock);
    if (time !== null) return `${known} for ${time}`;
  }
  if (known !== undefined) return known;
  const words = name
    .replace(/^mcp__[^_]+__/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.length > 0 ? `Using ${words}` : "Using a tool";
}

/** The question tool, however the runtime names its call. */
export function isQuestionToolCall(
  entry: Pick<WorkLogEntry, "itemType" | "label" | "detail" | "toolTitle">,
): boolean {
  return (
    /^AskUserQuestion\b/.test(entry.toolTitle ?? entry.label) ||
    namedToolCall(entry) === "AskUserQuestion"
  );
}

/**
 * The picture a call looked at, by its path: the image its runtime says it
 * viewed, else the file it named, else a detail that is only a path.
 */
export function lookedAt(entry: WorkLogEntry): string | null {
  return (
    entry.viewedImagePath ??
    entry.callInput?.filePath ??
    (entry.detail !== undefined && /^\/\S+$/.test(entry.detail.trim()) ? entry.detail.trim() : null)
  );
}
