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
  /** The older server-sent-events transport, which some agents still speak and others don't. */
  Schema.Struct({
    type: Schema.Literal("sse"),
    url: TrimmedNonEmptyString,
  }),
]);
export type McpServerTransport = typeof McpServerTransport.Type;

/**
 * How a URL server signs in. `header`: an API key sent as one request header;
 * `oauth`: the agent signs in when the server asks (dynamic registration),
 * with optional scopes; `oauth-app`: sign in through the person's own
 * registered app. Secret values are written, never read back.
 */
export const McpServerAuth = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({
    kind: Schema.Literal("header"),
    name: TrimmedNonEmptyString,
    value: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    scopes: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth-app"),
    clientId: TrimmedNonEmptyString,
    clientSecret: Schema.optionalKey(TrimmedNonEmptyString),
    scopes: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  }),
]);
export type McpServerAuth = typeof McpServerAuth.Type;

/**
 * The redirect address a person registers in their own OAuth app, per agent
 * that signs in through one from Mate: Claude Code listens on a fixed port;
 * OpenCode is told this address and finishes from the code it carries.
 */
export const MCP_APP_REDIRECTS: Readonly<
  Record<string, { readonly port: number; readonly url: string }>
> = {
  claudeAgent: { port: 33418, url: "http://localhost:33418/callback" },
  opencode: { port: 33419, url: "http://127.0.0.1:33419/mcp/oauth/callback" },
};

/** What a server asks of an agent: its transport and how it signs in. */
export interface McpServerNeeds {
  readonly transport: McpServerTransport;
  readonly auth?: McpServerAuth | McpServerAuthView | undefined;
}

const MCP_AGENT_NAMES: Readonly<Record<string, string>> = {
  claudeAgent: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  grok: "Grok",
  antigravity: "Antigravity",
};

/**
 * Why an agent can't use a server as it is set up, or `null` when it can: the one table the
 * Mate's config writers and the tab's add card both read, checked against each agent's installed
 * CLI and SDK types. SSE: Claude Code and Cursor only (the installed OpenCode speaks streamable
 * HTTP alone). An own app: Claude Code without a secret (it keeps one in its own store), Cursor
 * and OpenCode; Codex picks a new sign-in port each time.
 */
export function mcpAgentCannot(driver: string, needs: McpServerNeeds): string | null {
  const agent = MCP_AGENT_NAMES[driver] ?? driver;
  const sse = needs.transport.type === "sse";
  const app = needs.auth?.kind === "oauth-app";
  const secret =
    needs.auth?.kind === "oauth-app" &&
    ("secret" in needs.auth ? needs.auth.secret : needs.auth.clientSecret !== undefined);
  switch (driver) {
    case "claudeAgent":
      return secret ? "Claude Code can't take your app's client secret from Mate." : null;
    case "cursor":
      return null;
    case "opencode":
      return sse ? "OpenCode can't use SSE servers." : null;
    case "codex":
      if (sse) return "Codex can't use SSE servers.";
      return app
        ? "Codex can't sign in with your own app: it picks a new sign-in address each time, which an app can't register."
        : null;
    default:
      if (sse) return `${agent} can't use SSE servers.`;
      return app ? `${agent} can't sign in with your own app.` : null;
  }
}

/**
 * What each agent's config can take, as Mate writes it: an SSE server, a sign-in through the
 * person's own OAuth app, and that app's client secret. The server's writers refuse exactly what
 * this says (held equal by `mcpAgents.test.ts`); a card names who can't before it is added.
 */
export const MCP_AGENT_LIMITS: Readonly<
  Record<
    string,
    { readonly sse: boolean; readonly ownApp: boolean; readonly ownAppSecret: boolean }
  >
> = {
  claudeAgent: { sse: true, ownApp: true, ownAppSecret: false },
  codex: { sse: false, ownApp: false, ownAppSecret: false },
  cursor: { sse: true, ownApp: true, ownAppSecret: true },
  grok: { sse: false, ownApp: false, ownAppSecret: false },
  antigravity: { sse: false, ownApp: false, ownAppSecret: false },
  opencode: { sse: false, ownApp: true, ownAppSecret: true },
};

/**
 * A URL server's sign-in as the agents' configs hold it, without its secret:
 * the app's client id and scopes, and whether a client secret is stored.
 */
export const McpServerAuthView = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("oauth"),
    scopes: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("oauth-app"),
    clientId: Schema.String,
    scopes: Schema.Array(Schema.String),
    secret: Schema.Boolean,
  }),
  /** Told not to sign in (OpenCode's `oauth: false`). */
  Schema.Struct({ kind: Schema.Literal("none") }),
]);
export type McpServerAuthView = typeof McpServerAuthView.Type;

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
  /**
   * Whether the agent holds an OAuth sign-in for the server, where it says
   * (Codex); absent where it can't tell.
   */
  signedIn: Schema.optionalKey(Schema.Boolean),
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
  /**
   * The names of its environment variables (a command) or request headers
   * (a URL), across the agents: never their values.
   */
  secretNames: Schema.optionalKey(Schema.Array(Schema.String)),
  /** How it signs in, as the agents' configs say: never a secret. */
  auth: Schema.optionalKey(McpServerAuthView),
  /** The installed agents that can't use it as it is set up, each with why. */
  cannot: Schema.optionalKey(
    Schema.Array(Schema.Struct({ driver: ProviderDriverKind, reason: Schema.String })),
  ),
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
  /** How a URL server signs in; absent is the agents' own default. */
  auth: Schema.optionalKey(McpServerAuth),
  /** The conversation whose running agent the answering list asks for live state. */
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerAddInput = typeof McpServerAddInput.Type;

export const McpServerTargetInput = Schema.Struct({
  name: McpServerName,
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerTargetInput = typeof McpServerTargetInput.Type;

/**
 * A server's environment (a command) or request headers (a URL), replaced
 * for every agent. A name in `keep` keeps the value already stored, which the
 * tab never sees; a name in neither is dropped.
 */
export const McpServerUpdateInput = Schema.Struct({
  name: McpServerName,
  values: Schema.Record(Schema.String, Schema.String),
  keep: Schema.Array(Schema.String),
  /**
   * A URL server's sign-in, changed: `none`, `oauth` or `oauth-app`; an
   * `oauth-app` without a client secret keeps the one stored. An API key is a
   * header, changed through `values`. Absent leaves the sign-in as it is.
   */
  auth: Schema.optionalKey(McpServerAuth),
  threadId: Schema.optionalKey(ThreadId),
});
export type McpServerUpdateInput = typeof McpServerUpdateInput.Type;

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
