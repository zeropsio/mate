/**
 * Each agent's MCP config, read into one shape and written back the way that
 * agent expects it.
 *
 * Pure: an agent's store takes the text of the files it lives in and answers
 * with servers or with the new text of each file it changes. Every write is
 * merge-aware — it touches only the one server (and that server's disabled
 * mark) and keeps every other key, zcp's `zerops` included.
 *
 * Where each agent keeps its servers (zcp writes `zerops` into the same
 * files, `../zcp/internal/init/adapters/*.go`):
 *
 * - Claude Code: `mcpServers` of every Claude home's `.claude.json` (the
 *   default's in `~`, each login's in its own `CLAUDE_CONFIG_DIR`); disabled
 *   per project, `projects[<cwd>].disabledMcpServers`. The repo's `.mcp.json`
 *   is read for display only.
 * - Codex: `[mcp_servers.<name>]` of each Codex home's `config.toml`;
 *   `enabled = false`.
 * - Cursor: `mcpServers` of `~/.cursor/mcp.json`; disabled per project in
 *   `~/.cursor/projects/<cwd with / as ->/mcp-disabled.json`.
 * - Grok: `[mcp_servers.<name>]` of `~/.grok/config.toml`; `enabled`.
 * - Antigravity: `mcpServers` of `~/.gemini/config/mcp_config.json`;
 *   `disabled: true`, a URL as `serverUrl`.
 * - OpenCode: `mcp` of `~/.config/opencode/opencode.json`; `type` local
 *   (`command` as one array) or remote, `enabled`.
 *
 * @module mcpAgents
 */
import {
  ProviderDriverKind,
  type McpServerAddInput,
  type McpServerTransport,
} from "@t3tools/contracts";

import {
  appendTomlServer,
  readTomlServers,
  removeTomlServer,
  setTomlServerBoolean,
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

export class McpConfigParseError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = "McpConfigParseError";
    this.path = path;
  }
}

export interface McpAgentStore {
  readonly driver: ProviderDriverKind;
  /** Every file the agent's servers and their disabled marks live in. */
  readonly paths: ReadonlyArray<string>;
  readonly read: (files: McpFiles) => ReadonlyArray<McpConfigServer>;
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
  readonly antigravityConfig: string;
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

function parseJson(path: string, text: string | undefined): JsonRecord {
  if (text === undefined || text.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new McpConfigParseError(path, cause instanceof Error ? cause.message : String(cause));
  }
  if (!isRecord(parsed)) throw new McpConfigParseError(path, "not a JSON object");
  return parsed;
}

const encodeJson = (doc: unknown): string => `${JSON.stringify(doc, null, 2)}\n`;

function parseToml(path: string, text: string | undefined) {
  try {
    return readTomlServers(text ?? "", "mcp_servers");
  } catch (cause) {
    throw new McpConfigParseError(path, cause instanceof Error ? cause.message : String(cause));
  }
}

const serverMap = (doc: JsonRecord, key: string): JsonRecord =>
  isRecord(doc[key]) ? doc[key] : {};

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

const setServer = (doc: JsonRecord, key: string, name: string, entry: unknown): JsonRecord => ({
  ...doc,
  [key]: { ...serverMap(doc, key), [name]: entry },
});

const deleteServer = (doc: JsonRecord, key: string, name: string): JsonRecord => {
  const { [name]: _removed, ...rest } = serverMap(doc, key);
  return { ...doc, [key]: rest };
};

const toggled = (list: ReadonlyArray<string>, name: string, present: boolean): string[] =>
  present ? [...new Set([...list, name])] : list.filter((item) => item !== name);

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

function claudeProjectList(doc: JsonRecord, cwd: string, key: string): ReadonlyArray<string> {
  const projects = isRecord(doc["projects"]) ? doc["projects"] : {};
  const project = isRecord(projects[cwd]) ? projects[cwd] : {};
  return strings(project[key]);
}

function withClaudeProjectList(
  doc: JsonRecord,
  cwd: string,
  key: string,
  list: ReadonlyArray<string>,
): JsonRecord {
  const projects = isRecord(doc["projects"]) ? doc["projects"] : {};
  const project = isRecord(projects[cwd]) ? projects[cwd] : {};
  return { ...doc, projects: { ...projects, [cwd]: { ...project, [key]: [...list] } } };
}

function claudeStore(paths: McpAgentPaths): McpAgentStore {
  const projectFile = `${paths.cwd.replace(/\/+$/, "")}/.mcp.json`;
  const homes = paths.claudeConfigs;
  const editHomes = (files: McpFiles, edit: (doc: JsonRecord) => JsonRecord | undefined) =>
    homes.flatMap((path) => {
      const next = edit(parseJson(path, files.get(path)));
      return next === undefined ? [] : [{ path, text: encodeJson(next) }];
    });
  return {
    driver: ProviderDriverKind.make("claudeAgent"),
    paths: [...homes, projectFile],
    read: (files) => {
      const seen = new Map<string, McpConfigServer>();
      for (const path of homes) {
        const doc = parseJson(path, files.get(path));
        const disabled = claudeProjectList(doc, paths.cwd, "disabledMcpServers");
        for (const server of readJsonServers(
          serverMap(doc, "mcpServers"),
          (name) => !disabled.includes(name),
        )) {
          if (!seen.has(server.name)) seen.set(server.name, server);
        }
      }
      const defaultHome = homes[0];
      const disabledProject =
        defaultHome === undefined
          ? []
          : claudeProjectList(
              parseJson(defaultHome, files.get(defaultHome)),
              paths.cwd,
              "disabledMcpjsonServers",
            );
      const project = parseJson(projectFile, files.get(projectFile));
      for (const server of readJsonServers(
        serverMap(project, "mcpServers"),
        (name) => !disabledProject.includes(name),
        "project",
      )) {
        if (!seen.has(server.name)) seen.set(server.name, server);
      }
      return [...seen.values()];
    },
    add: (files, input) =>
      editHomes(files, (doc) => setServer(doc, "mcpServers", input.name, claudeEntry(input))),
    remove: (files, name) =>
      editHomes(files, (doc) => {
        if (!(name in serverMap(doc, "mcpServers"))) return undefined;
        const without = deleteServer(doc, "mcpServers", name);
        const disabled = claudeProjectList(doc, paths.cwd, "disabledMcpServers");
        return disabled.includes(name)
          ? withClaudeProjectList(
              without,
              paths.cwd,
              "disabledMcpServers",
              toggled(disabled, name, false),
            )
          : without;
      }),
    setEnabled: (files, name, enabled) =>
      editHomes(files, (doc) => {
        if (!(name in serverMap(doc, "mcpServers"))) return undefined;
        const disabled = claudeProjectList(doc, paths.cwd, "disabledMcpServers");
        if (disabled.includes(name) === !enabled) return undefined;
        return withClaudeProjectList(
          doc,
          paths.cwd,
          "disabledMcpServers",
          toggled(disabled, name, !enabled),
        );
      }),
    entry: claudeEntry,
  };
}

// ── Codex and Grok (config.toml) ─────────────────────────────────────────

function tomlStore(
  driver: string,
  configs: ReadonlyArray<string>,
  entry: (input: McpServerAddInput) => Record<string, TomlPlain>,
): McpAgentStore {
  const edit = (files: McpFiles, change: (text: string, path: string) => string) =>
    configs.flatMap((path) => {
      const text = files.get(path) ?? "";
      parseToml(path, text);
      const next = change(text, path);
      return next === text ? [] : [{ path, text: next }];
    });
  return {
    driver: ProviderDriverKind.make(driver),
    paths: configs,
    read: (files) => {
      const seen = new Map<string, McpConfigServer>();
      for (const path of configs) {
        for (const [name, server] of Object.entries(parseToml(path, files.get(path)))) {
          const transport = decodeMcpTransport(server);
          if (transport === undefined || seen.has(name)) continue;
          seen.set(name, { name, transport, enabled: server["enabled"] !== false, scope: "user" });
        }
      }
      return [...seen.values()];
    },
    add: (files, input) =>
      edit(files, (text) =>
        appendTomlServer(
          removeTomlServer(text, "mcp_servers", input.name),
          "mcp_servers",
          input.name,
          entry(input),
        ),
      ),
    remove: (files, name) => edit(files, (text) => removeTomlServer(text, "mcp_servers", name)),
    setEnabled: (files, name, enabled) =>
      edit(files, (text, path) => {
        const server = parseToml(path, text)[name];
        if (server === undefined || (server["enabled"] !== false) === enabled) return text;
        return setTomlServerBoolean(text, "mcp_servers", name, "enabled", enabled);
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
  readonly path: string;
  readonly key: string;
  readonly enabled: (entry: JsonRecord) => boolean;
  readonly mark: (entry: JsonRecord, enabled: boolean) => JsonRecord;
  readonly entry: (input: McpServerAddInput) => JsonRecord;
}): McpAgentStore {
  const { path, key } = input;
  const edit = (files: McpFiles, change: (doc: JsonRecord) => JsonRecord | undefined) => {
    const next = change(parseJson(path, files.get(path)));
    return next === undefined ? [] : [{ path, text: encodeJson(next) }];
  };
  return {
    driver: ProviderDriverKind.make(input.driver),
    paths: [path],
    read: (files) =>
      readJsonServers(serverMap(parseJson(path, files.get(path)), key), (_name, entry) =>
        input.enabled(entry),
      ),
    add: (files, server) =>
      edit(files, (doc) => setServer(doc, key, server.name, input.entry(server))),
    remove: (files, name) =>
      edit(files, (doc) =>
        name in serverMap(doc, key) ? deleteServer(doc, key, name) : undefined,
      ),
    setEnabled: (files, name, enabled) =>
      edit(files, (doc) => {
        const entry = serverMap(doc, key)[name];
        if (!isRecord(entry) || input.enabled(entry) === enabled) return undefined;
        return setServer(doc, key, name, input.mark(entry, enabled));
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
    try {
      return strings(JSON.parse(text));
    } catch (cause) {
      throw new McpConfigParseError(
        disabledFile,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  };
  const markDisabled = (files: McpFiles, name: string, disabled: boolean): McpFileEdit[] => {
    const list = readDisabled(files);
    return list.includes(name) === disabled
      ? []
      : [{ path: disabledFile, text: encodeJson(toggled(list, name, disabled)) }];
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
    add: (files, input) => [
      {
        path: config,
        text: encodeJson(
          setServer(
            parseJson(config, files.get(config)),
            "mcpServers",
            input.name,
            cursorEntry(input),
          ),
        ),
      },
      ...markDisabled(files, input.name, false),
    ],
    remove: (files, name) => {
      const doc = parseJson(config, files.get(config));
      if (!(name in serverMap(doc, "mcpServers"))) return [];
      return [
        { path: config, text: encodeJson(deleteServer(doc, "mcpServers", name)) },
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

/** The store of each agent Mate can run, by driver. */
export function makeMcpAgentStores(
  paths: McpAgentPaths,
): ReadonlyMap<ProviderDriverKind, McpAgentStore> {
  const stores: McpAgentStore[] = [
    claudeStore(paths),
    tomlStore("codex", paths.codexConfigs, codexEntry),
    cursorStore(paths),
    tomlStore("grok", [paths.grokConfig], grokEntry),
    jsonStore({
      driver: "antigravity",
      path: paths.antigravityConfig,
      key: "mcpServers",
      enabled: (entry) => entry["disabled"] !== true,
      mark: (entry, enabled) => {
        const { disabled: _disabled, ...rest } = entry;
        return enabled ? rest : { ...rest, disabled: true };
      },
      entry: antigravityEntry,
    }),
    jsonStore({
      driver: "opencode",
      path: paths.openCodeConfig,
      key: "mcp",
      enabled: (entry) => entry["enabled"] !== false,
      mark: (entry, enabled) => ({ ...entry, enabled }),
      entry: openCodeEntry,
    }),
  ];
  return new Map(stores.map((store) => [store.driver, store]));
}
