/**
 * The MCP servers a Mate's agents can use, as the MCP tab shows and changes
 * them.
 *
 * One entry per server name, merged across every agent installed in the
 * container: a server is added for all of them at once, so whichever agent a
 * conversation runs on has the same tools. Each agent says whether it has the
 * server and, when it can tell, how the server stands there — Claude Code,
 * Codex and OpenCode report live state; an agent that cannot is `configured`.
 *
 * @module mcpServers
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

/** A key every agent's config accepts (TOML table, JSON key, CLI flag). */
export const McpServerName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type McpServerName = typeof McpServerName.Type;

export const McpServerTransport = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString,
    args: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("http"),
    url: TrimmedNonEmptyString,
  }),
]);
export type McpServerTransport = typeof McpServerTransport.Type;

/**
 * How a server stands for one agent. `configured`: the agent has it but
 * cannot say how it is doing (the ACP agents, or no running session to ask).
 */
export const McpServerState = Schema.Literals([
  "connected",
  "connecting",
  "needs-auth",
  "failed",
  "disabled",
  "configured",
]);
export type McpServerState = typeof McpServerState.Type;

export const McpServerTool = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  readOnly: Schema.optionalKey(Schema.Boolean),
  destructive: Schema.optionalKey(Schema.Boolean),
});
export type McpServerTool = typeof McpServerTool.Type;

export const McpServerAgent = Schema.Struct({
  driver: ProviderDriverKind,
  state: McpServerState,
  error: Schema.optionalKey(Schema.String),
  tools: Schema.optionalKey(Schema.Array(McpServerTool)),
});
export type McpServerAgent = typeof McpServerAgent.Type;

export const McpServerEntry = Schema.Struct({
  name: McpServerName,
  transport: McpServerTransport,
  /** Written by Zerops (zcp's `zerops`): shown and reconnected, never edited or removed here. */
  managed: Schema.Boolean,
  /**
   * Where the server is configured: `user`, each agent's own config, which
   * the tab edits; `project`, the repo's `.mcp.json`, shown read-only and
   * edited there. Absent means `user`.
   */
  scope: Schema.optionalKey(Schema.Literals(["user", "project"])),
  agents: Schema.Array(McpServerAgent),
});
export type McpServerEntry = typeof McpServerEntry.Type;

export const McpServersListInput = Schema.Struct({
  /** The conversation whose running agent is asked for live state. */
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServersListInput = typeof McpServersListInput.Type;

export const McpServersList = Schema.Struct({
  servers: Schema.Array(McpServerEntry),
  /** The agents installed here: the ones an added server is written for. */
  agents: Schema.Array(ProviderDriverKind),
});
export type McpServersList = typeof McpServersList.Type;

export const McpServerAddInput = Schema.Struct({
  name: McpServerName,
  transport: McpServerTransport,
  /** A command's environment (API keys); stdio only. */
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** A URL's request headers (bearer tokens); http only. */
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  /** The conversation whose running agent the answering list asks for live state. */
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerAddInput = typeof McpServerAddInput.Type;

export const McpServerTargetInput = Schema.Struct({
  name: McpServerName,
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerTargetInput = typeof McpServerTargetInput.Type;

export const McpServerSetEnabledInput = Schema.Struct({
  name: McpServerName,
  enabled: Schema.Boolean,
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerSetEnabledInput = typeof McpServerSetEnabledInput.Type;

/**
 * Sign in to a remote server that answers "needs sign-in" for the
 * conversation's agent: the agent starts its own OAuth flow, and the person
 * completes it in their own browser.
 */
export const McpServerSignInInput = McpServerTargetInput;
export type McpServerSignInInput = typeof McpServerSignInInput.Type;

/**
 * Where the browser comes back after the provider's page: `mate`, this Mate's
 * own sign-in page, which hands the agent the result by itself; `paste`, the
 * agent's listener inside the container, which the person's browser cannot
 * reach — they paste the address it landed on into the tab instead.
 */
export const McpSignInLanding = Schema.Literals(["mate", "paste"]);
export type McpSignInLanding = typeof McpSignInLanding.Type;

export const McpServerSignIn = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("open"),
    /** The provider's page the person signs in on. */
    url: TrimmedNonEmptyString,
    landing: McpSignInLanding,
    /** Names this sign-in when the person pastes where it landed. */
    flow: TrimmedNonEmptyString,
  }),
  /** The agent already holds a valid sign-in: nothing to open. */
  Schema.Struct({ kind: Schema.Literal("signed-in") }),
]);
export type McpServerSignIn = typeof McpServerSignIn.Type;

export const McpServerFinishSignInInput = Schema.Struct({
  name: McpServerName,
  flow: TrimmedNonEmptyString,
  /** The address the browser landed on after the provider's page. */
  landed: TrimmedNonEmptyString,
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerFinishSignInInput = typeof McpServerFinishSignInInput.Type;

export class McpServersError extends Schema.TaggedError<McpServersError>()("McpServersError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
