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
  MCP_APP_REDIRECTS,
  PROVIDER_DISPLAY_NAMES,
  type McpServerAddInput,
  type McpServerAuth,
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

/**
 * Where a tool stands in the tab: waiting on the person; ready (an agent reached it); not
 * checked yet (no agent reached it, or it isn't set up for the conversation's agent); off.
 */
export type McpRowGroup = "waiting" | "ready" | "unchecked" | "off";

/**
 * A row's right column says one thing: the one action it needs from the person (Sign in, Add
 * key, Try again), else its state in a word or two.
 */
export type McpRowRight =
  | {
      readonly kind: "action";
      readonly action: "signIn" | "addKey" | "tryAgain";
      readonly label: string;
    }
  | { readonly kind: "state"; readonly words: string; readonly tone: ServiceStatusToneId };

/** One installed agent as a mark on the row: its state, said in words for its tooltip. */
export interface McpAgentMark {
  readonly driver: ProviderDriverKind;
  readonly tone: ServiceStatusToneId;
  readonly label: string;
}

export interface McpServerRow {
  readonly name: string;
  readonly group: McpRowGroup;
  readonly right: McpRowRight;
  readonly marks: ReadonlyArray<McpAgentMark>;
  /** The neutral tile's letters. */
  readonly initials: string;
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
  /**
   * The names of its environment (a command) or headers (a URL), never their
   * values; `editable` where this tab may change them (the Mate's own).
   */
  readonly secrets: {
    readonly kind: "env" | "headers";
    readonly names: ReadonlyArray<string>;
    readonly editable: boolean;
  };
  readonly config:
    | { readonly kind: "command"; readonly line: string }
    | { readonly kind: "url"; readonly url: string; readonly sse?: true };
  /** How it signs in, in words, where its config says: never a secret. */
  readonly signInLabel: string | null;
  /** Each installed agent that can't use it as it is set up, saying why. */
  readonly cannot: ReadonlyArray<string>;
  /** The server's sign-in as its config holds it: what the edit form starts from. */
  readonly auth: McpServerEntry["auth"];
  readonly actions: {
    readonly reconnect: boolean;
    /** `null` where this tab may not change it (the repo's). */
    readonly toggle: "on" | "off" | null;
    readonly remove: boolean;
    /**
     * `new`: the conversation's agent waits for a sign-in to this server;
     * `again`: a URL server it failed on, whose sign-in may have run out.
     */
    readonly signIn: "new" | "again" | null;
    /** The conversation's agent is signed in to it, or may be: Sign out. */
    readonly signOut: boolean;
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

/** The agents that sign in to a remote server from Mate (`mcp.servers.signIn`). */
const SIGNING_AGENTS: ReadonlySet<string> = new Set(["claudeAgent", "codex", "opencode"]);

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
  if (transport.type !== "stdio") {
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
  // An agent that can't use it says why on a line of its own.
  const unable = new Set((entry.cannot ?? []).map((item) => item.driver));
  const drivers = installed.filter((driver) => !unable.has(driver));
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

/**
 * A server set up and not yet reported on. A URL server may want a sign-in that only a running
 * agent finds out about: say so, and what would check. An agent that never reports (the ACP
 * ones) and a command, which signs in by its environment, are only set up.
 */
function unreportedNote(entry: McpServerEntry, driver: ProviderDriverKind | null): string {
  if (driver !== null && !SIGNING_AGENTS.has(driver)) return STATE_LABEL.configured;
  if (entry.transport.type === "stdio") {
    return driver === null
      ? "Open a conversation with this Mate to check it."
      : `${agentDisplayName(driver)} checks it when this conversation next runs.`;
  }
  if (driver === null) return "May need a sign-in. Open a conversation with this Mate to check.";
  return `May need a sign-in. ${agentDisplayName(driver)} checks when this conversation next runs.`;
}

/** A server's refusal of its key or token, in the words servers use. */
const REFUSED_CREDENTIAL = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid[_ ]token|expired/i;

/** The tile's letters: Zerops' own "Z"; else two, the second a camel hump's where there is one. */
export function mcpTileInitials(name: string, managed: boolean): string {
  if (managed) return "Z";
  const letters = name.replace(/[^A-Za-z0-9]/g, "");
  if (letters.length === 0) return "?";
  const first = letters[0]!.toUpperCase();
  const hump = letters.slice(1).search(/[A-Z]/);
  const second = hump === -1 ? letters[1] : letters[hump + 1];
  return second === undefined ? first : `${first}${second.toLowerCase()}`;
}

function rowRight(input: {
  readonly state: McpRowState;
  readonly toolCount: number;
  readonly error: string | undefined;
  readonly byHeaders: boolean;
  readonly signIn: McpServerRow["actions"]["signIn"];
  readonly reconnect: boolean;
  readonly unable: boolean;
}): McpRowRight {
  const refused = input.error !== undefined && REFUSED_CREDENTIAL.test(input.error);
  switch (input.state) {
    case "connected":
      return {
        kind: "state",
        words:
          input.toolCount === 0
            ? "Ready"
            : `${String(input.toolCount)} ${input.toolCount === 1 ? "tool" : "tools"}`,
        tone: "ok",
      };
    case "needs-auth":
      if (input.byHeaders) return { kind: "action", action: "addKey", label: "Add key" };
      return input.signIn === null
        ? { kind: "state", words: "Needs sign-in", tone: "attention" }
        : { kind: "action", action: "signIn", label: "Sign in" };
    case "failed":
      if (refused && input.byHeaders) return { kind: "action", action: "addKey", label: "Add key" };
      if (refused && input.signIn !== null) {
        return { kind: "action", action: "signIn", label: "Sign in again" };
      }
      return input.reconnect
        ? { kind: "action", action: "tryAgain", label: "Try again" }
        : { kind: "state", words: "Failed", tone: "failed" };
    case "connecting":
      return { kind: "state", words: "Connecting", tone: "busy" };
    case "configured":
      return { kind: "state", words: "Not reached yet", tone: "off" };
    case "disabled":
      return { kind: "state", words: "Off", tone: "off" };
    case "absent":
      return { kind: "state", words: input.unable ? "Can't use it" : "Not set up", tone: "off" };
  }
}

/**
 * Waiting on you · Ready · Not checked yet · Off, each with its rows in the server's order; empty
 * ones left out.
 */
export function groupMcpRows(
  rows: ReadonlyArray<McpServerRow>,
): ReadonlyArray<{ readonly id: McpRowGroup; readonly rows: ReadonlyArray<McpServerRow> }> {
  return (["waiting", "ready", "unchecked", "off"] as const).flatMap((id) => {
    const inGroup = rows.filter((row) => row.group === id);
    return inGroup.length === 0 ? [] : [{ id, rows: inGroup }];
  });
}

/** A URL server's sign-in in words, from what its config says. */
function signInLabel(entry: McpServerEntry): string | null {
  const auth = entry.auth;
  const scopes = (list: ReadonlyArray<string>) => (list.length > 0 ? ` · ${list.join(" ")}` : "");
  if (auth?.kind === "oauth-app") {
    return `Your app ${auth.clientId}${auth.secret ? " · secret stored" : ""}${scopes(auth.scopes)}`;
  }
  if (auth?.kind === "oauth") return `In the browser, when the server asks${scopes(auth.scopes)}`;
  if (auth?.kind === "none") return (entry.secretNames ?? []).length > 0 ? "API key" : "No sign-in";
  if ((entry.secretNames ?? []).some((name) => name.toLowerCase() === "authorization")) {
    return "API key";
  }
  return null;
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
  const unableReason =
    driver === null ? undefined : entry.cannot?.find((item) => item.driver === driver)?.reason;
  const absentLabel =
    unableReason ?? (driver === null ? "Not set up" : `Not set up for ${agentDisplayName(driver)}`);
  const note: McpServerRow["note"] =
    state === "failed"
      ? { kind: "error", text: agent?.error?.trim() || "It didn't start." }
      : state === "needs-auth"
        ? { kind: "quiet", text: "Needs sign-in" }
        : state === "disabled"
          ? { kind: "quiet", text: "Turned off" }
          : state === "absent"
            ? { kind: "quiet", text: absentLabel }
            : // A grey dot says why in a word: the agent has it, and cannot say how it is doing.
              state === "configured"
              ? { kind: "quiet", text: unreportedNote(entry, driver) }
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
  const unable = new Map((entry.cannot ?? []).map((item) => [item.driver, item.reason]));
  // The conversation's own agent leads; the rest keep their installed order.
  const marks: McpAgentMark[] = [...installed, ...entry.agents.map((found) => found.driver)]
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .toSorted((a, b) => Number(b === driver) - Number(a === driver))
    .map((candidate) => {
      const reason = unable.get(candidate);
      const found = entry.agents.find((item) => item.driver === candidate);
      const markState: McpRowState = found?.state ?? "absent";
      return {
        driver: candidate,
        tone: STATE_TONE[markState],
        label: reason ?? `${agentDisplayName(candidate)}: ${STATE_WORD[markState]}`,
      };
    });
  // Only the conversation's own agent signs in or out, and only one that can; an agent that
  // reaches the server by a token (`signedIn: false`) has no sign-in to renew or drop.
  const remote = entry.transport.type !== "stdio";
  // Headers on a URL server are how it signs in, unless the agent says it holds an OAuth sign-in.
  const byHeaders = remote && (entry.secretNames?.length ?? 0) > 0 && agent?.signedIn !== true;
  const signing =
    driver !== null && SIGNING_AGENTS.has(driver) && agent?.signedIn !== false && !byHeaders;
  const signIn: McpServerRow["actions"]["signIn"] =
    driver !== null && state === "needs-auth"
      ? "new"
      : signing && remote && state === "failed"
        ? "again"
        : null;
  const right = rowRight({
    state,
    toolCount: toolSource.length,
    error: agent?.error?.trim() || undefined,
    byHeaders,
    signIn,
    reconnect: state !== "disabled" && state !== "absent" && state !== "configured",
    unable: driver !== null && unable.has(driver),
  });
  return {
    name: entry.name,
    group:
      state === "disabled"
        ? "off"
        : right.kind === "action" || state === "needs-auth"
          ? "waiting"
          : state === "configured" || state === "absent"
            ? "unchecked"
            : "ready",
    right,
    marks,
    initials: mcpTileInitials(entry.name, entry.managed),
    managed: entry.managed,
    origin,
    state,
    tone: STATE_TONE[state],
    stateLabel: state === "absent" ? absentLabel : STATE_LABEL[state],
    runs: mcpRunsLabel(entry.transport),
    note,
    agentsLine: agentsLine(entry, installed, state),
    secrets: {
      kind: remote ? "headers" : "env",
      names: entry.secretNames ?? [],
      editable: origin === "mate",
    },
    tools: toolSource.map((tool) => ({
      name: tool.name,
      description: tool.description?.trim() || null,
      mark: toolMark(tool),
    })),
    config:
      entry.transport.type === "stdio"
        ? {
            kind: "command",
            line: formatCommandLine(entry.transport.command, entry.transport.args),
          }
        : {
            kind: "url",
            url: entry.transport.url,
            ...(entry.transport.type === "sse" ? { sse: true as const } : {}),
          },
    signInLabel: remote ? signInLabel(entry) : null,
    cannot: (entry.cannot ?? []).map((item) => item.reason),
    auth: entry.auth,
    actions: {
      // Config alone does not establish a running session to reconnect.
      reconnect: state !== "disabled" && state !== "absent" && state !== "configured",
      // Only the Mate's own servers turn off here: the repo's are edited in
      // its .mcp.json, and the Mate runs on Zerops' tools.
      toggle: origin === "mate" ? (enabled ? "off" : "on") : null,
      remove: origin === "mate",
      signIn,
      signOut: signing && remote && state === "connected",
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
  /** A command, a URL (streamable HTTP), or an SSE URL. */
  readonly kind: "command" | "url" | "sse";
  readonly commandLine: string;
  readonly url: string;
  /** Env lines for a command, header lines for a URL. */
  readonly extra: string;
  /** How a URL server signs in. */
  readonly signIn: McpSignInFields;
}

export type McpAddFormErrors = Partial<Record<"name" | "target" | "extra" | "auth", string>>;

/**
 * The add card's one "Where it connects" field, read as the add form's: an http(s) address is a
 * URL server (SSE where its path ends in /sse, as SSE servers' addresses do), anything else a
 * command; with a line saying which, so the person sees what will be written.
 */
export function mcpWhere(text: string): {
  readonly form: Pick<McpAddForm, "kind" | "commandLine" | "url">;
  readonly words: string | null;
} {
  const value = text.trim();
  if (value === "") return { form: { kind: "url", commandLine: "", url: "" }, words: null };
  if (/^https?:\/\//i.test(value)) {
    let sse = false;
    try {
      sse = /\/sse\/?$/i.test(new URL(value).pathname);
    } catch {
      sse = false;
    }
    return sse
      ? {
          form: { kind: "sse", commandLine: "", url: value },
          words: "An SSE server: an older kind not every agent speaks.",
        }
      : { form: { kind: "url", commandLine: "", url: value }, words: "A streamable HTTP server." };
  }
  return {
    form: { kind: "command", commandLine: value, url: "" },
    words: "A command this Mate runs.",
  };
}

// ── How a URL server signs in ─────────────────────────────────────────

/** None · API key · Sign in (when the server asks) · Sign in with your own app. */
export type McpSignInChoice = "none" | "header" | "oauth" | "oauth-app";

export interface McpSignInFields {
  readonly choice: McpSignInChoice;
  readonly headerName: string;
  /** The API key; in the edit form, empty keeps the stored one. */
  readonly key: string;
  /** Space- or comma-separated. */
  readonly scopes: string;
  readonly clientId: string;
  /** Optional; in the edit form, empty keeps the stored one. */
  readonly clientSecret: string;
}

export const BLANK_SIGN_IN: McpSignInFields = {
  choice: "oauth",
  headerName: "Authorization",
  key: "",
  scopes: "",
  clientId: "",
  clientSecret: "",
};

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const scopeList = (text: string): string[] =>
  text.split(/[\s,]+/).filter((scope) => scope.length > 0);

/** An Authorization key without a scheme of its own is a bearer token. */
const keyValue = (name: string, key: string): string =>
  name.toLowerCase() === "authorization" && !/\s/.test(key) ? `Bearer ${key}` : key;

type ReadSignIn =
  | { readonly ok: true; readonly auth: McpServerAuth | undefined }
  | { readonly ok: false; readonly error: string };

/**
 * The sign-in fields read into the server's `auth`; `undefined` where it is
 * the agents' own default (a sign-in when asked, no scopes). `keepSecrets`:
 * the edit form, where an empty key or client secret keeps the stored one.
 */
function readSignIn(fields: McpSignInFields, keepSecrets: boolean): ReadSignIn {
  switch (fields.choice) {
    case "none":
      return { ok: true, auth: { kind: "none" } };
    case "header": {
      const name = fields.headerName.trim() || "Authorization";
      if (!HEADER_NAME.test(name)) return { ok: false, error: `${name} isn't a header name.` };
      const key = fields.key.trim();
      if (key === "") {
        // The stored key stays as its header; the server signs in no other way.
        return keepSecrets
          ? { ok: true, auth: { kind: "none" } }
          : { ok: false, error: "Paste the key." };
      }
      return { ok: true, auth: { kind: "header", name, value: keyValue(name, key) } };
    }
    case "oauth": {
      const scopes = scopeList(fields.scopes);
      return { ok: true, auth: scopes.length > 0 ? { kind: "oauth", scopes } : undefined };
    }
    case "oauth-app": {
      const clientId = fields.clientId.trim();
      if (clientId === "") return { ok: false, error: "Give your app's client ID." };
      const secret = fields.clientSecret.trim();
      const scopes = scopeList(fields.scopes);
      return {
        ok: true,
        auth: {
          kind: "oauth-app",
          clientId,
          ...(secret !== "" ? { clientSecret: secret } : {}),
          ...(scopes.length > 0 ? { scopes } : {}),
        },
      };
    }
  }
}

/** The edit form's sign-in fields, from what the server's config says. */
export function mcpSignInStart(row: Pick<McpServerRow, "auth" | "secrets">): McpSignInFields {
  const { auth } = row;
  if (auth?.kind === "oauth-app") {
    return {
      ...BLANK_SIGN_IN,
      choice: "oauth-app",
      clientId: auth.clientId,
      scopes: auth.scopes.join(" "),
    };
  }
  if (auth?.kind === "oauth")
    return { ...BLANK_SIGN_IN, choice: "oauth", scopes: auth.scopes.join(" ") };
  const keyHeader = row.secrets.names.find((name) => name.toLowerCase() === "authorization");
  if (keyHeader !== undefined) return { ...BLANK_SIGN_IN, choice: "header", headerName: keyHeader };
  if (auth?.kind === "none") return { ...BLANK_SIGN_IN, choice: "none" };
  return BLANK_SIGN_IN;
}

/** The edited sign-in: `undefined` when nothing changed, else what to write. */
export function readMcpSignInEdit(start: McpSignInFields, fields: McpSignInFields): ReadSignIn {
  const same = (Object.keys(start) as Array<keyof McpSignInFields>).every(
    (key) => start[key] === fields[key],
  );
  if (same) return { ok: true, auth: undefined };
  const read = readSignIn(fields, true);
  // Choosing a sign-in when asked with no scopes is still a change: it clears the old one.
  if (read.ok && read.auth === undefined) return { ok: true, auth: { kind: "oauth" } };
  return read;
}

/** The redirect each installed agent's own-app sign-in needs registered in the app. */
export function mcpAppRedirects(
  agents: ReadonlyArray<ProviderDriverKind>,
): ReadonlyArray<{ readonly agent: string; readonly url: string }> {
  return agents.flatMap((driver) => {
    const redirect = MCP_APP_REDIRECTS[driver];
    return redirect === undefined ? [] : [{ agent: agentDisplayName(driver), url: redirect.url }];
  });
}

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
    else transport = { type: form.kind === "sse" ? "sse" : "http", url };
  }
  const signIn = form.kind === "command" ? undefined : readSignIn(form.signIn, false);
  if (signIn !== undefined && !signIn.ok) errors.auth = signIn.error;

  const extra = form.kind === "command" ? parseEnvLines(form.extra) : parseHeaderLines(form.extra);
  if (!extra.ok) errors.extra = extra.error;

  if (Object.keys(errors).length > 0 || transport === null || !extra.ok) {
    return { ok: false, errors };
  }
  const hasExtra = Object.keys(extra.value).length > 0;
  const auth = signIn?.ok ? signIn.auth : undefined;
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
      ...(auth !== undefined ? { auth } : {}),
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

// ── A server's environment or headers ─────────────────────────────────

/** What stands for a stored value the tab never sees. */
export const MCP_SECRET_MASK = "••••••";

/** The edit form's first text: each name, its value masked. */
export function mcpSecretsFormText(kind: "env" | "headers", names: ReadonlyArray<string>): string {
  return names
    .map((name) => (kind === "env" ? `${name}=${MCP_SECRET_MASK}` : `${name}: ${MCP_SECRET_MASK}`))
    .join("\n");
}

export type ReadMcpSecretsForm =
  | {
      readonly ok: true;
      readonly values: Record<string, string>;
      readonly keep: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly error: string };

/** The edit form read: new values, and the names left masked, whose stored values stay. */
export function readMcpSecretsForm(kind: "env" | "headers", text: string): ReadMcpSecretsForm {
  const parsed = kind === "env" ? parseEnvLines(text) : parseHeaderLines(text);
  if (!parsed.ok) return parsed;
  const values: Record<string, string> = {};
  const keep: string[] = [];
  for (const [name, value] of Object.entries(parsed.value)) {
    if (value === MCP_SECRET_MASK) keep.push(name);
    else values[name] = value;
  }
  return { ok: true, values, keep };
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
