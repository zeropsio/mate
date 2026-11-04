/**
 * A Mate's proposal to connect an MCP server for its agents, on its card: what it is, where it
 * connects and how it signs in; the keys it needs, typed by the person and never shown to the
 * agent; Add, which writes it for every agent the Mate runs (`mcp.servers.add`); then Sign in where
 * the conversation's agent waits for one. What the card shows after Add comes from the Mate's
 * server list, never from this tab's memory, so a reload draws it as it stands. The view is a list
 * of steps — approve, provide, connect — and one outcome line. Nothing here acts.
 */
import {
  PROVIDER_DISPLAY_NAMES,
  type McpServerAddInput,
  type McpServerAgent,
  type McpServerEntry,
  type McpServersList,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";

import type { ProposalStage } from "./proposal.logic";

export type McpProposal = Extract<ZeropsProposal, { kind: "mcp.add" }>;

/** Where the proposal stands: the person's decision, then the server as the Mate lists it. */
export type McpProposalStatus =
  | { readonly kind: "proposed" }
  /** Undecided, but a server of its name is set up here already. */
  | { readonly kind: "already" }
  | { readonly kind: "declined" }
  | { readonly kind: "adding" }
  /** Approved before a reload, and not listed: this tab did not see how it ended. */
  | { readonly kind: "unseen" }
  | { readonly kind: "add-failed"; readonly words: string }
  | { readonly kind: "reading" }
  | { readonly kind: "gone" }
  | { readonly kind: "connecting" }
  | { readonly kind: "needs-sign-in"; readonly agent: string }
  | { readonly kind: "connected"; readonly tools: number; readonly agents: ReadonlyArray<string> }
  | { readonly kind: "set-up"; readonly agents: ReadonlyArray<string> }
  | { readonly kind: "failed"; readonly words: string; readonly agent: string }
  | { readonly kind: "off" };

/** A sign-in the card started: the page it opened, and whether the person pastes where it landed. */
export type McpSigning =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" }
  | { readonly phase: "mate"; readonly url: string }
  | { readonly phase: "paste"; readonly url: string; readonly finishing: boolean };

export type McpProposalStep =
  /** Masked fields the person types: never the agent's, never in the chat. */
  | {
      readonly kind: "provide";
      readonly fields: ReadonlyArray<{
        readonly key: string;
        readonly label: string;
        readonly where: string;
      }>;
    }
  | { readonly kind: "approve"; readonly label: string; readonly blocked: string | null }
  | {
      readonly kind: "connect";
      readonly label: string;
      readonly agent: string;
      readonly signing: McpSigning;
    };

export interface McpProposalOutcome {
  readonly tone: "working" | "done" | "attention" | "failed" | "quiet";
  readonly words: string;
}

export interface McpProposalView {
  readonly title: string;
  readonly connects: string;
  /** How it signs in, while it is still to be added. */
  readonly signsIn: string | null;
  /** Who proposed it: the reason reads as its words. */
  readonly proposer: string;
  /** Why, in the Mate's words. */
  readonly reason: string | null;
  /** Proposed for more than this Mate: only this Mate is set up for now. */
  readonly scopeLine: string | null;
  readonly docsUrl: string | null;
  readonly steps: ReadonlyArray<McpProposalStep>;
  readonly outcome: McpProposalOutcome | null;
}

function agentName(driver: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driver] ?? driver;
}

/** "A", "A and B", "A, B and C". */
function names(list: ReadonlyArray<string>): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/** The most telling state first: what a card shows when no agent is the conversation's. */
const TELLING: ReadonlyArray<McpServerAgent["state"]> = [
  "failed",
  "needs-auth",
  "connecting",
  "connected",
  "configured",
  "disabled",
];

function entryOf(proposal: McpProposal, list: McpServersList): McpServerEntry | undefined {
  return list.servers.find((server) => server.name === proposal.params.server.name);
}

function toolCount(agents: ReadonlyArray<McpServerAgent>, agent: McpServerAgent): number {
  return agent.tools?.length ?? Math.max(0, ...agents.map((each) => each.tools?.length ?? 0));
}

/** How the server stands for the conversation's agent, or the most telling agent's state. */
function listedStatus(entry: McpServerEntry, driver: ProviderDriverKind | null): McpProposalStatus {
  const agent =
    (driver === null ? undefined : entry.agents.find((each) => each.driver === driver)) ??
    TELLING.map((state) => entry.agents.find((each) => each.state === state)).find(
      (each) => each !== undefined,
    );
  const agents = entry.agents.map((each) => agentName(each.driver));
  if (agent === undefined) return { kind: "set-up", agents };
  switch (agent.state) {
    case "connected":
      return { kind: "connected", tools: toolCount(entry.agents, agent), agents };
    case "connecting":
      return { kind: "connecting" };
    case "needs-auth":
      return { kind: "needs-sign-in", agent: agentName(agent.driver) };
    case "failed":
      return {
        kind: "failed",
        words: agent.error?.trim() || "It didn't start.",
        agent: agentName(agent.driver),
      };
    case "disabled":
      return { kind: "off" };
    case "configured":
      return { kind: "set-up", agents };
  }
}

/**
 * Where a proposal stands: undecided, declined or failed as the person's decision says; once
 * approved, as the Mate's server list shows the server — never what this tab remembers.
 */
export function mcpProposalStatus(input: {
  readonly proposal: McpProposal;
  readonly stage: ProposalStage;
  /** A failed approval's words, as HQ keeps them. */
  readonly failure: string | undefined;
  /** The Mate's servers; null until read. */
  readonly list: McpServersList | null;
  /** The conversation's agent: whose state the card carries. */
  readonly driver: ProviderDriverKind | null;
}): McpProposalStatus {
  const { proposal, stage, list, driver } = input;
  const entry = list === null ? undefined : entryOf(proposal, list);
  switch (stage) {
    case "open":
      return entry === undefined ? { kind: "proposed" } : { kind: "already" };
    case "declined":
      return { kind: "declined" };
    case "failed":
      return { kind: "add-failed", words: input.failure ?? "It wasn't added." };
    case "running":
    case "unseen":
    case "done":
      if (entry !== undefined) return listedStatus(entry, driver);
      if (stage === "running") return { kind: "adding" };
      if (list === null) return { kind: "reading" };
      return stage === "unseen" ? { kind: "unseen" } : { kind: "gone" };
  }
}

/** Why this Mate cannot add the server yet, or null where it can. */
export function mcpUnsupported(proposal: McpProposal, mateName: string): string | null {
  const { server } = proposal.params;
  if (server.transport.type === "sse") {
    return `${mateName} can't add a server that streams over SSE yet.`;
  }
  if (server.auth.kind === "oauth-app") {
    return `${mateName} can't sign in with an OAuth app you registered yet.`;
  }
  return null;
}

function connects(proposal: McpProposal): string {
  const { transport } = proposal.params.server;
  if (transport.type === "stdio") {
    return `Runs ${[transport.command, ...transport.args].join(" ")}`;
  }
  try {
    const url = new URL(transport.url);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `Connects to ${url.host}${path}`;
  } catch {
    return `Connects to ${transport.url}`;
  }
}

function signsIn(proposal: McpProposal): string {
  const { server, credentials } = proposal.params;
  const scopes =
    server.auth.scopes === undefined || server.auth.scopes.length === 0
      ? ""
      : ` (${server.auth.scopes.join(", ")})`;
  switch (server.auth.kind) {
    case "oauth":
      return `You sign in on ${server.title}'s page once it is added${scopes}`;
    case "oauth-app":
      return `Signs in with an OAuth app you registered${scopes}`;
    case "header":
      return "Signs in with the key you type here";
    case "none":
      return credentials.length === 0 ? "No sign-in" : "Uses the key you type here";
  }
}

function fieldWhere(field: McpProposal["params"]["credentials"][number]): string {
  return field.placement === "env"
    ? `Kept as ${field.key}`
    : `Sent as ${field.headerName ?? field.key}`;
}

const SCOPE_WORDS = { project: "the whole project", org: "the whole organization" } as const;

function outcomeOf(status: McpProposalStatus, title: string): McpProposalOutcome | null {
  switch (status.kind) {
    case "proposed":
      return null;
    case "already":
      return { tone: "quiet", words: `${title} is set up here already.` };
    case "declined":
      return { tone: "quiet", words: "Declined." };
    case "adding":
      return { tone: "working", words: `Adding ${title}…` };
    case "unseen":
      return { tone: "quiet", words: "Approved. This tab didn't see it added." };
    case "add-failed":
      return { tone: "failed", words: status.words };
    case "reading":
      return { tone: "working", words: "Reading the Mate's MCP servers…" };
    case "gone":
      return { tone: "quiet", words: `${title} is no longer set up here.` };
    case "connecting":
      return { tone: "working", words: `${title} is connecting…` };
    case "needs-sign-in":
      return {
        tone: "attention",
        words: `${title} is added. ${status.agent} waits for you to sign in.`,
      };
    case "connected":
      return {
        tone: "done",
        words: `${title} is connected for ${names(status.agents)} · ${String(status.tools)} ${status.tools === 1 ? "tool" : "tools"}`,
      };
    case "set-up":
      return { tone: "done", words: `${title} is added for ${names(status.agents)}` };
    case "failed":
      return { tone: "failed", words: `${status.agent}: ${status.words}` };
    case "off":
      return { tone: "quiet", words: `${title} is turned off.` };
  }
}

/** The card: its facts, the steps the person takes now, and how it stands. */
export function mcpProposalView(input: {
  readonly proposal: McpProposal;
  readonly mateName: string;
  readonly status: McpProposalStatus;
  readonly signing: McpSigning;
  /** Why Add cannot run yet (HQ, the list being read); absent when it can. */
  readonly approveBlocked: string | undefined;
}): McpProposalView {
  const { proposal, mateName, status } = input;
  const { server, credentials, scope } = proposal.params;
  const steps: McpProposalStep[] = [];
  if (status.kind === "proposed") {
    if (credentials.length > 0) {
      steps.push({
        kind: "provide",
        fields: credentials.map((field) => ({
          key: field.key,
          label: field.label,
          where: fieldWhere(field),
        })),
      });
    }
    steps.push({
      kind: "approve",
      label: "Add",
      blocked: mcpUnsupported(proposal, mateName) ?? input.approveBlocked ?? null,
    });
  }
  if (status.kind === "needs-sign-in") {
    steps.push({ kind: "connect", label: "Sign in", agent: status.agent, signing: input.signing });
  }
  return {
    title: `Set up ${server.title} for ${mateName}`,
    connects: connects(proposal),
    signsIn: status.kind === "proposed" ? signsIn(proposal) : null,
    proposer: mateName,
    reason: proposal.reason === undefined || proposal.reason.trim() === "" ? null : proposal.reason,
    scopeLine:
      scope === "mate"
        ? null
        : `Proposed for ${SCOPE_WORDS[scope]}. Only ${mateName} is set up for now.`,
    docsUrl: server.docsUrl ?? null,
    steps,
    outcome: outcomeOf(status, server.title),
  };
}

/**
 * The server as `mcp.servers.add` writes it for every agent: each key the person typed in its
 * place — a command's environment, a remote server's header after its prefix. Refused until every
 * key is typed, and where this Mate cannot add the server yet.
 */
export function mcpAddInput(
  proposal: McpProposal,
  values: Readonly<Record<string, string>>,
): { readonly input: McpServerAddInput } | { readonly refused: string } {
  const { server, credentials } = proposal.params;
  const unsupported = mcpUnsupported(proposal, "This Mate");
  if (unsupported !== null || server.transport.type === "sse") {
    return { refused: unsupported ?? "This Mate can't add it yet." };
  }
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const field of credentials) {
    const value = values[field.key]?.trim() ?? "";
    if (value === "") return { refused: `Type the ${field.label} first.` };
    if (field.placement === "env") env[field.key] = value;
    else headers[field.headerName ?? field.key] = `${field.prefix ?? ""}${value}`;
  }
  const transport =
    server.transport.type === "stdio"
      ? { type: "stdio" as const, command: server.transport.command, args: server.transport.args }
      : { type: "http" as const, url: server.transport.url };
  return {
    input: {
      name: server.name,
      transport,
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
    },
  };
}

const NOTE_PHRASE: Record<McpServerAgent["state"], (who: string) => string> = {
  connected: (who) => `connected for ${who}`,
  connecting: (who) => `connecting for ${who}`,
  "needs-auth": (who) => `added for ${who}, waiting for the person to sign in`,
  failed: (who) => `failed for ${who}`,
  disabled: (who) => `turned off for ${who}`,
  configured: (who) => `added for ${who}`,
};

/**
 * What the agent hears with the person's next message: which of the Mate's agents have the server
 * and how each stands, failures in their own words. Nothing for a server not listed.
 */
export function mcpTurnNote(proposal: McpProposal, list: McpServersList): string | null {
  const entry = entryOf(proposal, list);
  if (entry === undefined || entry.agents.length === 0) return null;
  const { name, title } = proposal.params.server;
  const groups: Array<{
    key: string;
    state: McpServerAgent["state"];
    error: string;
    who: string[];
  }> = [];
  for (const agent of entry.agents) {
    const error = agent.state === "failed" ? agent.error?.trim() || "it didn't start" : "";
    const key = `${agent.state}|${error}`;
    const group = groups.find((each) => each.key === key);
    if (group) group.who.push(agentName(agent.driver));
    else groups.push({ key, state: agent.state, error, who: [agentName(agent.driver)] });
  }
  const connected = entry.agents.find((agent) => agent.state === "connected");
  const tools = connected === undefined ? 0 : toolCount(entry.agents, connected);
  const toolsWords = tools > 0 ? `, ${String(tools)} ${tools === 1 ? "tool" : "tools"}` : "";
  const phrases = groups.map(
    (group) =>
      NOTE_PHRASE[group.state](names(group.who)) + (group.error === "" ? "" : `: ${group.error}`),
  );
  if (phrases.length === 1) {
    return `${title} is ${phrases[0]} (MCP server \`${name}\`${toolsWords}).`;
  }
  return `${title} (MCP server \`${name}\`${toolsWords}): ${phrases.join("; ")}.`;
}
