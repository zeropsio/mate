/**
 * The MCP tab's logic: a row per server as the conversation's agent stands
 * with it, and the add form read into `mcp.servers.add`.
 *
 * A row's dot carries the state of the agent the open conversation runs on;
 * the words under the name say only what the dot cannot — a failure's own
 * error, a sign-in it waits for, that it is off or not set up for this agent,
 * and, when the Mate's agents stand differently, which stands how.
 * `configured` (the agent has it but cannot say how it does) is quiet: it is
 * neither a warning nor a disagreement with an agent that can tell.
 */
import {
  PROVIDER_DISPLAY_NAMES,
  type McpServerAddInput,
  type McpServerAgent,
  type McpServerEntry,
  type McpServerState,
  type McpServerTransport,
  type McpServersList,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

/** A row's state: the agent's own, or `absent` when the server isn't set up for it. */
export type McpRowState = McpServerState | "absent";

export interface McpToolRow {
  readonly name: string;
  readonly description: string | null;
  /** From the tool's annotations: `reads` (read-only), `changes`, or unsaid. */
  readonly mark: "reads" | "changes" | null;
}

export interface McpServerRow {
  readonly name: string;
  readonly managed: boolean;
  /**
   * Who keeps it: `builtin` (Zerops wrote it), `repo` (the repo's `.mcp.json`,
   * edited there) or `mate` (added here, for every agent).
   */
  readonly origin: "builtin" | "repo" | "mate";
  readonly state: McpRowState;
  readonly tone: ServiceStatusToneId;
  /** The dot's name, for its tooltip and assistive technology. */
  readonly stateLabel: string;
  /** What it runs: a command's basename (a package runner's package) or a URL's host. */
  readonly runs: string;
  /** The row's second line, only where the dot can't say it. */
  readonly note: { readonly kind: "error" | "quiet"; readonly text: string } | null;
  /** Which agent stands how, only when they stand differently. */
  readonly agentsLine: string | null;
  readonly tools: ReadonlyArray<McpToolRow>;
  readonly config:
    | { readonly kind: "command"; readonly line: string }
    | { readonly kind: "url"; readonly url: string };
  readonly actions: {
    readonly reconnect: boolean;
    /** `null` where this tab may not change it (the repo's). */
    readonly toggle: "on" | "off" | null;
    readonly remove: boolean;
  };
}

const STATE_TONE: Record<McpRowState, ServiceStatusToneId> = {
  connected: "ok",
  connecting: "busy",
  "needs-auth": "attention",
  failed: "failed",
  disabled: "off",
  configured: "off",
  absent: "off",
};

const STATE_LABEL: Record<McpServerState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  "needs-auth": "Needs sign-in",
  failed: "Failed",
  disabled: "Turned off",
  configured: "Set up",
};

const STATE_WORD: Record<McpRowState, string> = {
  connected: "connected",
  connecting: "connecting",
  "needs-auth": "needs sign-in",
  failed: "failed",
  disabled: "off",
  configured: "set up",
  absent: "not set up",
};

/** The most telling state first: what a row shows when no agent is the conversation's. */
const STATE_PRIORITY: ReadonlyArray<McpServerState> = [
  "failed",
  "needs-auth",
  "connecting",
  "connected",
  "configured",
  "disabled",
];

export function agentDisplayName(driver: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driver] ?? driver;
}

/** Commands that run a package: their basename says nothing, the package does. */
const PACKAGE_RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx"]);

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

export function mcpRunsLabel(transport: McpServerTransport): string {
  if (transport.type === "http") {
    try {
      return new URL(transport.url).host || transport.url;
    } catch {
      return transport.url;
    }
  }
  const command = basename(transport.command);
  if (!PACKAGE_RUNNERS.has(command)) return command;
  const pkg = transport.args.find((arg) => !arg.startsWith("-"));
  if (pkg === undefined) return command;
  // `@scope/name@latest` → `@scope/name`; a leading `@` is the scope's.
  const at = pkg.indexOf("@", 1);
  return at > 0 ? pkg.slice(0, at) : pkg;
}

// ── Command lines ─────────────────────────────────────────────────────

export type SplitCommandLine =
  | { readonly ok: true; readonly words: string[] }
  | { readonly ok: false; readonly error: string };

/**
 * Splits a command line the way a POSIX shell would for plain words: blanks
 * separate, single quotes are literal, double quotes take `\"`, `\\`, `\$` and
 * `` \` `` escapes, and a backslash outside quotes escapes the next character.
 * Nothing expands: `$HOME` stays `$HOME`.
 */
export function splitCommandLine(line: string): SplitCommandLine {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\" && index + 1 < line.length && '"\\$`'.includes(line[index + 1]!)) {
        word += line[index + 1];
        index += 1;
      } else {
        word += char;
      }
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= line.length) return { ok: false, error: "The line ends in a backslash." };
      word += line[index + 1];
      inWord = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    word += char;
    inWord = true;
  }
  if (quote !== null) return { ok: false, error: "A quote isn't closed." };
  if (inWord) words.push(word);
  return { ok: true, words };
}

const PLAIN_WORD = /^[A-Za-z0-9@%+=:,./_-]+$/;

function quoteWord(word: string): string {
  if (PLAIN_WORD.test(word)) return word;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** A command and its arguments as one line `splitCommandLine` reads back the same. */
export function formatCommandLine(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].map(quoteWord).join(" ");
}

// ── Env and header lines ──────────────────────────────────────────────

export type ParsedLines =
  | { readonly ok: true; readonly value: Record<string, string> }
  | { readonly ok: false; readonly error: string };

function parseLines(
  text: string,
  options: {
    readonly separator: string;
    readonly shape: string;
    readonly valid: RegExp;
    readonly what: string;
    readonly sameKey: (key: string) => string;
  },
): ParsedLines {
  const value: Record<string, string> = {};
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const at = line.indexOf(options.separator);
    const lineNo = `Line ${String(index + 1)}`;
    const key = at > 0 ? line.slice(0, at).trim() : "";
    if (key === "") return { ok: false, error: `${lineNo}: write ${options.shape}.` };
    if (!options.valid.test(key)) {
      return { ok: false, error: `${lineNo}: ${key} isn't ${options.what}.` };
    }
    const same = options.sameKey(key);
    if (seen.has(same)) return { ok: false, error: `${lineNo}: ${key} is set twice.` };
    seen.add(same);
    value[key] = line.slice(at + options.separator.length).trim();
  }
  return { ok: true, value };
}

/** `KEY=value` a line; blank lines and `#` notes are skipped. */
export function parseEnvLines(text: string): ParsedLines {
  return parseLines(text, {
    separator: "=",
    shape: "KEY=value",
    valid: /^[A-Za-z_][A-Za-z0-9_]*$/,
    what: "a variable name",
    sameKey: (key) => key,
  });
}

/** `Name: value` a line; header names are the same whatever their case. */
export function parseHeaderLines(text: string): ParsedLines {
  return parseLines(text, {
    separator: ":",
    shape: "Name: value",
    valid: /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/,
    what: "a header name",
    sameKey: (key) => key.toLowerCase(),
  });
}

// ── Rows ──────────────────────────────────────────────────────────────

function toolMark(tool: { readonly readOnly?: boolean; readonly destructive?: boolean }) {
  if (tool.destructive === true) return "changes" as const;
  if (tool.readOnly === true) return "reads" as const;
  if (tool.readOnly === false) return "changes" as const;
  return null;
}

function mostTelling(agents: ReadonlyArray<McpServerAgent>): McpServerAgent | null {
  for (const state of STATE_PRIORITY) {
    const agent = agents.find((entry) => entry.state === state);
    if (agent) return agent;
  }
  return null;
}

function agentsLine(
  entry: McpServerEntry,
  installed: ReadonlyArray<ProviderDriverKind>,
  current: McpRowState,
): string | null {
  const drivers = [...installed];
  for (const agent of entry.agents) {
    if (!drivers.includes(agent.driver)) drivers.push(agent.driver);
  }
  const states = drivers.map(
    (driver): McpRowState =>
      entry.agents.find((agent) => agent.driver === driver)?.state ?? "absent",
  );
  const known = new Set(states.filter((state) => state !== "configured" && state !== "absent"));
  const differ =
    known.size > 1 ||
    (states.includes("absent") && states.some((state) => state !== "absent")) ||
    (current === "configured" && known.size > 0);
  if (!differ) return null;
  const groups: Array<{ word: string; names: string[] }> = [];
  for (const [index, driver] of drivers.entries()) {
    const word = STATE_WORD[states[index]!];
    const group = groups.find((entry) => entry.word === word);
    if (group) group.names.push(agentDisplayName(driver));
    else groups.push({ word, names: [agentDisplayName(driver)] });
  }
  return groups.map((group) => `${group.names.join(", ")} ${group.word}`).join(" · ");
}

function buildRow(
  entry: McpServerEntry,
  installed: ReadonlyArray<ProviderDriverKind>,
  driver: ProviderDriverKind | null,
): McpServerRow {
  const agent =
    driver === null
      ? mostTelling(entry.agents)
      : (entry.agents.find((candidate) => candidate.driver === driver) ?? null);
  const state: McpRowState = agent?.state ?? "absent";
  const absentLabel = driver === null ? "Not set up" : `Not set up for ${agentDisplayName(driver)}`;
  const note: McpServerRow["note"] =
    state === "failed"
      ? { kind: "error", text: agent?.error?.trim() || "It didn't start." }
      : state === "needs-auth"
        ? { kind: "quiet", text: "Needs sign-in" }
        : state === "disabled"
          ? { kind: "quiet", text: "Turned off" }
          : state === "absent"
            ? { kind: "quiet", text: absentLabel }
            : null;
  const toolSource =
    agent?.tools !== undefined && agent.tools.length > 0
      ? agent.tools
      : (entry.agents.find((candidate) => (candidate.tools?.length ?? 0) > 0)?.tools ?? []);
  const enabled =
    state === "absent"
      ? entry.agents.some((candidate) => candidate.state !== "disabled")
      : state !== "disabled";
  const origin = entry.managed ? "builtin" : entry.scope === "project" ? "repo" : "mate";
  return {
    name: entry.name,
    managed: entry.managed,
    origin,
    state,
    tone: STATE_TONE[state],
    stateLabel: state === "absent" ? absentLabel : STATE_LABEL[state],
    runs: mcpRunsLabel(entry.transport),
    note,
    agentsLine: agentsLine(entry, installed, state),
    tools: toolSource.map((tool) => ({
      name: tool.name,
      description: tool.description?.trim() || null,
      mark: toolMark(tool),
    })),
    config:
      entry.transport.type === "http"
        ? { kind: "url", url: entry.transport.url }
        : {
            kind: "command",
            line: formatCommandLine(entry.transport.command, entry.transport.args),
          },
    actions: {
      // Config alone does not establish a running session to reconnect.
      reconnect: state !== "disabled" && state !== "absent" && state !== "configured",
      // Only the Mate's own servers turn off here: the repo's are edited in
      // its .mcp.json, and the Mate runs on Zerops' tools.
      toggle: origin === "mate" ? (enabled ? "off" : "on") : null,
      remove: origin === "mate",
    },
  };
}

/** Zerops' own first, the rest in the server's order. */
export function buildMcpRows(
  list: McpServersList,
  driver: ProviderDriverKind | null,
): ReadonlyArray<McpServerRow> {
  const ordered = [
    ...list.servers.filter((entry) => entry.managed),
    ...list.servers.filter((entry) => !entry.managed),
  ];
  return ordered.map((entry) => buildRow(entry, list.agents, driver));
}

// ── The add form ──────────────────────────────────────────────────────

export interface McpAddForm {
  readonly name: string;
  readonly kind: "command" | "url";
  readonly commandLine: string;
  readonly url: string;
  /** Env lines for a command, header lines for a URL. */
  readonly extra: string;
}

export type McpAddFormErrors = Partial<Record<"name" | "target" | "extra", string>>;

export type ReadMcpAddForm =
  | { readonly ok: true; readonly input: McpServerAddInput }
  | { readonly ok: false; readonly errors: McpAddFormErrors };

function nameError(name: string, existing: ReadonlyArray<string>): string | null {
  if (name === "") return "Give it a name.";
  if (name.length > 64) return "64 characters at most.";
  if (!/^[a-z0-9_-]+$/i.test(name)) return "Letters, digits, - and _ only.";
  const lower = name.toLowerCase();
  if (existing.some((entry) => entry.toLowerCase() === lower)) {
    return `There's already a server named ${name}.`;
  }
  return null;
}

export function readMcpAddForm(form: McpAddForm, existing: ReadonlyArray<string>): ReadMcpAddForm {
  const errors: McpAddFormErrors = {};
  const name = form.name.trim();
  const badName = nameError(name, existing);
  if (badName !== null) errors.name = badName;

  let transport: McpServerTransport | null = null;
  if (form.kind === "command") {
    const split = splitCommandLine(form.commandLine);
    if (!split.ok) errors.target = split.error;
    else if (split.words.length === 0 || split.words[0]!.trim() === "") {
      errors.target = "Type the command that starts it.";
    } else {
      transport = { type: "stdio", command: split.words[0]!, args: split.words.slice(1) };
    }
  } else {
    const url = form.url.trim();
    if (url === "") errors.target = "Paste the server's URL.";
    else if (!isHttpUrl(url)) errors.target = "That isn't an http or https URL.";
    else transport = { type: "http", url };
  }

  const extra = form.kind === "command" ? parseEnvLines(form.extra) : parseHeaderLines(form.extra);
  if (!extra.ok) errors.extra = extra.error;

  if (Object.keys(errors).length > 0 || transport === null || !extra.ok) {
    return { ok: false, errors };
  }
  const hasExtra = Object.keys(extra.value).length > 0;
  return {
    ok: true,
    input: {
      name,
      transport,
      ...(hasExtra
        ? form.kind === "command"
          ? { env: extra.value }
          : { headers: extra.value }
        : {}),
    },
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ── Failures ──────────────────────────────────────────────────────────

/** A failed call's own words: the server's `detail`, an error's message, or a plain fallback. */
export function describeMcpFailure(error: unknown): string {
  if (typeof error === "string" && error.trim() !== "") return error;
  if (typeof error === "object" && error !== null) {
    const { detail, message } = error as { detail?: unknown; message?: unknown };
    if (typeof detail === "string" && detail.trim() !== "") return detail;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return "The Mate didn't answer.";
}

// ── The tab's list over time ──────────────────────────────────────────

/**
 * Every call answers the whole fresh list (a read, and each action), and they
 * can come back in any order: the newest answer to have arrived stands, an
 * older one arriving later is dropped, and a failed call keeps the list it had
 * — the tab never paints something a later answer takes back.
 */
export interface McpTabState {
  readonly list: McpServersList | null;
  /** The newest failure, until a newer answer. */
  readonly error: string | null;
  /** The sequence number the shown list or error came from. */
  readonly appliedSeq: number;
  readonly inFlight: ReadonlyArray<number>;
  /** A call is out: the header's spinner. */
  readonly busy: boolean;
}

export type McpTabEvent =
  | { readonly kind: "asked"; readonly seq: number }
  | { readonly kind: "answered"; readonly seq: number; readonly list: McpServersList }
  | { readonly kind: "failed"; readonly seq: number; readonly message: string }
  /** A call that changes nothing here: an action that failed, said beside its control. */
  | { readonly kind: "dropped"; readonly seq: number };

export const MCP_TAB_START: McpTabState = {
  list: null,
  error: null,
  appliedSeq: 0,
  inFlight: [],
  busy: false,
};

/** The tab opened on what this Mate last answered, if anything. */
export function mcpTabStart(remembered: McpServersList | null): McpTabState {
  return { ...MCP_TAB_START, list: remembered };
}

export function mcpTabStep(state: McpTabState, event: McpTabEvent): McpTabState {
  if (event.kind === "asked") {
    const inFlight = [...state.inFlight, event.seq];
    return { ...state, inFlight, busy: true };
  }
  const inFlight = state.inFlight.filter((seq) => seq !== event.seq);
  const settled = { ...state, inFlight, busy: inFlight.length > 0 };
  if (event.kind === "dropped" || event.seq < state.appliedSeq) return settled;
  return event.kind === "answered"
    ? { ...settled, list: event.list, error: null, appliedSeq: event.seq }
    : { ...settled, error: event.message, appliedSeq: event.seq };
}
