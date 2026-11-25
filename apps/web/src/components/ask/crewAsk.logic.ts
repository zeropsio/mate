/**
 * A crew a Mate sets up in its answer, as a `crew-ask` fence: the goal it works to and who is on
 * it — each crewmate's name, role and part, and the agent, model and effort it runs on. The card
 * reads that crew on this Mate's own sign-ins: an agent it isn't signed in to runs on one it is,
 * and the card says so. Its press opens the Crew tab's setup filled in with it, to change and
 * start there.
 */
import { ZEROPS_AGENT_NAMES } from "@t3tools/client-runtime/zerops/agentSignIn";
import {
  agentIdForDriverKind,
  isZeropsAgentId,
  type CrewMemberKind,
  type ServerProvider,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import type { CrewAskSeat } from "@t3tools/shared/crewTemplates";

import {
  crewEffortOptions,
  crewLoginOptions,
  crewModelOptions,
} from "../zerops/crew/CrewEditors.logic";
import { askKeyOf, namesWords } from "./ask.logic";

/** The roles a fence names, as the crew's kinds: a builder changes files, a reviewer reads. */
const ROLES: Readonly<Record<string, CrewMemberKind>> = {
  lead: "lead",
  builder: "writer",
  reviewer: "reader",
};

/** A crew of eight tints, one of them the Mate's. */
const MOST_CREWMATES = 7;
const LONGEST_NAME = 40;
const LONGEST_PART = 240;
const LONGEST_TEXT = 4000;

/** One crewmate as the Mate set it up: its agent, model and effort as the Mate named them. */
export interface CrewAskCrewmate {
  readonly name: string;
  readonly kind: CrewMemberKind;
  /** One line: what it is responsible for. */
  readonly part: string;
  readonly agent: string | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
}

export interface CrewAsk {
  /** The ask's name in its conversation: the same fence is the same ask. */
  readonly key: string;
  /** A verb and its subject: "Set up a crew for the checkout". */
  readonly title: string;
  readonly why: string | undefined;
  /** What the crew builds and why, as the setup's goal says it. */
  readonly goal: string;
  readonly crew: ReadonlyArray<CrewAskCrewmate>;
}

function text(value: unknown, longest: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, longest);
}

/** One line of words, as a row says it: its breaks folded into spaces. */
const line = (value: unknown, longest: number): string | undefined =>
  text(typeof value === "string" ? value.replace(/\s+/gu, " ") : value, longest);

function crewmateOf(value: unknown): CrewAskCrewmate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  const name = line(fields.name, LONGEST_NAME);
  const part = line(fields.part, LONGEST_PART);
  const kind = typeof fields.role === "string" ? ROLES[fields.role] : undefined;
  if (name === undefined || part === undefined || kind === undefined) return null;
  return {
    name,
    kind,
    part,
    agent: line(fields.agent, LONGEST_NAME)?.toLowerCase(),
    model: line(fields.model, LONGEST_PART),
    effort: line(fields.effort, LONGEST_NAME)?.toLowerCase(),
  };
}

/** The crew a `crew-ask` fence sets up, or `null` for words that set up none. */
export function parseCrewAsk(source: string): CrewAsk | null {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const title = line(fields.title, LONGEST_PART);
  const goal = text(fields.goal, LONGEST_TEXT);
  if (title === undefined || goal === undefined || !Array.isArray(fields.crew)) return null;
  const crew = fields.crew.map(crewmateOf);
  if (
    crew.length === 0 ||
    crew.length > MOST_CREWMATES ||
    crew.some((crewmate) => crewmate === null) ||
    crew.filter((crewmate) => crewmate?.kind === "lead").length > 1
  ) {
    return null;
  }
  return {
    key: askKeyOf(source.trim()),
    title,
    why: text(fields.why, LONGEST_TEXT),
    goal,
    crew: crew as ReadonlyArray<CrewAskCrewmate>,
  };
}

/** What the goal says before its first heading: what the crew builds and why. */
export const crewAskGoalLead = (goal: string): string =>
  (goal.split(/^#{1,6}\s/mu)[0] ?? goal).trim() || goal;

/** An agent as a fence names it, as its driver: Claude Code's is `claudeAgent`. */
const driverOf = (agent: string): string =>
  agent === "claude" || agent === "claude-code" ? "claudeAgent" : agent;

/** An agent's name for the person: "Codex", "OpenCode". */
function agentName(agent: string): string {
  const id = agentIdForDriverKind(driverOf(agent));
  if (id !== undefined) return ZEROPS_AGENT_NAMES[id];
  if (isZeropsAgentId(agent)) return ZEROPS_AGENT_NAMES[agent];
  return agent === "opencode" ? "OpenCode" : agent;
}

/** An agent the Mate named that this Mate isn't signed in to. */
export interface CrewAskMissingAgent {
  readonly name: string;
  /** Its driver, for its mark. */
  readonly driver: string;
  /** The agent Mate signs people in to; `undefined` for one it signs nobody in to (OpenCode). */
  readonly agentId: ZeropsAgentId | undefined;
}

/**
 * What a crewmate runs on among this Mate's sign-ins: the login of the agent the Mate named, the
 * model it named there (by id or name), and the effort that model offers (by id or name). An agent
 * it isn't signed in to runs on its first login that may (a lead's hosts the crew tools), and
 * `missing` names that agent; `login` is `null` only where no login may.
 */
export interface CrewAskRunsOn {
  readonly login: {
    readonly id: string;
    readonly label: string;
    /** Its driver, for its mark. */
    readonly driver: string | undefined;
  } | null;
  readonly model: { readonly slug: string; readonly name: string } | null;
  readonly effort: { readonly id: string; readonly label: string } | null;
  readonly missing: CrewAskMissingAgent | null;
}

export function crewAskRunsOn(
  crewmate: CrewAskCrewmate,
  providers: ReadonlyArray<ServerProvider>,
): CrewAskRunsOn {
  const driverOfLogin = (id: string) =>
    providers.find((provider) => provider.instanceId === id)?.driver;
  const logins = crewLoginOptions(providers, crewmate.kind === "lead");
  const driver = crewmate.agent === undefined ? undefined : driverOf(crewmate.agent);
  const named =
    driver === undefined ? undefined : logins.find((login) => driverOfLogin(login.id) === driver);
  const login = named ?? logins[0];
  const loginOf = (id: string, label: string) => ({ id, label, driver: driverOfLogin(id) });
  if (login === undefined || named === undefined) {
    return {
      login: login === undefined ? null : loginOf(login.id, login.label),
      model: null,
      effort: null,
      missing:
        crewmate.agent === undefined || driver === undefined
          ? null
          : {
              name: agentName(crewmate.agent),
              driver,
              agentId: agentIdForDriverKind(driver),
            },
    };
  }
  const wanted = crewmate.model?.toLowerCase();
  const model =
    wanted === undefined
      ? undefined
      : crewModelOptions(providers, login.id).find(
          (option) => option.slug.toLowerCase() === wanted || option.name.toLowerCase() === wanted,
        );
  const effort =
    model === undefined || crewmate.effort === undefined
      ? undefined
      : crewEffortOptions(providers, login.id, model.slug).find(
          (option) =>
            option.id.toLowerCase() === crewmate.effort ||
            option.label.toLowerCase() === crewmate.effort,
        );
  return {
    login: loginOf(login.id, login.label),
    model: model ?? null,
    effort: effort ?? null,
    missing: null,
  };
}

/** The crew as the setup takes it: each crewmate on what it runs on here. */
export function crewAskSeats(
  ask: CrewAsk,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<CrewAskSeat> {
  return ask.crew.map((crewmate) => {
    const runsOn = crewAskRunsOn(crewmate, providers);
    return {
      name: crewmate.name,
      kind: crewmate.kind,
      part: crewmate.part,
      login: runsOn.login?.id,
      model: runsOn.model?.slug,
      effort: runsOn.effort?.id,
    };
  });
}

/** "Claude Opus 5.5 · High": the model and effort it sets, else its login's name. */
export function crewAskRunsOnWords(runsOn: CrewAskRunsOn): string | null {
  if (runsOn.login === null) return null;
  return [runsOn.model?.name ?? runsOn.login.label, runsOn.effort?.label]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

/**
 * Each agent the Mate named that this Mate isn't signed in to, once, with the crewmates who
 * wanted it and the login they start on instead.
 */
export function crewAskMissing(
  rows: ReadonlyArray<{ readonly crewmate: CrewAskCrewmate; readonly runsOn: CrewAskRunsOn }>,
): ReadonlyArray<{
  readonly agent: CrewAskMissingAgent;
  readonly crewmates: ReadonlyArray<string>;
  readonly instead: string | null;
}> {
  const byAgent = new Map<
    string,
    { agent: CrewAskMissingAgent; crewmates: string[]; instead: string | null }
  >();
  for (const { crewmate, runsOn } of rows) {
    if (runsOn.missing === null) continue;
    const entry = byAgent.get(runsOn.missing.driver) ?? {
      agent: runsOn.missing,
      crewmates: [],
      instead: runsOn.login?.label ?? null,
    };
    entry.crewmates.push(crewmate.name);
    byAgent.set(runsOn.missing.driver, entry);
  }
  return [...byAgent.values()];
}

/** "Sign in to Codex first, or Sol and Ivo start on Claude Code." */
export function crewAskMissingWords(
  missing: ReturnType<typeof crewAskMissing>[number],
  mate: string,
): string {
  const who = namesWords(missing.crewmates);
  const start = missing.crewmates.length === 1 ? "starts" : "start";
  if (missing.instead === null) return `${mate} isn't signed in to ${missing.agent.name}.`;
  return missing.agent.agentId === undefined
    ? `${mate} has no ${missing.agent.name}, so ${who} ${start} on ${missing.instead}.`
    : `Sign in to ${missing.agent.name} first, or ${who} ${start} on ${missing.instead}.`;
}
