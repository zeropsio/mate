/**
 * What the Mate did, a step at a time: each tool call it made as one line of
 * its run's record — in words (the call's own description, else the call said
 * plainly), the exact command after them, how long it took and how it ended.
 * The live panel streams them and an opened log lists them, so a run reads the
 * same live and after (the owner, 2026-09-27: "why isn't the chat showing even
 * the commands it runs? it shows them when it's doing it, but not in the log").
 *
 * Claude Code tracks any command that runs past a few seconds as a task of its
 * own, named by the command's description. Such a task is the command: it lends
 * the step its words and is never a row or a status bar of its own — on one
 * forty-minute run, all 27 "background tasks" were commands the Mate waited on.
 */
import type { WorkLogEntry } from "../../session-logic";
import { lookedAt, namedToolCall, toolCallWords } from "./conversation.logic";
import { jobLost, type LiveJobs } from "./liveJobs.logic";
import { spilledOutputOf, spilledOutputPhrase, type SpilledOutput } from "./spilledOutput.logic";

export type StepKind = "command" | "look" | "read" | "edit" | "search" | "web" | "tool";

export type StepState = "running" | "done" | "failed";

/**
 * A call said plainly, in its parts: what it did and what it did it to — the
 * files, the pattern, the page — so a bubble can set the names apart from
 * the verb ("Read" + `page.tsx`). Past three names only the first two stand,
 * and `more` counts the rest.
 */
export interface StepPhrase {
  readonly verb: string;
  readonly targets: ReadonlyArray<string>;
  readonly more: number;
  /** The targets are names the code knows — files, patterns, addresses — set in mono. */
  readonly code: boolean;
}

export interface WorkStep {
  /** Its first call's entry id: stable from the call's first sight. */
  readonly key: string;
  readonly kind: StepKind;
  /**
   * The step in words: the call's own description, or the call said plainly
   * ("Read chapters.tsx"); null for a command that said nothing of itself —
   * its command is its words.
   */
  readonly words: string | null;
  /** Its words in parts, where the call was said plainly; null where it described itself. */
  readonly phrase: StepPhrase | null;
  /** The command it ran, as shown: its `cd … &&` preamble dropped, its first line. */
  readonly code: string | null;
  /** The command whole, every line of it, its preamble dropped. */
  readonly script: string | null;
  /** How many lines the command is — a script written into it is more than its first. */
  readonly codeLines: number;
  readonly state: StepState;
  readonly startedAt: string;
  /** When it ended; null while it runs. */
  readonly endedAt: string | null;
  /** The calls it stands for: one, or a run of looks at pictures. */
  readonly entries: ReadonlyArray<WorkLogEntry>;
  /** The pictures it looked at, by path. */
  readonly images: ReadonlyArray<string>;
  /**
   * A call that never returned (`liveBatch`): "stale" once a newer batch
   * started while it still ran — it stands in the record with no time — and
   * "closed" once the run settled without it: "No result".
   */
  readonly noResult?: "stale" | "closed";
  /** A command sent to the background: the job its call started, as it stands now. */
  readonly background?: BackgroundJob;
}

/**
 * A command the Mate sent to the background: its call returned while the
 * task it started ran on, and the task reports in later — after the turn,
 * often. The job stands on its command's own line, so it is told once.
 */
export interface BackgroundJob {
  /** The command entry's id. */
  readonly key: string;
  /** What it was asked to do: the task's words, else the command's own. */
  readonly title: string;
  /** "lost": its session is gone and it never reported — it never will. */
  readonly state: "running" | "done" | "failed" | "stopped" | "lost";
  readonly startedAt: string;
  /** When its task ended; null while it runs. */
  readonly endedAt: string | null;
  /** What it reported past its own title — "Exit code 3" — or null. */
  readonly report: string | null;
}

/**
 * A command a task tracked: the task's words, where it has its own, and the
 * task (its end is the command's).
 */
export interface TrackedCommand {
  readonly description?: string;
  readonly task: WorkLogEntry;
}

export interface TrackedCommands {
  /** By the command entry's id. */
  readonly byCommand: ReadonlyMap<string, TrackedCommand>;
  /** The tasks that are commands: never a row or a bar of their own. */
  readonly trackers: ReadonlySet<string>;
  /** Each background task's words, by its id: a read of its output names it. */
  readonly jobTitles: ReadonlyMap<string, string>;
  /** Each call whose output was saved to a file, by the file's id: a read of it names the call. */
  readonly spillTitles?: ReadonlyMap<string, string>;
  /** The jobs the server holds live (`liveJobs.logic`): one it does not, unreported, never will. */
  readonly liveJobs?: LiveJobs | null;
}

export const NO_TRACKED_COMMANDS: TrackedCommands = {
  byCommand: new Map(),
  trackers: new Set(),
  jobTitles: new Map(),
};

/**
 * A shell a runtime runs a command through — `/usr/bin/zsh -lc "…"`,
 * `bash -c '…'`, `sh -c …` — its last flag the one that hands it the command.
 */
const SHELL_CALL = /^(?:\S*\/)?(?:ba|z|da|k)?sh((?:\s+-[A-Za-z]+)+)\s+(\S[\s\S]*)$/u;

/**
 * The first word of what a shell was handed, as the shell reads it: quoted,
 * its quotes gone — `'…'` literal, `"…"` with its `\"` undone (how the
 * runtime writes a command's arguments out), a `\` escaping what follows —
 * up to the first space outside them, and where it ended. Null for a word
 * that never closes.
 */
function firstShellWord(text: string): { readonly word: string; readonly end: number } | null {
  let word = "";
  let index = 0;
  while (index < text.length && !/\s/u.test(text[index]!)) {
    const character = text[index]!;
    if (character === "'") {
      const close = text.indexOf("'", index + 1);
      if (close < 0) return null;
      word += text.slice(index + 1, close);
      index = close + 1;
    } else if (character === '"') {
      let cursor = index + 1;
      let quoted = "";
      while (cursor < text.length && text[cursor] !== '"') {
        if (text[cursor] === "\\" && text[cursor + 1] === '"') {
          quoted += '"';
          cursor += 2;
        } else {
          quoted += text[cursor];
          cursor += 1;
        }
      }
      if (cursor >= text.length) return null;
      word += quoted;
      index = cursor + 1;
    } else if (character === "\\" && index + 1 < text.length) {
      word += text[index + 1];
      index += 2;
    } else {
      word += character;
      index += 1;
    }
  }
  return { word, end: index };
}

/**
 * A command as the shell it ran through got it: Codex runs every command as
 * `/usr/bin/zsh -lc "…"` and says nothing of it, so the command a person
 * reads is the one inside, unquoted. Only when that is the shell's whole
 * argument: whatever follows it — a pipe, a fallback, a second command — is
 * the command too, and the call stands as it is.
 */
export function unwrapShell(command: string): string {
  const match = SHELL_CALL.exec(command.trim());
  if (match === null) return command;
  const lastFlag = match[1]!.trim().split(/\s+/u).at(-1) ?? "";
  if (!lastFlag.includes("c")) return command;
  const handed = firstShellWord(match[2]!);
  if (handed === null || handed.word.trim().length === 0) return command;
  return match[2]!.slice(handed.end).trim().length === 0 ? handed.word : command;
}

const STATEMENT_PREAMBLE =
  /^\s*(?:cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)|(?:export\s+)?[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s;&|]*))\s*(?:&&|;)\s*/;

/**
 * A command as a person reads it: the `cd <dir> &&` and `NAME=value;` it
 * opens with dropped, its first line, its whitespace folded — never nothing.
 */
export function commandShown(command: string): string {
  let rest = withoutScratch(command);
  for (let match = STATEMENT_PREAMBLE.exec(rest); match; match = STATEMENT_PREAMBLE.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  const line = (value: string) => (value.split("\n")[0] ?? "").replace(/\s+/g, " ").trim();
  const shown = line(rest);
  return shown.length > 0 ? shown : line(command);
}

/** A command whole, as a bubble draws it: its preamble dropped, every line kept. */
export function commandWhole(command: string): string {
  let rest = withoutScratch(command);
  for (let match = STATEMENT_PREAMBLE.exec(rest); match; match = STATEMENT_PREAMBLE.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  const whole = rest.trimEnd();
  return whole.trim().length > 0 ? whole.trim() : withoutScratch(command).trim();
}

/**
 * Claude Code's own folder for a session — `/tmp/claude-<uid>/<project>/<session id>/`,
 * where a background command's output lands — is no place the person knows:
 * a command reading it says `…/tasks/b7k.output` (run 9: the live card read
 * "cat /tmp/claude-2023/-var-www/3c6ba9e5-…").
 */
const SCRATCH_FOLDER =
  /(?:\/private)?\/tmp\/claude-\d+\/[^/\s'"]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//gu;

function withoutScratch(command: string): string {
  return command.replace(SCRATCH_FOLDER, "…/");
}

function isTask(entry: WorkLogEntry): boolean {
  return entry.sourceActivityKind?.startsWith("task.") === true && entry.agentSpawn === undefined;
}

function isCommand(entry: WorkLogEntry): boolean {
  if (isTask(entry)) return false;
  return (
    entry.itemType === "command_execution" ||
    entry.requestKind === "command" ||
    namedToolCall(entry) === "Bash" ||
    (entry.command !== undefined && entry.command.trim().length > 0)
  );
}

const endOf = (entry: WorkLogEntry) => Date.parse(entry.updatedAt ?? entry.createdAt);
const startOf = (entry: WorkLogEntry) => Date.parse(entry.startedAt ?? entry.createdAt);

/** A task and a command that ended together, or the task ended while the command ran. */
const TRACK_TOLERANCE_MS = 3_000;

const folded = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * A task named by the command it tracks — Grok names one by the command's
 * first line, cut; Antigravity by the command whole: those are no words.
 */
function namesItself(command: WorkLogEntry, description: string): boolean {
  const said = folded(description);
  const raw = command.rawCommand ?? command.command ?? "";
  return [raw, unwrapShell(raw)].some((text) => folded(text).startsWith(said));
}

/**
 * Which tasks track which commands: by the call the task names, else — for a
 * task that names none — the command it ended with.
 */
export function trackCommands(entries: ReadonlyArray<WorkLogEntry>): TrackedCommands {
  const commands = entries.filter(isCommand);
  const byCallId = new Map(
    commands.flatMap((command) =>
      command.toolCallId === undefined ? [] : [[command.toolCallId, command] as const],
    ),
  );
  const byCommand = new Map<string, TrackedCommand>();
  const trackers = new Set<string>();
  const jobTitles = new Map<string, string>();
  // A job still running has no task in the log yet: its command names it.
  for (const command of commands) {
    const words = command.callInput?.description?.trim();
    if (command.sentToBackground !== undefined && words)
      jobTitles.set(command.sentToBackground, words);
  }
  const spillTitles = new Map(
    entries.flatMap((call) => {
      const words = spillTitleOf(call);
      return call.spilledTo === undefined || words === undefined
        ? []
        : [[call.spilledTo, words] as const];
    }),
  );
  const endedNear = commandsEndingNear(commands);
  // A command sent to the background, by the words its call gave it: a task that names no call but
  // says those words is that command's job (an engine Mate's job names no call; by timing alone
  // its end was the failed `ls` that ended just before the job began, and the job read running on).
  const sentByWords = new Map<string, WorkLogEntry>();
  for (const command of commands) {
    const words = command.callInput?.description?.trim();
    if (command.sentToBackground !== undefined && words && !sentByWords.has(words))
      sentByWords.set(words, command);
  }
  for (const task of entries) {
    if (!isTask(task)) continue;
    const words = (task.toolTitle ?? task.label).trim();
    if (task.taskId !== undefined && words.length > 0) jobTitles.set(task.taskId, words);
    const named = sentByWords.get(words);
    const command =
      task.taskToolUseId !== undefined
        ? byCallId.get(task.taskToolUseId)
        : task.taskType === undefined || task.taskType === "local_bash"
          ? named !== undefined && !byCommand.has(named.id)
            ? named
            : endedNear(Date.parse(task.createdAt), (candidate) => !byCommand.has(candidate.id))
          : undefined;
    if (command === undefined) continue;
    trackers.add(task.id);
    const description = (task.toolTitle ?? task.label).trim();
    byCommand.set(
      command.id,
      description.length > 0 && !namesItself(command, description)
        ? { description, task }
        : { task },
    );
  }
  return { byCommand, trackers, jobTitles, spillTitles };
}

/**
 * The first command, in the log's order, that started by `atMs` and ended
 * within `TRACK_TOLERANCE_MS` of it, of those `free` lets through. Read
 * against the commands' ends in order, so a conversation of many tasks and
 * many commands is not every task against every command.
 */
function commandsEndingNear(
  commands: ReadonlyArray<WorkLogEntry>,
): (atMs: number, free: (command: WorkLogEntry) => boolean) => WorkLogEntry | undefined {
  const starts = commands.map(startOf);
  const ends = commands.map(endOf);
  const byEnd = commands
    .map((_, index) => index)
    .filter((index) => Number.isFinite(ends[index]!))
    .toSorted((left, right) => ends[left]! - ends[right]!);
  return (atMs, free) => {
    if (!Number.isFinite(atMs)) return undefined;
    let low = 0;
    let high = byEnd.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (ends[byEnd[middle]!]! < atMs - TRACK_TOLERANCE_MS) low = middle + 1;
      else high = middle;
    }
    let first: number | undefined;
    for (let at = low; at < byEnd.length; at += 1) {
      const index = byEnd[at]!;
      if (ends[index]! > atMs + TRACK_TOLERANCE_MS) break;
      if (
        (first === undefined || index < first) &&
        starts[index]! <= atMs &&
        free(commands[index]!)
      )
        first = index;
    }
    return first === undefined ? undefined : commands[first];
  };
}

/** The words a call whose output was saved to a file goes by: its own, else its command. */
function spillTitleOf(call: WorkLogEntry): string | undefined {
  const described = call.callInput?.description?.trim();
  if (described) return described;
  const command = call.rawCommand ?? call.command;
  return command ? commandShown(unwrapShell(command)) : undefined;
}

/**
 * A read of output Claude Code saved to a file, said by what made it (a probe
 * read "Read be98ni9xv.output" on the live card, run 11 "Reading
 * br89ocvyk.txt"): null for any other read.
 */
function spilledReadPhrase(
  entry: WorkLogEntry,
  tracked: TrackedCommands,
  running: boolean,
): StepPhrase | null {
  const spilled = spilledReadOf(entry);
  if (spilled === null) return null;
  const { verb, target } = spilledOutputPhrase(spilled, spilledTitle(spilled, tracked), running);
  return { verb, targets: target === null ? [] : [target], more: 0, code: false };
}

const spilledReadByEntry = new WeakMap<WorkLogEntry, SpilledOutput | null>();

/** The saved output a call reads, if it reads one — read once per entry, which never changes. */
function spilledReadOf(entry: WorkLogEntry): SpilledOutput | null {
  const known = spilledReadByEntry.get(entry);
  if (known !== undefined) return known;
  const file = entry.callInput?.filePath ?? detailFile(entry.detail) ?? null;
  const spilled = file === null ? null : spilledOutputOf(file);
  spilledReadByEntry.set(entry, spilled);
  return spilled;
}

function spilledTitle(spilled: SpilledOutput, tracked: TrackedCommands): string | undefined {
  const titles = spilled.kind === "job" ? tracked.jobTitles : tracked.spillTitles;
  return titles?.get(spilled.id);
}

/**
 * Everything `stepOf` reads of the thread's tracked commands for one call,
 * beyond the call itself: a step drawn again with the same reads draws the
 * same (`deriveMessagesTimelineRows` keeps a settled run's lines by them).
 */
export function trackedReadsOf(
  entry: WorkLogEntry,
  tracked: TrackedCommands,
): readonly [
  task: WorkLogEntry | undefined,
  description: string | undefined,
  tracker: boolean,
  spilledTitle: string | undefined,
] {
  const track = tracked.byCommand.get(entry.id);
  const spilled = spilledReadOf(entry);
  return [
    track?.task,
    track?.description,
    tracked.trackers.has(entry.id),
    spilled === null ? undefined : spilledTitle(spilled, tracked),
  ];
}

/**
 * The job a command sent to the background, or null: a command its task
 * tracked whose call returned while the task ran on — not one that waited on
 * its task to the end (a long command Claude Code tracks).
 */
export function backgroundJobOf(
  command: WorkLogEntry,
  tracked: TrackedCommands,
  /** Its turn still runs: its jobs are live whatever the server has said yet. */
  live = false,
): BackgroundJob | null {
  // Its call's own output says it went to the background (Claude Code's
  // notice), the task that tracks it reaching the log only once it ends.
  const sent = command.sentToBackground !== undefined;
  const track = tracked.byCommand.get(command.id);
  if (track === undefined && !sent) return null;
  if (command.toolLifecycleStatus === "inProgress" && !sent) return null;
  const task = track?.task;
  const ended = task?.sourceActivityKind === "task.completed";
  // Else a task that ended with its call was the command itself.
  if (!sent && task !== undefined && ended && endOf(task) - endOf(command) <= TRACK_TOLERANCE_MS) {
    return null;
  }
  const title = (
    track?.description ??
    command.callInput?.description ??
    task?.toolTitle ??
    task?.label ??
    command.command ??
    "A background job"
  ).trim();
  const failed =
    task !== undefined &&
    ended &&
    (task.tone === "error" ||
      task.toolLifecycleStatus === "failed" ||
      /\bfailed\b/iu.test(task.detail ?? ""));
  return {
    key: command.id,
    title,
    state:
      task === undefined || !ended
        ? jobLost(
            { id: command.sentToBackground ?? task?.taskId, ofLiveTurn: live },
            tracked.liveJobs ?? null,
          )
          ? "lost"
          : "running"
        : task.taskLost === true
          ? "lost"
          : failed
            ? "failed"
            : task.toolLifecycleStatus === "stopped"
              ? "stopped"
              : "done",
    startedAt: command.startedAt ?? command.createdAt,
    endedAt: task !== undefined && ended ? new Date(endOf(task)).toISOString() : null,
    report: task !== undefined && ended ? taskReportWords(taskSaid(task), title) : null,
  };
}

/**
 * What a task said as it ended: its detail, else its label where the work
 * log put Claude Code's own word there (`Background command "…" failed …`).
 */
export function taskSaid(task: WorkLogEntry): string | undefined {
  return task.detail ?? (/^Background command\b/u.test(task.label) ? task.label : undefined);
}

/**
 * What a task reported, past what its line already says: Claude Code says
 * `Background command "Run the soak test" failed with exit code 3`, whose
 * title and verdict the line has — "Exit code 3" is all it adds.
 */
export function taskReportWords(detail: string | undefined, title: string): string | null {
  const whole = (detail ?? "").trim();
  if (whole.length === 0) return null;
  const quoted = /^Background command\s+"[^"]*"\s*/u.exec(whole);
  const rest =
    quoted !== null
      ? whole.slice(quoted[0].length)
      : title.length > 0 && whole.startsWith(title)
        ? whole.slice(title.length).trim()
        : null;
  // A report in words of its own (a helper's, a watch's): all of it.
  if (rest === null) return whole;
  const code = /exit code (\d+)/iu.exec(rest)?.[1];
  if (/^(?:completed|finished|succeeded)\b/iu.test(rest)) {
    return code === undefined || code === "0" ? null : `Exit code ${code}`;
  }
  if (/^(?:was\s+)?(?:stopped|killed)\b/iu.test(rest)) return "Stopped";
  const said = rest.replace(/^failed\b\s*(?:with\s+)?/iu, "").trim();
  return said.length === 0 ? null : said.charAt(0).toUpperCase() + said.slice(1);
}

function basename(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path;
}

/** A file a call names in its arguments, where the runtime wrote them into its detail. */
function detailFile(detail: string | undefined): string | null {
  return /"file_path"\s*:\s*"([^"]+)"/.exec(detail ?? "")?.[1] ?? null;
}

/** The tool a call's detail opens with ("Write: {…}"), whatever the runtime typed the call as. */
function detailToolName(detail: string | undefined): string | null {
  return /^([A-Za-z][\w-]*):\s*[{[]/.exec(detail ?? "")?.[1] ?? null;
}

function detailField(detail: string | undefined, field: string): string | null {
  return new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`).exec(detail ?? "")?.[1] ?? null;
}

function stepKind(entry: WorkLogEntry): StepKind {
  if (isCommand(entry)) return "command";
  if (entry.itemType === "image_view" || entry.viewedImagePath !== undefined) return "look";
  const named = namedToolCall(entry);
  if (
    named === "Read" ||
    entry.requestKind === "file-read" ||
    (entry.itemType === "dynamic_tool_call" && entry.toolTitle === "Read File")
  ) {
    return "read";
  }
  // A search or a read of the web is known by its name before the files a
  // call names: the folder a search looks in is no file it changed.
  if (named === "Grep" || named === "Glob") return "search";
  if (named === "WebFetch" || named === "WebSearch" || entry.itemType === "web_search") {
    return /\bgrep\b/i.test(entry.toolTitle ?? entry.label) ? "search" : "web";
  }
  if (
    named === "Edit" ||
    named === "MultiEdit" ||
    named === "Write" ||
    named === "NotebookEdit" ||
    entry.itemType === "file_change" ||
    entry.requestKind === "file-change" ||
    (entry.changedFiles?.length ?? 0) > 0
  ) {
    return "edit";
  }
  return "tool";
}

function listed(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2 === 1 ? names[2] : `${names.length - 2} more`}`;
}

/** A verb and the names it takes, the first two standing past three, as `listed` says them. */
function phraseOf(verb: string, names: ReadonlyArray<string>, code = true): StepPhrase {
  if (names.length <= 3) return { verb, targets: names, more: 0, code };
  return { verb, targets: names.slice(0, 2), more: names.length - 2, code };
}

/** Zerops tools no card shows, said by what they did. */
const ZEROPS_WORDS: Readonly<Record<string, readonly [running: string, done: string]>> = {
  zerops_workflow: ["Checking the workflow", "Checked the workflow"],
  zerops_knowledge: ["Reading the Zerops guides", "Read the Zerops guides"],
  zerops_discover: ["Looking at the project", "Looked at the project"],
  zerops_logs: ["Reading the logs", "Read the logs"],
  zerops_events: ["Reading the project's events", "Read the project's events"],
};

/** A page as a line names it: its host and its path. */
export function webTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

/** The files a run of edits touched, by name, each once. */
function editedFiles(entries: ReadonlyArray<WorkLogEntry>): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        (entry.changedFiles?.length
          ? entry.changedFiles
          : [entry.callInput?.filePath ?? detailFile(entry.detail)].filter(
              (file): file is string => file !== null && file !== undefined,
            )
        ).map(basename),
      ),
    ),
  ];
}

/** Edits said plainly: "Edited index.ts", "Wrote AGENTS.md", "Edited a.ts and b.ts". */
function editWords(entries: ReadonlyArray<WorkLogEntry>, running: boolean): string {
  const files = editedFiles(entries);
  const wrote = entries.every(
    (entry) => (namedToolCall(entry) ?? detailToolName(entry.detail)) === "Write",
  );
  const what =
    files.length === 0 ? "a file" : files.length > 3 ? `${files.length} files` : listed(files);
  if (wrote) return running ? `Writing ${what}` : `Wrote ${what}`;
  return running ? `Editing ${what}` : `Edited ${what}`;
}

/** Edits in parts: the verb, and each file once — past three, only how many. */
function editPhrase(entries: ReadonlyArray<WorkLogEntry>, running: boolean): StepPhrase {
  const files = editedFiles(entries);
  const wrote = entries.every(
    (entry) => (namedToolCall(entry) ?? detailToolName(entry.detail)) === "Write",
  );
  const verb = wrote ? (running ? "Writing" : "Wrote") : running ? "Editing" : "Edited";
  if (files.length === 0) return { verb: `${verb} a file`, targets: [], more: 0, code: false };
  if (files.length > 3) {
    return { verb: `${verb} ${files.length} files`, targets: [], more: 0, code: false };
  }
  return phraseOf(verb, files);
}

/** A call said plainly, in parts: `plainWords` is this phrase read out. */
function plainPhrase(entry: WorkLogEntry, kind: StepKind, running: boolean): StepPhrase | null {
  const say = (now: string, then: string) => (running ? now : then);
  const input = entry.callInput;
  const alone = (verb: string): StepPhrase => ({ verb, targets: [], more: 0, code: false });
  switch (kind) {
    case "command":
      return null;
    case "look": {
      const path = lookedAt(entry);
      return path === null
        ? alone(say("Looking at a picture", "Looked at a picture"))
        : phraseOf(say("Looking at", "Looked at"), [basename(path)]);
    }
    case "read": {
      const file = input?.filePath ?? detailFile(entry.detail) ?? entry.changedFiles?.[0];
      return file === undefined || file === null
        ? alone(say("Reading a file", "Read a file"))
        : phraseOf(say("Reading", "Read"), [basename(file)]);
    }
    case "edit":
      return editPhrase([entry], running);
    case "search": {
      const named = namedToolCall(entry);
      const pattern = input?.pattern ?? detailField(entry.detail, "pattern");
      if (named === "Glob") {
        return pattern === null
          ? alone(say("Looking for files", "Looked for files"))
          : phraseOf(say("Looking for", "Looked for"), [pattern]);
      }
      return pattern === null
        ? alone(say("Searching the code", "Searched the code"))
        : phraseOf(say("Searching the code for", "Searched the code for"), [pattern]);
    }
    case "web": {
      const url = input?.url ?? detailField(entry.detail, "url");
      if (url !== null) return phraseOf(say("Reading", "Read"), [webTarget(url)]);
      // A fetch before its address arrived reads a page all the same: it never searches.
      if (namedToolCall(entry) === "WebFetch") return alone(say("Reading a page", "Read a page"));
      const query = input?.query ?? detailField(entry.detail, "query");
      return query === null
        ? alone(say("Searching the web", "Searched the web"))
        : phraseOf(say("Searching the web for", "Searched the web for"), [query], false);
    }
    case "tool": {
      const words = plainWords(entry, kind, running);
      return words === null ? null : alone(words);
    }
  }
}

/** A phrase read out: "Read a.ts", "Edited a.ts and b.ts", "Looked at a, b and 3 more". */
export function phraseWords(phrase: StepPhrase): string {
  if (phrase.targets.length === 0) return phrase.verb;
  const names =
    phrase.more > 0
      ? `${phrase.targets.join(", ")} and ${phrase.more} more`
      : listed(phrase.targets);
  return `${phrase.verb} ${names}`;
}

/** A call said plainly, as it runs ("Reading a.ts") or once done ("Read a.ts"). */
function plainWords(entry: WorkLogEntry, kind: StepKind, running: boolean): string | null {
  const say = (now: string, then: string) => (running ? now : then);
  const input = entry.callInput;
  switch (kind) {
    case "command":
      return null;
    case "look": {
      const path = lookedAt(entry);
      return path === null
        ? say("Looking at a picture", "Looked at a picture")
        : say(`Looking at ${basename(path)}`, `Looked at ${basename(path)}`);
    }
    case "read": {
      const file = input?.filePath ?? detailFile(entry.detail) ?? entry.changedFiles?.[0];
      return file === undefined || file === null
        ? say("Reading a file", "Read a file")
        : say(`Reading ${basename(file)}`, `Read ${basename(file)}`);
    }
    case "edit":
      return editWords([entry], running);
    case "search": {
      const named = namedToolCall(entry);
      const pattern = input?.pattern ?? detailField(entry.detail, "pattern");
      if (named === "Glob") {
        return pattern === null
          ? say("Looking for files", "Looked for files")
          : say(`Looking for ${pattern}`, `Looked for ${pattern}`);
      }
      return pattern === null
        ? say("Searching the code", "Searched the code")
        : say(`Searching the code for ${pattern}`, `Searched the code for ${pattern}`);
    }
    case "web": {
      const url = input?.url ?? detailField(entry.detail, "url");
      if (url !== null) return say(`Reading ${webTarget(url)}`, `Read ${webTarget(url)}`);
      if (namedToolCall(entry) === "WebFetch") return say("Reading a page", "Read a page");
      const query = input?.query ?? detailField(entry.detail, "query");
      return query === null
        ? say("Searching the web", "Searched the web")
        : say(`Searching the web for ${query}`, `Searched the web for ${query}`);
    }
    case "tool": {
      const named = namedToolCall(entry) ?? entry.toolTitle ?? titleName(entry.label);
      const zerops =
        ZEROPS_WORDS[named ?? ""] ??
        ZEROPS_WORDS[entry.label] ??
        ZEROPS_WORDS[entry.toolTitle ?? ""];
      if (zerops !== undefined) return running ? zerops[0] : zerops[1];
      // Its agent's own title for it (an MCP tool's), over its name in words.
      const presented = entry.toolPresentation?.title;
      if (presented !== undefined) return say(`Using ${presented}`, `Used ${presented}`);
      if (named === null) return say("Using a tool", "Used a tool");
      if (named === "Skill" && input?.skill !== undefined) {
        return say(`Using the ${input.skill} skill`, `Used the ${input.skill} skill`);
      }
      const words = toolCallWords(named, entry.detail);
      return running ? words : pastWords(words);
    }
  }
}

/** The verbs a call's words open with as it runs, as they read once it is done. */
const DONE_VERBS: Readonly<Record<string, string>> = {
  Using: "Used",
  Reading: "Read",
  Editing: "Edited",
  Writing: "Wrote",
  Searching: "Searched",
  Looking: "Looked",
  Running: "Ran",
  Starting: "Started",
  Updating: "Updated",
  Finishing: "Finished",
  Waiting: "Waited",
};

/** A call's words once it is done: "Updating its list" is "Updated its list". */
function pastWords(words: string): string {
  const [verb = "", ...rest] = words.split(" ");
  const done = DONE_VERBS[verb];
  return done === undefined ? words : [done, ...rest].join(" ");
}

/** A title that is a tool's name alone (Grok titles a call `enter_plan_mode`). */
function titleName(label: string): string | null {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(label.trim()) ? label.trim() : null;
}

function stepState(entry: WorkLogEntry, live: boolean): StepState {
  if (entry.toolLifecycleStatus === "failed" || entry.tone === "error") return "failed";
  return live && entry.toolLifecycleStatus === "inProgress" ? "running" : "done";
}

/** One call as a step. `live`: the run is still going, so an unfinished call runs. */
export function stepOf(
  entry: WorkLogEntry,
  tracked: TrackedCommands = NO_TRACKED_COMMANDS,
  live = true,
): WorkStep {
  const kind = stepKind(entry);
  const track = tracked.byCommand.get(entry.id);
  const job = kind === "command" ? backgroundJobOf(entry, tracked, live) : null;
  const taskRuns = track !== undefined && live && track.task.toolLifecycleStatus === "inProgress";
  const state = job?.state === "failed" ? "failed" : taskRuns ? "running" : stepState(entry, live);
  const running = state === "running";
  // The run is over and the call never returned: it has no end to time.
  const unreturned = !running && state !== "failed" && entry.toolLifecycleStatus === "inProgress";
  const ended =
    running || unreturned || job?.state === "running"
      ? null
      : new Date(Math.max(endOf(entry), track === undefined ? 0 : endOf(track.task))).toISOString();
  // The command as it was written, out of the shell the runtime ran it in.
  const unwrapped =
    kind === "command" && entry.command ? unwrapShell(entry.rawCommand ?? entry.command) : null;
  const code = unwrapped === null ? null : commandShown(unwrapped);
  const script = unwrapped === null ? null : commandWhole(unwrapped);
  const look = kind === "look" ? lookedAt(entry) : null;
  const described = entry.callInput?.description ?? track?.description ?? null;
  const ofJob =
    kind === "read" && described === null ? spilledReadPhrase(entry, tracked, running) : null;
  return {
    key: entry.id,
    kind,
    words:
      described ??
      (ofJob === null
        ? plainWords(entry, kind, running)
        : [ofJob.verb, ...ofJob.targets].join(" ")),
    phrase: described !== null ? null : (ofJob ?? plainPhrase(entry, kind, running)),
    code,
    script,
    codeLines: script === null ? 0 : script.split("\n").length,
    state,
    startedAt: entry.startedAt ?? entry.createdAt,
    endedAt: ended,
    entries: [entry],
    images: look === null ? [] : [look],
    ...(unreturned ? { noResult: "closed" as const } : {}),
    ...(job === null ? {} : { background: job }),
  };
}

/**
 * The steps of a run of calls, in order: looks at pictures one after another
 * fold into one step naming them all, and so do edits one after another —
 * four edits of one file were four lines of "Edited index.ts".
 */
export function foldSteps(
  entries: ReadonlyArray<WorkLogEntry>,
  tracked: TrackedCommands = NO_TRACKED_COMMANDS,
  live = true,
): WorkStep[] {
  const steps: WorkStep[] = [];
  for (const entry of entries) {
    const step = stepOf(entry, tracked, live);
    const previous = steps.at(-1);
    // A call that never returned — the slot's while it runs, "No result" once
    // the run is over — is a step of its own, never folded either way.
    const folds =
      previous !== undefined &&
      entry.toolLifecycleStatus !== "inProgress" &&
      previous.entries.every((earlier) => earlier.toolLifecycleStatus !== "inProgress");
    if (
      folds &&
      previous.kind === "look" &&
      step.kind === "look" &&
      previous.state !== "running" &&
      step.state !== "running" &&
      step.state !== "failed" &&
      previous.state !== "failed"
    ) {
      // A look still running is the slot's, never folded: these ended.
      const images = [...previous.images, ...step.images];
      const names = images.map(basename);
      steps[steps.length - 1] = {
        ...previous,
        words: names.length === 0 ? "Looked at pictures" : `Looked at ${listed(names)}`,
        phrase:
          names.length === 0
            ? { verb: "Looked at pictures", targets: [], more: 0, code: false }
            : phraseOf("Looked at", names),
        state: step.state,
        endedAt: step.endedAt,
        entries: [...previous.entries, entry],
        images,
      };
      continue;
    }
    if (
      folds &&
      previous.kind === "edit" &&
      step.kind === "edit" &&
      previous.state === "done" &&
      step.state !== "running" &&
      step.state !== "failed" &&
      step.words === plainWords(entry, "edit", false) &&
      previous.entries.every((earlier) => earlier.callInput?.description === undefined)
    ) {
      const merged = [...previous.entries, entry];
      steps[steps.length - 1] = {
        ...previous,
        words: editWords(merged, false),
        phrase: editPhrase(merged, false),
        state: step.state,
        endedAt: step.endedAt,
        entries: merged,
      };
      continue;
    }
    steps.push(step);
  }
  return steps;
}
