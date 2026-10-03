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
}

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

const HTTP_TYPES = new Set(["http", "sse", "streamable-http", "streamableHttp", "remote"]);

/** A server entry of any agent's JSON or TOML config, as one transport. */
export function decodeMcpTransport(value: unknown): McpServerTransport | undefined {
  if (!isRecord(value)) return undefined;
  const url = nonEmpty(value["url"]) ?? nonEmpty(value["serverUrl"]) ?? nonEmpty(value["httpUrl"]);
  const type = nonEmpty(value["type"]);
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
): McpConfigServer[] {
  const out: McpConfigServer[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    const transport = decodeMcpTransport(entry);
    if (transport === undefined || !isRecord(entry)) continue;
    out.push({ name, transport, enabled: enabled(name, entry), scope });
  }
  return out;
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

const claudeEntry = (input: McpServerAddInput): JsonRecord =>
  input.transport.type === "stdio"
    ? {
        type: "stdio",
        command: input.transport.command,
        args: [...input.transport.args],
        env: { ...input.env },
      }
    : { type: "http", url: input.transport.url, ...withRecord("headers", input.headers) };

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
      ...readJsonServers(serverMap(project, "mcpServers"), enabled),
      ...readJsonServers(serverMap(doc, "mcpServers"), enabled),
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
              : [{ name, transport, enabled: server["enabled"] !== false, scope: "user" as const }];
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
  };
}

const codexEntry = (input: McpServerAddInput): Record<string, TomlPlain> =>
  input.transport.type === "stdio"
    ? {
        command: input.transport.command,
        args: [...input.transport.args],
        ...withRecord("env", input.env),
      }
    : { url: input.transport.url, ...withRecord("http_headers", input.headers) };

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
}): McpAgentStore {
  const { key } = input;
  return {
    driver: ProviderDriverKind.make(input.driver),
    paths: input.paths,
    read: (files) =>
      firstOfEach(
        input
          .targets(files)
          .map((path) =>
            readJsonServers(serverMap(parseJson(path, files.get(path)), key), (_name, entry) =>
              input.enabled(entry),
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
        enabled: true,
      };

// ── Cursor ───────────────────────────────────────────────────────────────

/** The folder Cursor keeps a workspace's state in: its path, slashes as dashes. */
export const cursorProjectDir = (cwd: string): string =>
  cwd.replace(/^\/+/, "").replace(/\/+$/, "").replaceAll("/", "-");

const cursorEntry = (input: McpServerAddInput): JsonRecord =>
  input.transport.type === "stdio"
    ? {
        type: "stdio",
        command: input.transport.command,
        args: [...input.transport.args],
        ...withRecord("env", input.env),
      }
    : { url: input.transport.url, ...withRecord("headers", input.headers) };

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
  };
}

// ── Read-back ────────────────────────────────────────────────────────────

const sameTransport = (a: McpServerTransport, b: McpServerTransport): boolean =>
  a.type === "stdio" && b.type === "stdio"
    ? a.command === b.command &&
      a.args.length === b.args.length &&
      a.args.every((arg, index) => arg === b.args[index])
    : a.type === "http" && b.type === "http" && a.url === b.url;

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
  };
}

/** The store of each agent Mate can run, by driver. */
export function makeMcpAgentStores(
  paths: McpAgentPaths,
): ReadonlyMap<ProviderDriverKind, McpAgentStore> {
  const openCodeJsonc = paths.openCodeConfig.replace(/\.json$/, ".jsonc");
  const stores: McpAgentStore[] = [
    claudeStore(paths),
    tomlStore("codex", paths.codexConfigs, codexEntry),
    cursorStore(paths),
    tomlStore("grok", [paths.grokConfig], grokEntry),
    jsonStore({
      driver: "antigravity",
      paths: paths.antigravityConfigs,
      targets: () => paths.antigravityConfigs,
      key: "mcpServers",
      enabled: (entry) => entry["disabled"] !== true,
      mark: (_entry, enabled) => [["disabled", enabled ? undefined : true]],
      entry: antigravityEntry,
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
    }),
  ];
  return new Map(stores.map((store) => [store.driver, readBack(store)]));
}
