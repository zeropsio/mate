/**
 * A Mate's proposal to connect an MCP server for its agents, on its card: what it is, where it
 * connects and how it signs in; the keys it needs, typed by the person and never shown to the
 * agent; Add, which writes it for every agent the Mate runs (`mcp.servers.add`); then Sign in where
 * the conversation's agent waits for one. What the card shows after Add comes from the Mate's
 * server list, never from this tab's memory, so a reload draws it as it stands. The view is a list
 * of steps — approve, provide, connect — and one outcome line. Nothing here acts.
 */
import {
  MCP_AGENT_LIMITS,
  MCP_APP_REDIRECTS,
  PROVIDER_DISPLAY_NAMES,
  type McpServerAddInput,
  type McpServerAgent,
  type McpServerEntry,
  type McpServersList,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import type { ZeropsProposal } from "@t3tools/client-runtime/zerops/model";

import { type AskState, notNowWords } from "../../ask/ask.logic";
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

/** One value the person types: a key (hidden), or their own app's client ID (shown). */
export interface McpProposalField {
  readonly key: string;
  readonly label: string;
  readonly where: string;
  readonly hidden: boolean;
  /** Left empty, nothing is sent (an app with no client secret). */
  readonly optional: boolean;
}

export type McpProposalStep =
  /** Masked fields the person types: never the agent's, never in the chat. */
  | {
      readonly kind: "provide";
      readonly fields: ReadonlyArray<McpProposalField>;
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
  /** The installed agents that can't use it as proposed, saying why; `null` when all can. */
  readonly cannot: string | null;
  /** Where its own app sends each agent back: the addresses the person registers in it. */
  readonly redirects: ReadonlyArray<{ readonly agent: string; readonly url: string }>;
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

/** What the proposal asks of an agent's config: an SSE server, or a sign-in through an own app. */
function needs(proposal: McpProposal): "sse" | "ownApp" | null {
  const { server } = proposal.params;
  if (server.transport.type === "sse") return "sse";
  return server.auth.kind === "oauth-app" ? "ownApp" : null;
}

/** Whether an agent can take what the proposal needs; an agent the table doesn't name can. */
const canTake = (driver: ProviderDriverKind, need: "sse" | "ownApp"): boolean =>
  MCP_AGENT_LIMITS[driver]?.[need] ?? true;

const CANNOT_WORDS = {
  sse: "can't use SSE servers",
  ownApp: "can't sign in with your own app",
} as const;

/**
 * The installed agents that can't use the server as proposed, by name and why (`MCP_AGENT_LIMITS`,
 * what each agent's config can take); `null` where every one can.
 */
export function mcpCannot(
  proposal: McpProposal,
  agents: ReadonlyArray<ProviderDriverKind>,
): string | null {
  const need = needs(proposal);
  if (need === null) return null;
  const unable = agents.filter((driver) => !canTake(driver, need)).map(agentName);
  return unable.length === 0 ? null : `${names(unable)} ${CANNOT_WORDS[need]}.`;
}

/** Why this Mate cannot add the server: none of its installed agents can use it; null where one can. */
export function mcpUnsupported(
  proposal: McpProposal,
  mateName: string,
  agents: ReadonlyArray<ProviderDriverKind>,
): string | null {
  const need = needs(proposal);
  if (need === null || agents.some((driver) => canTake(driver, need))) return null;
  return `None of ${mateName}'s agents ${CANNOT_WORDS[need].replace("can't", "can")}.`;
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

/** The fields its own app's sign-in takes: the client ID, and a client secret where it has one. */
export const MCP_APP_CLIENT_ID = "oauth-app:clientId";
export const MCP_APP_CLIENT_SECRET = "oauth-app:clientSecret";

function fieldsOf(proposal: McpProposal): ReadonlyArray<McpProposalField> {
  const { server, credentials } = proposal.params;
  const keys = credentials.map((field) => ({
    key: field.key,
    label: field.label,
    where: fieldWhere(field),
    hidden: true,
    optional: false,
  }));
  if (server.auth.kind !== "oauth-app") return keys;
  const where = "Kept in each agent's config";
  return [
    ...keys,
    {
      key: MCP_APP_CLIENT_ID,
      label: "Your app's client ID",
      where,
      hidden: false,
      optional: false,
    },
    {
      key: MCP_APP_CLIENT_SECRET,
      label: "Your app's client secret, if it has one",
      where,
      hidden: true,
      optional: true,
    },
  ];
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
  /** The agents installed in the Mate, as its server list says: who the server is written for. */
  readonly agents: ReadonlyArray<ProviderDriverKind>;
}): McpProposalView {
  const { proposal, mateName, status, agents } = input;
  const { server, scope } = proposal.params;
  const steps: McpProposalStep[] = [];
  const proposed = status.kind === "proposed";
  if (proposed) {
    const fields = fieldsOf(proposal);
    if (fields.length > 0) steps.push({ kind: "provide", fields });
    steps.push({
      kind: "approve",
      label: `Add ${server.title}`,
      blocked: mcpUnsupported(proposal, mateName, agents) ?? input.approveBlocked ?? null,
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
    cannot: proposed ? mcpCannot(proposal, agents) : null,
    redirects:
      proposed && server.auth.kind === "oauth-app"
        ? agents.flatMap((driver) => {
            const redirect = MCP_APP_REDIRECTS[driver];
            return redirect === undefined || !canTake(driver, "ownApp")
              ? []
              : [{ agent: agentName(driver), url: redirect.url }];
          })
        : [],
  };
}

/**
 * The server as `mcp.servers.add` writes it for every agent: each key the person typed in its
 * place — a command's environment, a remote server's header after its prefix —, its transport
 * (stdio, streamable HTTP or SSE) and its sign-in (the agents' own, or the person's own app with
 * the client ID they typed). Refused until every field it needs is typed, and where none of the
 * Mate's agents can use it.
 */
export function mcpAddInput(
  proposal: McpProposal,
  values: Readonly<Record<string, string>>,
  agents: ReadonlyArray<ProviderDriverKind>,
): { readonly input: McpServerAddInput } | { readonly refused: string } {
  const { server, credentials } = proposal.params;
  const unsupported = mcpUnsupported(proposal, "this Mate", agents);
  if (unsupported !== null) return { refused: unsupported };
  const typed = (key: string) => values[key]?.trim() ?? "";
  for (const field of credentials) {
    if (typed(field.key) === "") return { refused: `Type the ${field.label} first.` };
  }
  if (server.auth.kind === "oauth-app" && typed(MCP_APP_CLIENT_ID) === "") {
    return { refused: "Give your app's client ID." };
  }
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (const field of credentials) {
    if (field.placement === "env") env[field.key] = typed(field.key);
    else headers[field.headerName ?? field.key] = `${field.prefix ?? ""}${typed(field.key)}`;
  }
  const transport =
    server.transport.type === "stdio"
      ? { type: "stdio" as const, command: server.transport.command, args: server.transport.args }
      : { type: server.transport.type, url: server.transport.url };
  const scopes =
    server.auth.scopes === undefined || server.auth.scopes.length === 0
      ? {}
      : { scopes: server.auth.scopes };
  const secret = typed(MCP_APP_CLIENT_SECRET);
  const auth =
    // Signing in when the server asks is every agent's own default: said only with scopes.
    server.auth.kind === "oauth"
      ? "scopes" in scopes
        ? { auth: { kind: "oauth" as const, ...scopes } }
        : {}
      : server.auth.kind === "oauth-app"
        ? {
            auth: {
              kind: "oauth-app" as const,
              clientId: typed(MCP_APP_CLIENT_ID),
              ...(secret === "" ? {} : { clientSecret: secret }),
              ...scopes,
            },
          }
        : {};
  return {
    input: {
      name: server.name,
      transport,
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
      ...(transport.type === "stdio" ? {} : auth),
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

// ---------------------------------------------------------------------------
// The proposal on the ask card
// ---------------------------------------------------------------------------

/** What the card says while the person finishes a sign-in on the provider's page. */
export const MCP_SIGN_IN_ELSEWHERE = "Finish signing in on the page that opened.";

/** The presses an MCP ask offers in its state, beside the state's words. */
export interface McpAskFace {
  readonly state: AskState;
  /** The main press and what it does; a working press keeps its place, held. */
  readonly main: { readonly label: string; readonly does: "add" | "signIn" | "finish" } | null;
  /** Not now, while the proposal is undecided. */
  readonly notNow: boolean;
  /** The one press beside a line: open the sign-in page again, or sign in again. */
  readonly action: "openAgain" | "signInAgain" | null;
  /** A quiet note after the presses ("as Claude"). */
  readonly note: string | null;
}

/**
 * The card's state from where the server stands (`mcpProposalStatus`: HQ's decision, then the
 * Mate's server list) and the sign-in this card started: undecided with Add and Not now, adding,
 * waiting for a sign-in with Sign in — then the provider's page, or the paste fallback with
 * Finish —, connected or added, failed in the server's words, Not now with who and when, or a
 * line for what took its place.
 */
export function mcpAskFace(input: {
  readonly view: McpProposalView;
  readonly status: McpProposalStatus;
  readonly signing: McpSigning;
  /** An Add pressed here, still on its way. */
  readonly busy: boolean;
  readonly title: string;
  /** Whether it signs in when asked (OAuth): a failure may be a sign-in run out. */
  readonly signsIn: boolean;
  /** Who said Not now, by name, and when. */
  readonly by: string | null;
  readonly at: string | null;
}): McpAskFace {
  const { status, signing, title } = input;
  const add = { label: `Add ${title}`, does: "add" } as const;
  const none = { main: null, notNow: false, action: null, note: null } as const;
  const words = input.view.outcome?.words ?? "";
  switch (status.kind) {
    case "proposed":
      return input.busy
        ? {
            ...none,
            main: add,
            state: { kind: "working", words: `Adding ${title}…`, pressed: "main" },
          }
        : { ...none, main: add, notNow: true, state: { kind: "waiting" } };
    case "adding":
      return { ...none, main: add, state: { kind: "working", words, pressed: "main" } };
    case "reading":
    case "connecting":
      return { ...none, state: { kind: "working", words, pressed: null } };
    case "needs-sign-in": {
      const note = `as ${status.agent}`;
      const signIn = { label: `Sign in to ${title}`, does: "signIn" } as const;
      switch (signing.phase) {
        case "idle":
          return { ...none, main: signIn, note, state: { kind: "waiting" } };
        case "starting":
          return {
            ...none,
            main: signIn,
            state: { kind: "working", words: "Signing in…", pressed: "main" },
          };
        case "mate":
          return {
            ...none,
            action: "openAgain",
            state: { kind: "working", words: MCP_SIGN_IN_ELSEWHERE, pressed: null },
          };
        case "paste": {
          const finish = { label: "Finish", does: "finish" } as const;
          return signing.finishing
            ? {
                ...none,
                main: finish,
                state: { kind: "working", words: "Finishing…", pressed: "main" },
              }
            : { ...none, main: finish, state: { kind: "waiting" } };
        }
      }
      break;
    }
    case "connected":
    case "set-up":
    case "already":
      return { ...none, state: { kind: "done", words: words.replace(/\.$/u, ""), told: null } };
    case "failed":
      return {
        ...none,
        action: input.signsIn ? "signInAgain" : null,
        state: { kind: "failed", words },
      };
    case "add-failed":
      return { ...none, state: { kind: "failed", words } };
    case "declined":
      return { ...none, state: { kind: "notNow", words: notNowWords(input.by, input.at) } };
    case "unseen":
    case "gone":
    case "off":
      return { ...none, state: { kind: "replaced", words } };
  }
  return { ...none, state: { kind: "waiting" } };
}

/**
 * A server that signs in when asked is two steps whose order is real — add it, then sign in —
 * numbered on the card, each as far as it got; `null` for one Add alone does.
 */
export function mcpProgress(
  proposal: McpProposal,
  status: McpProposalStatus,
  agent: string | null,
): ReadonlyArray<{
  readonly id: "add" | "sign-in";
  readonly label: string;
  readonly detail: string | null;
  readonly state: "done" | "now" | "next";
  readonly end: string | undefined;
}> | null {
  const { server } = proposal.params;
  if (server.auth.kind !== "oauth" && server.auth.kind !== "oauth-app") return null;
  // Not now leaves nothing to do: no steps.
  if (status.kind === "declined") return null;
  const added = status.kind !== "proposed" && status.kind !== "adding";
  const signedIn = status.kind === "connected";
  const address = connects(proposal).replace(/^(Connects to|Runs) /u, "");
  return [
    {
      id: "add",
      label: `Add ${server.title}`,
      detail: address,
      state: added ? "done" : "now",
      end: added ? "Added" : undefined,
    },
    {
      id: "sign-in",
      label: `Sign in to ${server.title}`,
      detail: agent === null ? "as you" : `as you; ${agent} uses your access`,
      state: signedIn ? "done" : added ? "now" : "next",
      end: signedIn ? "Signed in" : undefined,
    },
  ];
}
