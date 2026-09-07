/**
 * What a Mate is told to do the moment it is created.
 *
 * Adding a Mate to a group stands the environment up but does not finish the
 * job: a clone carries a sibling's service *shapes* and not its build setup
 * (`recipeExport.ts`), so the application is there and not running. Until now
 * the new Mate opened on the same fixed line every connected environment gets
 * — "Introduce yourself, tell me what is running here" — which asks a Mate
 * that was created for a reason to guess what that reason was.
 *
 * So a creation writes down its own facts and the environment opens on them.
 * The prompt names what this environment is, where its application came from,
 * and the one thing left to do. Nothing here reaches a network or a clock: it
 * is the sentence, and the caller decides when it is said.
 *
 * @module creationHandoff
 */

import type { ZeropsEnvironmentRole } from "./groups.ts";

/** Where the new environment's application came from, as the prompt needs it. */
export type ZeropsCreationSource =
  /** A sibling's export. `needsDeploy` are the services whose build it could not carry. */
  | { readonly kind: "clone"; readonly name: string; readonly needsDeploy: ReadonlyArray<string> }
  /** The group's published recipe for this role. */
  | { readonly kind: "store" }
  /** Nothing — the agent is the first thing in the environment. */
  | { readonly kind: "none" };

export interface ZeropsCreationHandoff {
  readonly environmentName: string;
  readonly groupName: string;
  readonly role: ZeropsEnvironmentRole;
  readonly source: ZeropsCreationSource;
}

/** The role as it reads mid-sentence: "the stage environment of Aurora". */
const ROLE_WORD: Record<ZeropsEnvironmentRole, string> = {
  dev: "dev",
  devstage: "dev / stage",
  stage: "stage",
  prod: "production",
};

export function creationHandoffPrompt(handoff: ZeropsCreationHandoff): string {
  const role = ROLE_WORD[handoff.role];
  // "Aurora - stage" already says Aurora; saying it twice reads like a bug.
  const place = handoff.environmentName.includes(handoff.groupName)
    ? `${handoff.environmentName}, the ${role} environment`
    : `${handoff.environmentName}, the ${role} environment in the ${handoff.groupName} project`;

  const lines = [`You were just created as ${place}.`];

  switch (handoff.source.kind) {
    case "clone": {
      const { name, needsDeploy } = handoff.source;
      lines.push(`Its services were cloned from ${name}.`);
      if (needsDeploy.length > 0) {
        // The export carries no `zeropsSetup`, so these came up with nothing
        // deployed. This is the whole reason the agent is here first.
        lines.push(
          `The clone could not carry their build setup, so ${needsDeploy.join(", ")} ${
            needsDeploy.length === 1 ? "has" : "have"
          } no build yet.`,
          "Get them building and running.",
        );
      }
      break;
    }
    case "store":
      lines.push(`Its services came up from the group's ${role} recipe.`);
      break;
    case "none":
      lines.push("It has nothing in it yet — setting the application up is the job.");
      break;
  }

  lines.push("Check what is actually running, then tell me where things stand.");
  return lines.join(" ");
}

export const ZEROPS_CREATION_HANDOFF_STORAGE_KEY = "zerops-mate.creation-handoff.v1";

/**
 * Handoffs waiting to be said, by key.
 *
 * Two key shapes, because the two ends of the journey know different things: a
 * creation has a Zerops **project** id and no environment yet, and the compose
 * that says the prompt has an **environment** id and no project. The connect
 * in between is the only place both are in hand, so that is where a handoff
 * moves from one key to the other ({@link withCreationHandoffPromoted}).
 */
export type ZeropsCreationHandoffs = Readonly<Record<string, ZeropsCreationHandoff>>;

export type ZeropsCreationHandoffKey =
  | { readonly projectId: string; readonly environmentId?: undefined }
  | { readonly environmentId: string; readonly projectId?: undefined };

function keyOf(key: ZeropsCreationHandoffKey): string {
  return key.projectId === undefined ? `env:${key.environmentId}` : `project:${key.projectId}`;
}

const ROLES: ReadonlySet<ZeropsEnvironmentRole> = new Set(["dev", "devstage", "stage", "prod"]);

/** Whether a parsed value is a handoff this version knows how to say. */
function isHandoff(value: unknown): value is ZeropsCreationHandoff {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const source = record["source"];
  if (typeof source !== "object" || source === null) return false;
  const kind = (source as Record<string, unknown>)["kind"];
  return (
    typeof record["environmentName"] === "string" &&
    typeof record["groupName"] === "string" &&
    ROLES.has(record["role"] as ZeropsEnvironmentRole) &&
    (kind === "clone" || kind === "store" || kind === "none")
  );
}

/** Parses the store, treating anything unexpected as "nothing waiting". */
export function parseCreationHandoffs(raw: string | null): ZeropsCreationHandoffs {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, ZeropsCreationHandoff] => isHandoff(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function readCreationHandoff(
  handoffs: ZeropsCreationHandoffs,
  key: ZeropsCreationHandoffKey,
): ZeropsCreationHandoff | undefined {
  return handoffs[keyOf(key)];
}

export function withCreationHandoff(
  handoffs: ZeropsCreationHandoffs,
  key: ZeropsCreationHandoffKey,
  handoff: ZeropsCreationHandoff,
): ZeropsCreationHandoffs {
  return { ...handoffs, [keyOf(key)]: handoff };
}

/**
 * Moves a handoff from the project that was created onto the environment that
 * connect returned. The project key is spent in the same breath, so a later
 * reconnect to the same container does not raise the job a second time.
 */
export function withCreationHandoffPromoted(
  handoffs: ZeropsCreationHandoffs,
  projectId: string,
  environmentId: string,
): ZeropsCreationHandoffs {
  const handoff = handoffs[keyOf({ projectId })];
  if (handoff === undefined) return handoffs;
  const { [keyOf({ projectId })]: _spent, ...rest } = handoffs;
  return { ...rest, [keyOf({ environmentId })]: handoff };
}

export function withoutCreationHandoff(
  handoffs: ZeropsCreationHandoffs,
  environmentId: string,
): ZeropsCreationHandoffs {
  const { [keyOf({ environmentId })]: _done, ...rest } = handoffs;
  return rest;
}

/**
 * The job to say now, or nothing.
 *
 * A creation's opening message is the one prompt mate sends by itself rather
 * than composing — the person asked for this environment and waited two
 * minutes for it, so the turn is not a surprise. Four things gate it:
 *
 * - a **handoff**, which only a creation writes;
 * - somewhere to say it (`hasTarget`) and a thread that can take it
 *   (`ready`) — connecting, busy or unreachable all mean "not yet", never
 *   "never", so the caller simply asks again;
 * - a **signed-in coding agent**. There is nothing on the other end until
 *   then, and a turn spent on nothing is a turn wasted. This is the gate the
 *   whole flow is built around: authorization is the one step a person still
 *   has to do themselves (`spec-mate.md` §8), and everything after it is
 *   automatic;
 * - and **once**: `startedFor` is the environment this caller has already
 *   spoken for, so a re-render, a reconnect or a second tab says nothing.
 */
export function creationJobToStart(input: {
  readonly environmentId: string | null;
  readonly handoff: ZeropsCreationHandoff | undefined;
  readonly hasTarget: boolean;
  readonly ready: boolean;
  readonly agentSignInRequired: boolean;
  readonly startedFor: string | null;
}): ZeropsCreationHandoff | undefined {
  if (input.environmentId === null || !input.hasTarget || !input.ready) return undefined;
  if (input.startedFor === input.environmentId) return undefined;
  if (input.agentSignInRequired) return undefined;
  return input.handoff;
}
