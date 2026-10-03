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
}

/** A command a task tracked: the task's words, and the task (its end is the command's). */
export interface TrackedCommand {
  readonly description: string;
  readonly task: WorkLogEntry;
}

export interface TrackedCommands {
  /** By the command entry's id. */
  readonly byCommand: ReadonlyMap<string, TrackedCommand>;
  /** The tasks that are commands: never a row or a bar of their own. */
  readonly trackers: ReadonlySet<string>;
}

export const NO_TRACKED_COMMANDS: TrackedCommands = {
  byCommand: new Map(),
  trackers: new Set(),
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
  let rest = command;
  for (let match = STATEMENT_PREAMBLE.exec(rest); match; match = STATEMENT_PREAMBLE.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  const line = (value: string) => (value.split("\n")[0] ?? "").replace(/\s+/g, " ").trim();
  const shown = line(rest);
  return shown.length > 0 ? shown : line(command);
}

/** A command whole, as a bubble draws it: its preamble dropped, every line kept. */
export function commandWhole(command: string): string {
  let rest = command;
  for (let match = STATEMENT_PREAMBLE.exec(rest); match; match = STATEMENT_PREAMBLE.exec(rest)) {
    rest = rest.slice(match[0].length);
  }
  const whole = rest.trimEnd();
  return whole.trim().length > 0 ? whole.trim() : command.trim();
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
  for (const task of entries) {
    if (!isTask(task)) continue;
    const command =
      task.taskToolUseId !== undefined
        ? byCallId.get(task.taskToolUseId)
        : task.taskType === undefined || task.taskType === "local_bash"
          ? commands.find(
              (candidate) =>
                !byCommand.has(candidate.id) &&
                startOf(candidate) <= Date.parse(task.createdAt) &&
                Math.abs(endOf(candidate) - Date.parse(task.createdAt)) <= TRACK_TOLERANCE_MS,
            )
          : undefined;
    if (command === undefined) continue;
    trackers.add(task.id);
    const description = (task.toolTitle ?? task.label).trim();
    if (description.length > 0) byCommand.set(command.id, { description, task });
  }
  return { byCommand, trackers };
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
      const query = input?.query ?? detailField(entry.detail, "query");
      return query === null
        ? say("Searching the web", "Searched the web")
        : say(`Searching the web for ${query}`, `Searched the web for ${query}`);
    }
    case "tool": {
      const zerops = ZEROPS_WORDS[entry.label] ?? ZEROPS_WORDS[entry.toolTitle ?? ""];
      if (zerops !== undefined) return running ? zerops[0] : zerops[1];
      const named = namedToolCall(entry) ?? entry.toolTitle ?? null;
      if (named === null) return say("Using a tool", "Used a tool");
      const words = toolCallWords(named, entry.detail);
      return running ? words : words.replace(/^Using /, "Used ");
    }
  }
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
  const taskRuns = track !== undefined && live && track.task.toolLifecycleStatus === "inProgress";
  const state = taskRuns ? "running" : stepState(entry, live);
  const running = state === "running";
  // The run is over and the call never returned: it has no end to time.
  const unreturned = !running && state !== "failed" && entry.toolLifecycleStatus === "inProgress";
  const ended =
    running || unreturned
      ? null
      : new Date(Math.max(endOf(entry), track === undefined ? 0 : endOf(track.task))).toISOString();
  // The command as it was written, out of the shell the runtime ran it in.
  const unwrapped =
    kind === "command" && entry.command ? unwrapShell(entry.rawCommand ?? entry.command) : null;
  const code = unwrapped === null ? null : commandShown(unwrapped);
  const script = unwrapped === null ? null : commandWhole(unwrapped);
  const look = kind === "look" ? lookedAt(entry) : null;
  const described = entry.callInput?.description ?? track?.description ?? null;
  return {
    key: entry.id,
    kind,
    words: described ?? plainWords(entry, kind, running),
    phrase: described === null ? plainPhrase(entry, kind, running) : null,
    code,
    script,
    codeLines: script === null ? 0 : script.split("\n").length,
    state,
    startedAt: entry.startedAt ?? entry.createdAt,
    endedAt: ended,
    entries: [entry],
    images: look === null ? [] : [look],
    ...(unreturned ? { noResult: "closed" as const } : {}),
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
