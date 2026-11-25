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
} from "@t3tools/contracts";
import type { CrewAskSeat } from "@t3tools/shared/crewTemplates";

import {
  crewEffortOptions,
  crewLoginOptions,
  crewModelOptions,
} from "../zerops/crew/CrewEditors.logic";
import { askKeyOf } from "./ask.logic";

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

/**
 * What a crewmate runs on among this Mate's sign-ins: the login of the agent the Mate named, the
 * model it named there (by id or name), and the effort that model offers (by id or name). An agent
 * it isn't signed in to runs on its first login that may (a lead's hosts the crew tools), and
 * `missing` names that agent; `login` is `null` only where no login may.
 */
export interface CrewAskRunsOn {
  readonly login: { readonly id: string; readonly label: string } | null;
  readonly model: { readonly slug: string; readonly name: string } | null;
  readonly effort: { readonly id: string; readonly label: string } | null;
  /** The agent the Mate named that this Mate isn't signed in to. */
  readonly missing: string | null;
}

export function crewAskRunsOn(
  crewmate: CrewAskCrewmate,
  providers: ReadonlyArray<ServerProvider>,
): CrewAskRunsOn {
  const logins = crewLoginOptions(providers, crewmate.kind === "lead");
  const driver = crewmate.agent === undefined ? undefined : driverOf(crewmate.agent);
  const named =
    driver === undefined
      ? undefined
      : logins.find(
          (login) =>
            providers.find((provider) => provider.instanceId === login.id)?.driver === driver,
        );
  const login = named ?? logins[0];
  if (login === undefined || named === undefined) {
    return {
      login: login === undefined ? null : { id: login.id, label: login.label },
      model: null,
      effort: null,
      missing: crewmate.agent === undefined ? null : agentName(crewmate.agent),
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
    login: { id: login.id, label: login.label },
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

/** "Claude Code · Opus 5.5 · High": the login, then the model and effort it sets. */
export function crewAskRunsOnWords(runsOn: CrewAskRunsOn): string | null {
  if (runsOn.login === null) return null;
  return [runsOn.login.label, runsOn.model?.name, runsOn.effort?.label]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}
