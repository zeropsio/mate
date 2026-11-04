/**
 * Each agent's MCP config, read into one shape and written back the way that
 * agent expects it.
 *
 * Pure: an agent's store takes the text of the files it lives in and answers
 * with servers or with the new text of each file it changes. Every write is
 * merge-aware — it touches only the one server (and that server's disabled
 * mark), keeps every other key, zcp's `zerops` included, and keeps a JSON
 * file's comments and formatting (JSONC, as OpenCode allows). A write is read
 * back before it is handed out: it must parse and hold exactly the change
 * meant, or the agent's write is refused.
 *
 * Where each agent keeps its servers (zcp writes `zerops` into the same
 * files, `../zcp/internal/init/adapters/*.go`):
 *
 * - Claude Code: `mcpServers` of every Claude home's `.claude.json` (user
 *   scope; the default's in `~`, each login's in its own `CLAUDE_CONFIG_DIR`),
 *   and `projects[<cwd>].mcpServers` of the same file (local scope); disabled
 *   per project, `projects[<cwd>].disabledMcpServers`. The repo's `.mcp.json`
 *   is read for display only.
 * - Codex: `[mcp_servers.<name>]` of each Codex home's `config.toml`;
 *   `enabled = false`.
 * - Cursor: `mcpServers` of `~/.cursor/mcp.json`; disabled per project in
 *   `~/.cursor/projects/<cwd with / as ->/mcp-disabled.json`.
 * - Grok: `[mcp_servers.<name>]` of `~/.grok/config.toml`; `enabled`.
 * - Antigravity: `mcpServers` of `~/.gemini/config/mcp_config.json` (which
 *   Mate's profile links to), or of a profile's own file; `disabled: true`, a
 *   URL as `serverUrl`.
 * - OpenCode: `mcp` of `~/.config/opencode/opencode.json` (or `.jsonc`);
 *   `type` local (`command` as one array) or remote, `enabled`.
 *
 * @module mcpAgents
 */
import {
  MCP_APP_REDIRECTS,
  type McpServerAuth,
  type McpServerAuthView,
  ProviderDriverKind,
  type McpServerAddInput,
  type McpServerTransport,
} from "@t3tools/contracts";
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  printParseErrorCode,
  type JSONPath,
  type ParseError,
} from "jsonc-parser";

import {
  appendTomlServer,
  readTomlServers,
  removeTomlServer,
  setTomlServerBoolean,
  setTomlServerStrings,
  setTomlServerValue,
  TomlEditError,
  validateToml,
  type TomlPlain,
} from "./mcpToml.ts";

/** zcp's own server, written by `zcp init` into every agent's config. */
export const MANAGED_MCP_SERVER = "zerops";

export type McpServerScope = "user" | "project";

export interface McpConfigServer {
  readonly name: string;
  readonly transport: McpServerTransport;
  readonly enabled: boolean;
  readonly scope: McpServerScope;
  /** The names of its environment (a command) or request headers (a URL); never their values. */
  readonly secretNames: ReadonlyArray<string>;
  /** How a URL server signs in, as this agent's config says; never a secret. */
  readonly auth?: McpServerAuthView;
}

/** What a server asks of an agent: its transport and how it signs in. */
export interface McpServerNeeds {
  readonly transport: McpServerTransport;
  readonly auth?: McpServerAuth | McpServerAuthView | undefined;
}

/** Whether a sign-in brings an app's client secret. */
const bringsSecret = (auth: McpServerNeeds["auth"]): boolean =>
  auth?.kind === "oauth-app" && ("secret" in auth ? auth.secret : auth.clientSecret !== undefined);

const SSE_REFUSED = (agent: string) => `${agent} can't use SSE servers.`;
const APP_REFUSED = (agent: string) => `${agent} can't sign in with your own app.`;

/** The text of each file an agent reads; a missing file is absent. */
export type McpFiles = ReadonlyMap<string, string>;

export interface McpFileEdit {
  readonly path: string;
  readonly text: string;
}

/** A config file that does not parse: the agent's servers can't be read or changed. */
export class McpConfigParseError extends Error {
  readonly path: string;
  readonly detail: string;
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "McpConfigParseError";
    this.path = path;
    this.detail = detail;
  }
}

/** A config file Mate can read but would not change safely; the write is refused. */
export class McpConfigEditError extends Error {
  readonly path: string;
  readonly reason: string;
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "McpConfigEditError";
    this.path = path;
    this.reason = reason;
  }
}

/** A change the agent can't take as asked (an SSE server, an app's secret); its message says so. */
export class McpConfigUnsupported extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "McpConfigUnsupported";
  }
}

export interface McpAgentStore {
  readonly driver: ProviderDriverKind;
  /** Every file the agent's servers and their disabled marks may live in. */
  readonly paths: ReadonlyArray<string>;
  /** Throws {@link McpConfigParseError} when the agent's own config does not parse. */
  readonly read: (files: McpFiles) => ReadonlyArray<McpConfigServer>;
  /** Files that could not be read without costing the agent its servers (Claude's `.mcp.json`). */
  readonly problems: (files: McpFiles) => ReadonlyArray<McpConfigParseError>;
  readonly add: (files: McpFiles, input: McpServerAddInput) => ReadonlyArray<McpFileEdit>;
  readonly remove: (files: McpFiles, name: string) => ReadonlyArray<McpFileEdit>;
  readonly setEnabled: (
    files: McpFiles,
    name: string,
    enabled: boolean,
  ) => ReadonlyArray<McpFileEdit>;
  /** The server as this agent's config holds it — what a running session is handed live. */
  readonly entry: (input: McpServerAddInput) => Record<string, unknown>;
  /** Why this agent can't use the server as it is set up; `null` when it can. */
  readonly cannot: (needs: McpServerNeeds) => string | null;
  /**
   * Replaces a URL server's sign-in (`none`, `oauth`, `oauth-app`) wherever it is
   * written; an `oauth-app` without a client secret keeps the one stored.
   */
  readonly setAuth: (
    files: McpFiles,
    name: string,
    auth: McpServerAuth,
  ) => ReadonlyArray<McpFileEdit>;
  /** A server's environment or headers, values included: read here, never handed out. */
  readonly readSecrets: (files: McpFiles, name: string) => Readonly<Record<string, string>>;
  /** Replaces a server's environment (a command) or headers (a URL) wherever it is written. */
  readonly setSecrets: (
    files: McpFiles,
    name: string,
    values: Readonly<Record<string, string>>,
  ) => ReadonlyArray<McpFileEdit>;
}

/** Where an agent's config keeps a server's environment and its headers. */
interface SecretFields {
  readonly stdio: string;
  readonly http: string;
}

const STANDARD_FIELDS: SecretFields = { stdio: "env", http: "headers" };

const secretField = (fields: SecretFields, entry: unknown): string | undefined => {
  const transport = decodeMcpTransport(entry);
  if (transport === undefined) return undefined;
  return transport.type === "stdio" ? fields.stdio : fields.http;
};

/** Scopes as a list: an agent's space-separated string or its array. */
const scopesOf = (value: unknown): string[] =>
  typeof value === "string"
    ? value.split(/\s+/).filter((scope) => scope.length > 0)
    : [...strings(value)];

const scopesText = (scopes: ReadonlyArray<string> | undefined): string | undefined =>
  scopes !== undefined && scopes.length > 0 ? scopes.join(" ") : undefined;

const withView = (auth: McpServerAuthView | undefined) => (auth !== undefined ? { auth } : {});

/** The string values of an entry's environment or headers. */
function secretsOf(fields: SecretFields, entry: unknown): Record<string, string> {
  const field = secretField(fields, entry);
  if (field === undefined || !isRecord(entry) || !isRecord(entry[field])) return {};
  return Object.fromEntries(
    Object.entries(entry[field]).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
}

/** Where the agents keep their config on this machine. */
export interface McpAgentPaths {
  /** The workspace the conversations run in: per-project marks are keyed by it. */
  readonly cwd: string;
  /** Every Claude home's `.claude.json`, the default's first. */
  readonly claudeConfigs: ReadonlyArray<string>;
  /** Every Codex home's `config.toml` (a login's shadow home links to its shared one). */
  readonly codexConfigs: ReadonlyArray<string>;
  /** `~/.cursor`. */
  readonly cursorHome: string;
  readonly grokConfig: string;
  /** `~/.gemini/config/mcp_config.json`, and any profile's own file. */
  readonly antigravityConfigs: ReadonlyArray<string>;
  /** `opencode.json`; its `.jsonc` sibling is read when only that one exists. */
  readonly openCodeConfig: string;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const strings = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const HTTP_TYPES = new Set(["http", "streamable-http", "streamableHttp", "remote"]);

/** A server entry of any agent's JSON or TOML config, as one transport. */
export function decodeMcpTransport(value: unknown): McpServerTransport | undefined {
  if (!isRecord(value)) return undefined;
  const url = nonEmpty(value["url"]) ?? nonEmpty(value["serverUrl"]) ?? nonEmpty(value["httpUrl"]);
  const type = nonEmpty(value["type"]);
  if (url !== undefined && type === "sse") return { type: "sse", url };
  if (url !== undefined && (value["command"] === undefined || HTTP_TYPES.has(type ?? ""))) {
    return { type: "http", url };
  }
  const command = value["command"];
  if (Array.isArray(command)) {
    const [head, ...rest] = strings(command);
    const trimmed = nonEmpty(head);
    return trimmed === undefined ? undefined : { type: "stdio", command: trimmed, args: rest };
  }
  const trimmed = nonEmpty(command);
  return trimmed === undefined
    ? undefined
    : { type: "stdio", command: trimmed, args: strings(value["args"]) };
}

const withRecord = (key: string, value: Readonly<Record<string, string>> | undefined) =>
  value !== undefined && Object.keys(value).length > 0 ? { [key]: { ...value } } : {};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// ── JSON and JSONC ───────────────────────────────────────────────────────

/** A JSON (or JSONC: comments, trailing commas) object; a missing or empty file is `{}`. */
function parseJson(path: string, text: string | undefined): JsonRecord {
  if (text === undefined || text.trim().length === 0) return {};
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first !== undefined) {
    throw new McpConfigParseError(
      path,
      `${printParseErrorCode(first.error)} at offset ${first.offset}`,
    );
  }
  if (!isRecord(parsed)) throw new McpConfigParseError(path, "not a JSON object");
  return parsed;
}

const FORMATTING = { formattingOptions: { tabSize: 2, insertSpaces: true, eol: "\n" } };

/** `text` with the value at `path` set (or removed, for `undefined`), comments and layout kept. */
function setJson(text: string, path: JSONPath, value: unknown): string {
  const source = text.trim().length === 0 ? "" : text;
  const next = applyEdits(source, modify(source, path, value, FORMATTING));
  return source.length === 0 && !next.endsWith("\n") ? `${next}\n` : next;
}

const serverMap = (doc: JsonRecord, key: string): JsonRecord =>
  isRecord(doc[key]) ? doc[key] : {};

const encodeList = (list: ReadonlyArray<string>): string => `${JSON.stringify(list, null, 2)}\n`;

/** Servers of a JSON map, each with its transport; entries of an unknown shape are skipped. */
function readJsonServers(
  servers: JsonRecord,
  enabled: (name: string, entry: JsonRecord) => boolean,
  scope: McpServerScope = "user",
  fields: SecretFields = STANDARD_FIELDS,
  authOf: (entry: JsonRecord) => McpServerAuthView | undefined = () => undefined,
): McpConfigServer[] {
  const out: McpConfigServer[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    const transport = decodeMcpTransport(entry);
    if (transport === undefined || !isRecord(entry)) continue;
    const secretNames = Object.keys(secretsOf(fields, entry));
    const auth = transport.type === "stdio" ? undefined : authOf(entry);
    out.push({
      name,
      transport,
      enabled: enabled(name, entry),
      scope,
      secretNames,
      ...(auth !== undefined ? { auth } : {}),
    });
  }
  return out;
}

/** `text` with the JSON server at `path` given `values` as its environment or headers. */
function setJsonSecrets(
  text: string,
  path: JSONPath,
  entry: unknown,
  fields: SecretFields,
  values: Readonly<Record<string, string>>,
): string | undefined {
  const field = secretField(fields, entry);
  if (field === undefined) return undefined;
  return setJson(
    text,
    [...path, field],
    Object.keys(values).length === 0 ? undefined : { ...values },
  );
}

const toggled = (list: ReadonlyArray<string>, name: string, present: boolean): string[] =>
  present ? [...new Set([...list, name])] : list.filter((item) => item !== name);

/** The first server of each name across several files, in order. */
function firstOfEach(lists: ReadonlyArray<ReadonlyArray<McpConfigServer>>): McpConfigServer[] {
  const seen = new Map<string, McpConfigServer>();
  for (const server of lists.flat()) if (!seen.has(server.name)) seen.set(server.name, server);
  return [...seen.values()];
}

/** Each path's edited text, for the paths `edit` changes. */
function editEach(
  files: McpFiles,
  paths: ReadonlyArray<string>,
  edit: (text: string, path: string) => string | undefined,
): McpFileEdit[] {
  return paths.flatMap((path) => {
    const text = files.get(path) ?? "";
    const next = edit(text, path);
    return next === undefined || next === text ? [] : [{ path, text: next }];
  });
}

// ── Claude Code ──────────────────────────────────────────────────────────

/** The port Claude Code listens on for an own-app sign-in, which the app registers. */
const CLAUDE_APP_CALLBACK_PORT = MCP_APP_REDIRECTS["claudeAgent"]!.port;

/** Claude's `oauth` block for a sign-in; `undefined` where it needs none. */
const claudeOauth = (auth: McpServerAuth | undefined): JsonRecord | undefined => {
  const scopes =
    auth?.kind === "oauth" || auth?.kind === "oauth-app" ? scopesText(auth.scopes) : undefined;
  if (auth?.kind === "oauth-app") {
    return {
      clientId: auth.clientId,
      callbackPort: CLAUDE_APP_CALLBACK_PORT,
      ...(scopes !== undefined ? { scopes } : {}),
    };
  }
  return scopes !== undefined ? { scopes } : undefined;
};

const claudeAuthView = (entry: JsonRecord): McpServerAuthView | undefined => {
  const oauth = entry["oauth"];
  if (!isRecord(oauth)) return undefined;
  const scopes = scopesOf(oauth["scopes"]);
  const clientId = nonEmpty(oauth["clientId"]);
  if (clientId !== undefined) return { kind: "oauth-app", clientId, scopes, secret: false };
  return scopes.length > 0 ? { kind: "oauth", scopes } : undefined;
};

const claudeEntry = (input: McpServerAddInput): JsonRecord => {
  if (input.transport.type === "stdio") {
    return {
      type: "stdio",
      command: input.transport.command,
      args: [...input.transport.args],
      env: { ...input.env },
    };
  }
  const oauth = claudeOauth(input.auth);
  return {
    type: input.transport.type,
    url: input.transport.url,
    ...withRecord("headers", input.headers),
    ...(oauth !== undefined ? { oauth } : {}),
  };
};

function claudeProject(doc: JsonRecord, cwd: string): JsonRecord {
  const projects = isRecord(doc["projects"]) ? doc["projects"] : {};
  return isRecord(projects[cwd]) ? projects[cwd] : {};
}

function claudeStore(paths: McpAgentPaths): McpAgentStore {
  const projectFile = `${paths.cwd.replace(/\/+$/, "")}/.mcp.json`;
  const homes = paths.claudeConfigs;
  const disabledPath: JSONPath = ["projects", paths.cwd, "disabledMcpServers"];
  /** Local scope (this project) before user scope: Claude's own precedence. */
  const readHome = (path: string, files: McpFiles): McpConfigServer[] => {
    const doc = parseJson(path, files.get(path));
    const project = claudeProject(doc, paths.cwd);
    const disabled = strings(project["disabledMcpServers"]);
    const enabled = (name: string) => !disabled.includes(name);
    return [
      ...readJsonServers(
        serverMap(project, "mcpServers"),
        enabled,
        "user",
        STANDARD_FIELDS,
        claudeAuthView,
      ),
      ...readJsonServers(
        serverMap(doc, "mcpServers"),
        enabled,
        "user",
        STANDARD_FIELDS,
        claudeAuthView,
      ),
    ];
  };
  const readProject = (files: McpFiles): McpConfigServer[] => {
    const defaultHome = homes[0];
    const disabled =
      defaultHome === undefined
        ? []
        : strings(
            claudeProject(parseJson(defaultHome, files.get(defaultHome)), paths.cwd)[
              "disabledMcpjsonServers"
            ],
          );
    return readJsonServers(
      serverMap(parseJson(projectFile, files.get(projectFile)), "mcpServers"),
      (name) => !disabled.includes(name),
      "project",
    );
  };
  return {
    driver: ProviderDriverKind.make("claudeAgent"),
    paths: [...homes, projectFile],
    read: (files) => {
      const user = homes.map((path) => readHome(path, files));
      // A broken `.mcp.json` is the repo's to fix; it never hides the user's servers.
      let project: McpConfigServer[] = [];
      try {
        project = readProject(files);
      } catch {
        project = [];
      }
      return firstOfEach([...user, project]);
    },
    problems: (files) => {
      try {
        parseJson(projectFile, files.get(projectFile));
        return [];
      } catch (cause) {
        return cause instanceof McpConfigParseError ? [cause] : [];
      }
    },
    add: (files, input) =>
      editEach(files, homes, (text, path) => {
        parseJson(path, text);
        return setJson(text, ["mcpServers", input.name], claudeEntry(input));
      }),
    remove: (files, name) =>
      editEach(files, homes, (text, path) => {
        const doc = parseJson(path, text);
        const project = claudeProject(doc, paths.cwd);
        let next = text;
        if (name in serverMap(doc, "mcpServers"))
          next = setJson(next, ["mcpServers", name], undefined);
        if (name in serverMap(project, "mcpServers")) {
          next = setJson(next, ["projects", paths.cwd, "mcpServers", name], undefined);
        }
        const disabled = strings(project["disabledMcpServers"]);
        if (disabled.includes(name))
          next = setJson(next, disabledPath, toggled(disabled, name, false));
        return next;
      }),
    setEnabled: (files, name, enabled) =>
      editEach(files, homes, (text, path) => {
        const doc = parseJson(path, text);
        const project = claudeProject(doc, paths.cwd);
        if (
          !(name in serverMap(doc, "mcpServers")) &&
          !(name in serverMap(project, "mcpServers"))
        ) {
          return undefined;
        }
        const disabled = strings(project["disabledMcpServers"]);
        if (disabled.includes(name) === !enabled) return undefined;
        return setJson(text, disabledPath, toggled(disabled, name, !enabled));
      }),
    entry: claudeEntry,
    cannot: (needs) =>
      bringsSecret(needs.auth)
        ? "Claude Code can't take your app's client secret from Mate."
        : null,
    setAuth: (files, name, auth) =>
      editEach(files, homes, (text, path) => {
        const doc = parseJson(path, text);
        const oauth = claudeOauth(auth);
        let next = text;
        if (serverMap(claudeProject(doc, paths.cwd), "mcpServers")[name] !== undefined) {
          next = setJson(next, ["projects", paths.cwd, "mcpServers", name, "oauth"], oauth);
        }
        if (serverMap(doc, "mcpServers")[name] !== undefined) {
          next = setJson(next, ["mcpServers", name, "oauth"], oauth);
        }
        return next;
      }),
    readSecrets: (files, name) => {
      for (const path of homes) {
        const doc = parseJson(path, files.get(path));
        const entry =
          serverMap(claudeProject(doc, paths.cwd), "mcpServers")[name] ??
          serverMap(doc, "mcpServers")[name];
        if (entry !== undefined) return secretsOf(STANDARD_FIELDS, entry);
      }
      return {};
    },
    setSecrets: (files, name, values) =>
      editEach(files, homes, (text, path) => {
        const doc = parseJson(path, text);
        const local = serverMap(claudeProject(doc, paths.cwd), "mcpServers")[name];
        const user = serverMap(doc, "mcpServers")[name];
        let next: string | undefined = text;
        if (local !== undefined) {
          next = setJsonSecrets(
            next,
            ["projects", paths.cwd, "mcpServers", name],
            local,
            STANDARD_FIELDS,
            values,
          );
        }
        if (user !== undefined && next !== undefined) {
          next = setJsonSecrets(next, ["mcpServers", name], user, STANDARD_FIELDS, values);
        }
        return next;
      }),
  };
}

// ── Codex and Grok (config.toml) ─────────────────────────────────────────

function tomlServers(path: string, text: string | undefined) {
  try {
    validateToml(text ?? "");
    return readTomlServers(text ?? "", "mcp_servers");
  } catch (cause) {
    throw new McpConfigParseError(path, messageOf(cause));
  }
}

/** A TOML edit, its refusal named for the file. */
function tomlEdit(path: string, edit: () => string): string {
  try {
    return edit();
  } catch (cause) {
    if (cause instanceof TomlEditError) throw new McpConfigEditError(path, cause.message);
    throw new McpConfigParseError(path, messageOf(cause));
  }
}

function tomlStore(
  driver: string,
  configs: ReadonlyArray<string>,
  entry: (input: McpServerAddInput) => Record<string, TomlPlain>,
  fields: SecretFields,
  auth: {
    readonly cannot: (needs: McpServerNeeds) => string | null;
    readonly view: (server: Record<string, TomlPlain>) => McpServerAuthView | undefined;
    /** The server's sign-in keys and their values; `undefined` removes one. */
    readonly keys: (auth: McpServerAuth) => ReadonlyArray<[string, TomlPlain | undefined]>;
  },
): McpAgentStore {
  return {
    driver: ProviderDriverKind.make(driver),
    paths: configs,
    read: (files) =>
      firstOfEach(
        configs.map((path) =>
          Object.entries(tomlServers(path, files.get(path))).flatMap(([name, server]) => {
            const transport = decodeMcpTransport(server);
            return transport === undefined
              ? []
              : [
                  {
                    name,
                    transport,
                    enabled: server["enabled"] !== false,
                    scope: "user" as const,
                    secretNames: Object.keys(secretsOf(fields, server)),
                    ...withView(transport.type === "stdio" ? undefined : auth.view(server)),
                  },
                ];
          }),
        ),
      ),
    problems: () => [],
    add: (files, input) =>
      editEach(files, configs, (text, path) =>
        tomlEdit(path, () =>
          appendTomlServer(
            removeTomlServer(text, "mcp_servers", input.name),
            "mcp_servers",
            input.name,
            entry(input),
          ),
        ),
      ),
    remove: (files, name) =>
      editEach(files, configs, (text, path) =>
        tomlEdit(path, () => removeTomlServer(text, "mcp_servers", name)),
      ),
    setEnabled: (files, name, enabled) =>
      editEach(files, configs, (text, path) => {
        const server = tomlServers(path, text)[name];
        if (server === undefined || (server["enabled"] !== false) === enabled) return undefined;
        return tomlEdit(path, () =>
          setTomlServerBoolean(text, "mcp_servers", name, "enabled", enabled),
        );
      }),
    entry,
    cannot: auth.cannot,
    setAuth: (files, name, next) =>
      editEach(files, configs, (text, path) => {
        if (tomlServers(path, text)[name] === undefined) return undefined;
        return tomlEdit(path, () =>
          auth
            .keys(next)
            .reduce(
              (current, [key, value]) =>
                setTomlServerValue(current, "mcp_servers", name, key, value),
              text,
            ),
        );
      }),
    readSecrets: (files, name) => {
      for (const path of configs) {
        const server = tomlServers(path, files.get(path))[name];
        if (server !== undefined) return secretsOf(fields, server);
      }
      return {};
    },
    setSecrets: (files, name, values) =>
      editEach(files, configs, (text, path) => {
        const server = tomlServers(path, text)[name];
        const field = secretField(fields, server);
        if (server === undefined || field === undefined) return undefined;
        return tomlEdit(path, () => setTomlServerStrings(text, "mcp_servers", name, field, values));
      }),
  };
}

const codexEntry = (input: McpServerAddInput): Record<string, TomlPlain> =>
  input.transport.type === "stdio"
    ? {
        command: input.transport.command,
        args: [...input.transport.args],
        ...withRecord("env", input.env),
      }
    : {
        url: input.transport.url,
        ...withRecord("http_headers", input.headers),
        ...(input.auth?.kind === "oauth" && (input.auth.scopes?.length ?? 0) > 0
          ? { scopes: [...input.auth.scopes!] }
          : {}),
      };

const codexAuth = {
  cannot: (needs: McpServerNeeds) =>
    needs.transport.type === "sse"
      ? SSE_REFUSED("Codex")
      : needs.auth?.kind === "oauth-app"
        ? "Codex can't sign in with your own app: it picks a new sign-in address each time, which an app can't register."
        : null,
  view: (server: Record<string, TomlPlain>): McpServerAuthView | undefined => {
    const scopes = scopesOf(server["scopes"]);
    const oauth = server["oauth"];
    const clientId = isRecord(oauth) ? nonEmpty(oauth["client_id"]) : undefined;
    if (clientId !== undefined) return { kind: "oauth-app", clientId, scopes, secret: false };
    return scopes.length > 0 ? { kind: "oauth", scopes } : undefined;
  },
  keys: (auth: McpServerAuth): ReadonlyArray<[string, TomlPlain | undefined]> => [
    [
      "scopes",
      auth.kind === "oauth" && (auth.scopes?.length ?? 0) > 0 ? [...auth.scopes!] : undefined,
    ],
  ],
};

/** Grok's sign-in Mate doesn't write: plain URLs and their headers only. */
const grokAuth = {
  cannot: (needs: McpServerNeeds) =>
    needs.transport.type === "sse"
      ? SSE_REFUSED("Grok")
      : needs.auth?.kind === "oauth-app"
        ? APP_REFUSED("Grok")
        : null,
  view: () => undefined,
  keys: () => [],
};

/** Grok's table is Codex's, with `enabled` as `grok mcp add` writes it. */
const grokEntry = (input: McpServerAddInput): Record<string, TomlPlain> =>
  input.transport.type === "stdio"
    ? {
        command: input.transport.command,
        args: [...input.transport.args],
        enabled: true,
        ...withRecord("env", input.env),
      }
    : { url: input.transport.url, enabled: true, ...withRecord("headers", input.headers) };

// ── JSON maps with the mark in the entry (Antigravity, OpenCode) ──────────

function jsonStore(input: {
  readonly driver: string;
  /** Every file the agent's servers may live in. */
  readonly paths: ReadonlyArray<string>;
  /** The files written: all of them, or the one that exists. */
  readonly targets: (files: McpFiles) => ReadonlyArray<string>;
  readonly key: string;
  readonly enabled: (entry: JsonRecord) => boolean;
  /** The edits that mark `entry` on or off, as paths under it. */
  readonly mark: (entry: JsonRecord, enabled: boolean) => ReadonlyArray<[string, unknown]>;
  readonly entry: (input: McpServerAddInput) => JsonRecord;
  readonly fields: SecretFields;
  readonly cannot: (needs: McpServerNeeds) => string | null;
  /** Where its sign-in lives in an entry, read without secrets and written keeping a stored one. */
  readonly auth?: {
    readonly field: string;
    readonly view: (entry: JsonRecord) => McpServerAuthView | undefined;
    readonly write: (auth: McpServerAuth, stored: unknown) => unknown;
  };
}): McpAgentStore {
  const { key, fields } = input;
  return {
    driver: ProviderDriverKind.make(input.driver),
    paths: input.paths,
    read: (files) =>
      firstOfEach(
        input
          .targets(files)
          .map((path) =>
            readJsonServers(
              serverMap(parseJson(path, files.get(path)), key),
              (_name, entry) => input.enabled(entry),
              "user",
              fields,
              input.auth?.view,
            ),
          ),
      ),
    problems: () => [],
    add: (files, server) =>
      editEach(files, input.targets(files), (text, path) => {
        parseJson(path, text);
        return setJson(text, [key, server.name], input.entry(server));
      }),
    remove: (files, name) =>
      editEach(files, input.targets(files), (text, path) =>
        name in serverMap(parseJson(path, text), key)
          ? setJson(text, [key, name], undefined)
          : undefined,
      ),
    setEnabled: (files, name, enabled) =>
      editEach(files, input.targets(files), (text, path) => {
        const entry = serverMap(parseJson(path, text), key)[name];
        if (!isRecord(entry) || input.enabled(entry) === enabled) return undefined;
        return input
          .mark(entry, enabled)
          .reduce((next, [field, value]) => setJson(next, [key, name, field], value), text);
      }),
    entry: input.entry,
    cannot: input.cannot,
    setAuth: (files, name, auth) =>
      editEach(files, input.targets(files), (text, path) => {
        const entry = serverMap(parseJson(path, text), key)[name];
        if (!isRecord(entry) || input.auth === undefined) return undefined;
        const { field, write } = input.auth;
        return setJson(text, [key, name, field], write(auth, entry[field]));
      }),
    readSecrets: (files, name) => {
      for (const path of input.targets(files)) {
        const entry = serverMap(parseJson(path, files.get(path)), key)[name];
        if (entry !== undefined) return secretsOf(fields, entry);
      }
      return {};
    },
    setSecrets: (files, name, values) =>
      editEach(files, input.targets(files), (text, path) => {
        const entry = serverMap(parseJson(path, text), key)[name];
        return entry === undefined
          ? undefined
          : setJsonSecrets(text, [key, name], entry, fields, values);
      }),
  };
}

const antigravityEntry = (input: McpServerAddInput): JsonRecord =>
  input.transport.type === "stdio"
    ? {
        command: input.transport.command,
        args: [...input.transport.args],
        ...withRecord("env", input.env),
      }
    : { serverUrl: input.transport.url, ...withRecord("headers", input.headers) };

const openCodeEntry = (input: McpServerAddInput): JsonRecord =>
  input.transport.type === "stdio"
    ? {
        type: "local",
        command: [input.transport.command, ...input.transport.args],
        ...withRecord("environment", input.env),
        enabled: true,
      }
    : {
        type: "remote",
        url: input.transport.url,
        ...withRecord("headers", input.headers),
        ...openCodeOauthEntry(input.auth),
        enabled: true,
      };

/** OpenCode's `oauth`: `false` for none, an app's id, secret and scope, or a sign-in's scope. */
const openCodeOauth = (auth: McpServerAuth | undefined, stored?: unknown): unknown => {
  if (auth?.kind === "none") return false;
  const scope =
    auth?.kind === "oauth" || auth?.kind === "oauth-app" ? scopesText(auth.scopes) : undefined;
  if (auth?.kind === "oauth-app") {
    const secret =
      auth.clientSecret ?? (isRecord(stored) ? nonEmpty(stored["clientSecret"]) : undefined);
    const redirect = MCP_APP_REDIRECTS["opencode"]!;
    return {
      clientId: auth.clientId,
      ...(secret !== undefined ? { clientSecret: secret } : {}),
      ...(scope !== undefined ? { scope } : {}),
      callbackPort: redirect.port,
      redirectUri: redirect.url,
    };
  }
  return scope !== undefined ? { scope } : undefined;
};

const openCodeOauthEntry = (auth: McpServerAuth | undefined) => {
  const oauth = openCodeOauth(auth);
  return oauth === undefined ? {} : { oauth };
};

const openCodeAuthView = (entry: JsonRecord): McpServerAuthView | undefined => {
  const oauth = entry["oauth"];
  if (oauth === false) return { kind: "none" };
  if (!isRecord(oauth)) return undefined;
  const scopes = scopesOf(oauth["scope"]);
  const clientId = nonEmpty(oauth["clientId"]);
  if (clientId !== undefined) {
    return {
      kind: "oauth-app",
      clientId,
      scopes,
      secret: nonEmpty(oauth["clientSecret"]) !== undefined,
    };
  }
  return scopes.length > 0 ? { kind: "oauth", scopes } : undefined;
};

// ── Cursor ───────────────────────────────────────────────────────────────

/** The folder Cursor keeps a workspace's state in: its path, slashes as dashes. */
export const cursorProjectDir = (cwd: string): string =>
  cwd.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("/", "-");

/** Cursor's `auth`: only an app's, with its stored secret kept when none is given. */
const cursorAuth = (auth: McpServerAuth | undefined, stored?: unknown): JsonRecord | undefined => {
  if (auth?.kind !== "oauth-app") return undefined;
  const secret =
    auth.clientSecret ?? (isRecord(stored) ? nonEmpty(stored["CLIENT_SECRET"]) : undefined);
  return {
    CLIENT_ID: auth.clientId,
    ...(secret !== undefined ? { CLIENT_SECRET: secret } : {}),
    ...(auth.scopes !== undefined && auth.scopes.length > 0 ? { scopes: [...auth.scopes] } : {}),
  };
};

const cursorAuthView = (entry: JsonRecord): McpServerAuthView | undefined => {
  const auth = entry["auth"];
  const clientId = isRecord(auth) ? nonEmpty(auth["CLIENT_ID"]) : undefined;
  if (!isRecord(auth) || clientId === undefined) return undefined;
  return {
    kind: "oauth-app",
    clientId,
    scopes: scopesOf(auth["scopes"]),
    secret: nonEmpty(auth["CLIENT_SECRET"]) !== undefined,
  };
};

const cursorEntry = (input: McpServerAddInput): JsonRecord => {
  if (input.transport.type === "stdio") {
    return {
      type: "stdio",
      command: input.transport.command,
      args: [...input.transport.args],
      ...withRecord("env", input.env),
    };
  }
  const auth = cursorAuth(input.auth);
  return {
    ...(input.transport.type === "sse" ? { type: "sse" } : {}),
    url: input.transport.url,
    ...withRecord("headers", input.headers),
    ...(auth !== undefined ? { auth } : {}),
  };
};

function cursorStore(paths: McpAgentPaths): McpAgentStore {
  const config = `${paths.cursorHome}/mcp.json`;
  const disabledFile = `${paths.cursorHome}/projects/${cursorProjectDir(paths.cwd)}/mcp-disabled.json`;
  const readDisabled = (files: McpFiles): ReadonlyArray<string> => {
    const text = files.get(disabledFile);
    if (text === undefined || text.trim().length === 0) return [];
    const errors: ParseError[] = [];
    const parsed: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length > 0 || !Array.isArray(parsed)) {
      throw new McpConfigParseError(disabledFile, "not a JSON list of names");
    }
    return strings(parsed);
  };
  const markDisabled = (files: McpFiles, name: string, disabled: boolean): McpFileEdit[] => {
    const list = readDisabled(files);
    return list.includes(name) === disabled
      ? []
      : [{ path: disabledFile, text: encodeList(toggled(list, name, disabled)) }];
  };
  return {
    driver: ProviderDriverKind.make("cursor"),
    paths: [config, disabledFile],
    read: (files) => {
      const disabled = readDisabled(files);
      return readJsonServers(
        serverMap(parseJson(config, files.get(config)), "mcpServers"),
        (name) => !disabled.includes(name),
        "user",
        STANDARD_FIELDS,
        cursorAuthView,
      );
    },
    problems: () => [],
    add: (files, input) => [
      ...editEach(files, [config], (text) => {
        parseJson(config, text);
        return setJson(text, ["mcpServers", input.name], cursorEntry(input));
      }),
      ...markDisabled(files, input.name, false),
    ],
    remove: (files, name) => {
      const doc = parseJson(config, files.get(config));
      if (!(name in serverMap(doc, "mcpServers"))) return [];
      return [
        ...editEach(files, [config], (text) => setJson(text, ["mcpServers", name], undefined)),
        ...markDisabled(files, name, false),
      ];
    },
    setEnabled: (files, name, enabled) =>
      name in serverMap(parseJson(config, files.get(config)), "mcpServers")
        ? markDisabled(files, name, !enabled)
        : [],
    entry: cursorEntry,
    cannot: () => null,
    setAuth: (files, name, auth) =>
      editEach(files, [config], (text) => {
        const entry = serverMap(parseJson(config, text), "mcpServers")[name];
        if (!isRecord(entry)) return undefined;
        return setJson(text, ["mcpServers", name, "auth"], cursorAuth(auth, entry["auth"]));
      }),
    readSecrets: (files, name) =>
      secretsOf(
        STANDARD_FIELDS,
        serverMap(parseJson(config, files.get(config)), "mcpServers")[name],
      ),
    setSecrets: (files, name, values) =>
      editEach(files, [config], (text) => {
        const entry = serverMap(parseJson(config, text), "mcpServers")[name];
        return entry === undefined
          ? undefined
          : setJsonSecrets(text, ["mcpServers", name], entry, STANDARD_FIELDS, values);
      }),
  };
}

// ── Read-back ────────────────────────────────────────────────────────────

const sameTransport = (a: McpServerTransport, b: McpServerTransport): boolean =>
  a.type === "stdio" && b.type === "stdio"
    ? a.command === b.command &&
      a.args.length === b.args.length &&
      a.args.every((arg, index) => arg === b.args[index])
    : a.type !== "stdio" && a.type === b.type && a.url === (b as { url: string }).url;

const sameServer = (a: McpConfigServer, b: McpConfigServer): boolean =>
  a.name === b.name &&
  a.enabled === b.enabled &&
  a.scope === b.scope &&
  sameTransport(a.transport, b.transport);

/**
 * The store, with each write read back before it is handed out: every file it
 * changes must parse, the server must stand as meant, and every other server
 * must stand as it did — else {@link McpConfigEditError}, and nothing of this
 * agent is written.
 */
function readBack(store: McpAgentStore): McpAgentStore {
  const check = (
    files: McpFiles,
    edits: ReadonlyArray<McpFileEdit>,
    name: string,
    meant: (after: McpConfigServer | undefined) => boolean,
  ): ReadonlyArray<McpFileEdit> => {
    if (edits.length === 0) return edits;
    const where = edits[0]!.path;
    const before = store.read(files);
    const next = new Map(files);
    for (const edit of edits) next.set(edit.path, edit.text);
    let after: ReadonlyArray<McpConfigServer>;
    try {
      after = store.read(next);
    } catch (cause) {
      throw new McpConfigEditError(where, `the change would not read back (${messageOf(cause)})`);
    }
    const others = (servers: ReadonlyArray<McpConfigServer>) =>
      servers.filter((server) => server.name !== name);
    const kept =
      others(before).length === others(after).length &&
      others(before).every((server) =>
        others(after).some((candidate) => sameServer(server, candidate)),
      );
    if (!kept || !meant(after.find((server) => server.name === name))) {
      throw new McpConfigEditError(where, "the change would not hold exactly what was meant");
    }
    return edits;
  };
  return {
    ...store,
    add: (files, input) =>
      check(
        files,
        store.add(files, input),
        input.name,
        (after) =>
          after !== undefined &&
          after.enabled &&
          after.scope === "user" &&
          sameTransport(after.transport, input.transport),
      ),
    remove: (files, name) =>
      check(
        files,
        store.remove(files, name),
        name,
        (after) => after === undefined || after.scope === "project",
      ),
    setEnabled: (files, name, enabled) =>
      check(
        files,
        store.setEnabled(files, name, enabled),
        name,
        (after) => after?.enabled === enabled,
      ),
    setAuth: (files, name, auth) => {
      const before = store.read(files).find((server) => server.name === name);
      return check(
        files,
        store.setAuth(files, name, auth),
        name,
        (after) =>
          before !== undefined &&
          after !== undefined &&
          after.enabled === before.enabled &&
          sameTransport(after.transport, before.transport),
      );
    },
    setSecrets: (files, name, values) => {
      const before = store.read(files).find((server) => server.name === name);
      const names = Object.keys(values).toSorted();
      return check(
        files,
        store.setSecrets(files, name, values),
        name,
        (after) =>
          before !== undefined &&
          after !== undefined &&
          after.enabled === before.enabled &&
          after.scope === before.scope &&
          sameTransport(after.transport, before.transport) &&
          after.secretNames.toSorted().join("\n") === names.join("\n"),
      );
    },
  };
}

/** The store of each agent Mate can run, by driver. */
export function makeMcpAgentStores(
  paths: McpAgentPaths,
): ReadonlyMap<ProviderDriverKind, McpAgentStore> {
  const openCodeJsonc = paths.openCodeConfig.replace(/\.json$/, ".jsonc");
  const stores: McpAgentStore[] = [
    claudeStore(paths),
    tomlStore(
      "codex",
      paths.codexConfigs,
      codexEntry,
      { stdio: "env", http: "http_headers" },
      codexAuth,
    ),
    cursorStore(paths),
    tomlStore("grok", [paths.grokConfig], grokEntry, STANDARD_FIELDS, grokAuth),
    jsonStore({
      driver: "antigravity",
      paths: paths.antigravityConfigs,
      targets: () => paths.antigravityConfigs,
      key: "mcpServers",
      enabled: (entry) => entry["disabled"] !== true,
      mark: (_entry, enabled) => [["disabled", enabled ? undefined : true]],
      entry: antigravityEntry,
      fields: STANDARD_FIELDS,
      cannot: (needs) =>
        needs.transport.type === "sse"
          ? SSE_REFUSED("Antigravity")
          : needs.auth?.kind === "oauth-app"
            ? APP_REFUSED("Antigravity")
            : null,
    }),
    jsonStore({
      driver: "opencode",
      paths: [paths.openCodeConfig, openCodeJsonc],
      // OpenCode reads either; Mate writes the one there is, `opencode.json` when neither is.
      targets: (files) => [
        !files.has(paths.openCodeConfig) && files.has(openCodeJsonc)
          ? openCodeJsonc
          : paths.openCodeConfig,
      ],
      key: "mcp",
      enabled: (entry) => entry["enabled"] !== false,
      mark: (_entry, enabled) => [["enabled", enabled]],
      entry: openCodeEntry,
      fields: { stdio: "environment", http: "headers" },
      // The OpenCode installed beside Mate speaks streamable HTTP only.
      cannot: (needs) => (needs.transport.type === "sse" ? SSE_REFUSED("OpenCode") : null),
      auth: { field: "oauth", view: openCodeAuthView, write: openCodeOauth },
    }),
  ];
  return new Map(stores.map((store) => [store.driver, readBack(store)]));
}
