/**
 * Where each agent Mate runs keeps its MCP config on this machine, resolved
 * the way its driver resolves its home (`spi/driverHomes.ts`): every Claude
 * home (`homePath`, else `CLAUDE_CONFIG_DIR`, else `~`), every Codex home
 * (`homePath`, else `CODEX_HOME`, else `~/.codex`; a login's shadow home links
 * to its shared one), and the Antigravity profiles that keep a file of their
 * own instead of the link to `~/.gemini`.
 *
 * @module mcpAgentPaths
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  antigravityProfileDirectory,
  claudeHomePath,
  codexHomeLayout,
  providerInstanceEnvironment,
} from "../../spi/driverHomes.ts";
import type { McpAgentPaths } from "./mcpAgents.ts";

type Env = Readonly<Record<string, string | undefined>>;

const configString = (config: unknown, field: string): string => {
  if (typeof config !== "object" || config === null) return "";
  const value = (config as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
};

const trimSlash = (value: string): string => (value.length > 1 ? value.replace(/\/+$/, "") : value);

const unique = (values: ReadonlyArray<string>): string[] => [...new Set(values)];

/** The paths that need no home resolution, around the resolved ones. */
export function mcpAgentPaths(input: {
  readonly homeDir: string;
  readonly cwd: string;
  readonly env: Env;
  readonly claudeConfigs: ReadonlyArray<string>;
  readonly codexConfigs: ReadonlyArray<string>;
  readonly antigravityConfigs: ReadonlyArray<string>;
}): McpAgentPaths {
  const { homeDir, env } = input;
  const grokHome = env["GROK_HOME"]?.trim() || `${homeDir}/.grok`;
  const configHome = env["XDG_CONFIG_HOME"]?.trim() || `${homeDir}/.config`;
  return {
    cwd: trimSlash(input.cwd),
    claudeConfigs: unique(input.claudeConfigs),
    codexConfigs: unique(input.codexConfigs),
    cursorHome: `${homeDir}/.cursor`,
    grokConfig: `${trimSlash(grokHome)}/config.toml`,
    antigravityConfigs: unique(input.antigravityConfigs),
    openCodeConfig: `${trimSlash(configHome)}/opencode/opencode.json`,
  };
}

export const resolveMcpAgentPaths = Effect.fn("resolveMcpAgentPaths")(function* (input: {
  readonly homeDir: string;
  readonly cwd: string;
  /** The server's state directory, where the Antigravity profiles live. */
  readonly stateDir: string;
  readonly env: Env;
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { homeDir, settings } = input;
  const env = input.env as NodeJS.ProcessEnv;
  const instancesOf = (driver: string): ReadonlyArray<readonly [string, ProviderInstanceConfig]> =>
    Object.entries(settings.providerInstances).filter(([, instance]) => instance.driver === driver);
  const instanceEnv = (instance: ProviderInstanceConfig) =>
    providerInstanceEnvironment(instance.environment, env);

  // Claude: `$CLAUDE_CONFIG_DIR/.claude.json` for a home, `~/.claude.json` without one.
  const claudeSources = [
    { homePath: settings.providers.claudeAgent.homePath, env },
    ...instancesOf("claudeAgent").map(([, instance]) => ({
      homePath: configString(instance.config, "homePath"),
      env: instanceEnv(instance),
    })),
  ];
  const claudeConfigs: string[] = [];
  for (const source of claudeSources) {
    const configured = source.homePath.trim() || source.env["CLAUDE_CONFIG_DIR"]?.trim() || "";
    claudeConfigs.push(
      configured.length === 0
        ? path.join(homeDir, ".claude.json")
        : path.join(yield* claudeHomePath({ homePath: configured }), ".claude.json"),
    );
  }

  // Codex: the shared home's `config.toml`, which a login's shadow home links to.
  const codexSources = [
    {
      homePath: settings.providers.codex.homePath,
      shadowHomePath: settings.providers.codex.shadowHomePath,
      env,
    },
    ...instancesOf("codex").map(([, instance]) => ({
      homePath: configString(instance.config, "homePath"),
      shadowHomePath: configString(instance.config, "shadowHomePath"),
      env: instanceEnv(instance),
    })),
  ];
  const codexConfigs: string[] = [];
  for (const source of codexSources) {
    const layout = yield* codexHomeLayout({
      ...settings.providers.codex,
      homePath: source.homePath,
      shadowHomePath: source.shadowHomePath,
    });
    const inherited = source.env["CODEX_HOME"]?.trim() ?? "";
    // Without a home of its own the driver leaves CODEX_HOME as the server inherited it.
    const home =
      layout.mode === "direct" && source.homePath.trim().length === 0 && inherited.length > 0
        ? path.resolve(inherited)
        : layout.sharedHomePath;
    codexConfigs.push(path.join(home, "config.toml"));
  }

  // Antigravity: Mate's profile links `config/mcp_config.json` to `~/.gemini`'s; a profile
  // that holds a file of its own reads that one.
  const userAntigravity = path.join(homeDir, ".gemini", "config", "mcp_config.json");
  const antigravityIds = unique([
    defaultInstanceIdForDriver(ProviderDriverKind.make("antigravity")),
    ...instancesOf("antigravity").map(([id]) => id),
  ]);
  const antigravityConfigs = [userAntigravity];
  for (const id of antigravityIds) {
    const own = path.join(
      antigravityProfileDirectory(input.stateDir, ProviderInstanceId.make(id)),
      "config",
      "mcp_config.json",
    );
    const isLink = yield* fs.readLink(own).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    const exists = yield* fs.exists(own).pipe(Effect.catch(() => Effect.succeed(false)));
    if (exists && !isLink) antigravityConfigs.push(own);
  }

  return mcpAgentPaths({
    homeDir,
    cwd: input.cwd,
    env: input.env,
    claudeConfigs,
    codexConfigs,
    antigravityConfigs,
  });
});
