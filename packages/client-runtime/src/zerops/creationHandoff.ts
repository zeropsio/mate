/**
 * What a Mate is told to do the moment it is created.
 *
 * Adding a Mate to a group stands the environment up but does not finish the
 * job: a tier imports its services `startWithoutCode` (`recipeTier.ts`), so
 * the application is there and running nothing. Until now
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
  /**
   * A tier of the group repo. Its services came up **empty**: the platform
   * cannot clone a private repository, so every one of them was imported
   * `startWithoutCode` and waits for its first deploy (`recipeTier.ts`).
   */
  | { readonly kind: "tier"; readonly services: ReadonlyArray<string> }
  /** Nothing — the agent is the first thing in the environment. */
  | { readonly kind: "none" };

export interface ZeropsCreationHandoff {
  readonly environmentName: string;
  readonly groupName: string;
  readonly role: ZeropsEnvironmentRole;
  readonly source: ZeropsCreationSource;
  /**
   * What the person answered to *What are we building?* — their own words,
   * carried verbatim from *Add project* (D17). Absent when they wrote nothing.
   */
  readonly brief?: string | undefined;
  /**
   * When the creation wrote this, epoch ms. A pending handoff is what makes
   * the projects page treat a project the inventory does not list yet as
   * real; one that outlived any boot (a project removed elsewhere, a tab
   * that never came back) must not hold that power, so a pending read is
   * age-bounded. Absent on records from before this field: never pending.
   */
  readonly createdAtMs?: number | undefined;
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
    case "tier": {
      const { services } = handoff.source;
      lines.push(`Its services came up from the project's recipe.`);
      if (services.length > 0) {
        // Imported `startWithoutCode`, so they exist and run nothing. This is
        // the whole reason the agent is here first.
        lines.push(
          `${services.join(", ")} ${services.length === 1 ? "has" : "have"} no code deployed yet.`,
          "Get them building and running.",
        );
      }
      break;
    }
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
  const brief = record["brief"];
  const createdAtMs = record["createdAtMs"];
  return (
    typeof record["environmentName"] === "string" &&
    typeof record["groupName"] === "string" &&
    ROLES.has(record["role"] as ZeropsEnvironmentRole) &&
    (brief === undefined || typeof brief === "string") &&
    (createdAtMs === undefined || typeof createdAtMs === "number") &&
    (kind === "tier" || kind === "none")
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

/**
 * The projects created and never connected to — every handoff still under its
 * project key. A creation's wait ends with the connect that promotes the key;
 * a reload mid-wait leaves it here, and the projects page reads this to pick
 * the wait up again rather than asking for a click the creation never needed.
 */
/**
 * The projects a creation made and never connected to. With a bound, only
 * those young enough to still be booting: a handoff older than that is a
 * project removed some other way or a tab that never came back, and it must
 * not keep the page from saying the account is empty.
 */
export function pendingCreationProjectIds(
  handoffs: ZeropsCreationHandoffs,
  bound?: { readonly nowMs: number; readonly maxAgeMs: number },
): ReadonlyArray<string> {
  const prefix = keyOf({ projectId: "" });
  return Object.entries(handoffs)
    .filter(
      ([key, handoff]) =>
        key.startsWith(prefix) &&
        (bound === undefined ||
          (handoff.createdAtMs !== undefined &&
            bound.nowMs - handoff.createdAtMs <= bound.maxAgeMs)),
    )
    .map(([key]) => key.slice(prefix.length));
}

export function withoutCreationHandoff(
  handoffs: ZeropsCreationHandoffs,
  environmentId: string,
): ZeropsCreationHandoffs {
  const { [keyOf({ environmentId })]: _done, ...rest } = handoffs;
  return rest;
}

/**
 * Forgets a creation that never became an environment — the project the
 * platform failed to make, removed from the account. Nothing will connect to
 * it, so nothing must keep waiting for it.
 */
export function withoutPendingCreationHandoff(
  handoffs: ZeropsCreationHandoffs,
  projectId: string,
): ZeropsCreationHandoffs {
  const { [keyOf({ projectId })]: _gone, ...rest } = handoffs;
  return rest;
}

/**
 * What to do with a new environment's opening message: send it, write it into
 * the composer and leave it, or wait (D17).
 *
 * The distinction is the whole of D17, and it is about **whose sentence it
 * is**. The person answered *What are we building?* in *Add project* and then
 * watched an environment being built for those words; sending them is finishing
 * what they started, not a turn they did not ask for. A sentence this app
 * composed about services and build setups is a guess at a job, and a guess is
 * filled in for them to read, edit and send — never spent on their behalf.
 *
 * `wait` is not `never`: connecting, busy, unreachable and "no agent signed in
 * yet" all mean the caller asks again in a moment. Four things gate it:
 *
 * - a **handoff**, which only a creation writes;
 * - somewhere to say it (`hasTarget`) and a thread that can take it (`ready`);
 * - a **signed-in coding agent**. There is nothing on the other end until then,
 *   and a turn spent on nothing is a turn wasted. This is the gate the whole
 *   flow is built around: authorization is the one step a person still has to
 *   do themselves (`spec-mate.md` §8), and everything after it is automatic;
 * - and **once**: `startedFor` is the environment this caller has already
 *   spoken for, so a re-render, a reconnect or a second tab says nothing.
 */
export type ZeropsCreationJob =
  /** The person's own words. Written into the composer and sent. */
  | { readonly kind: "send"; readonly prompt: string }
  /** A generated hand-off. Written into the composer and left there. */
  | { readonly kind: "compose"; readonly prompt: string }
  /** Not yet, or not at all. */
  | { readonly kind: "wait" };

const WAIT: ZeropsCreationJob = { kind: "wait" };

export function creationJobToStart(input: {
  readonly environmentId: string | null;
  readonly handoff: ZeropsCreationHandoff | undefined;
  readonly hasTarget: boolean;
  readonly ready: boolean;
  readonly agentSignInRequired: boolean;
  readonly startedFor: string | null;
}): ZeropsCreationJob {
  if (input.environmentId === null || !input.hasTarget || !input.ready) return WAIT;
  if (input.startedFor === input.environmentId) return WAIT;
  if (input.agentSignInRequired) return WAIT;
  if (input.handoff === undefined) return WAIT;

  const brief = input.handoff.brief?.trim() ?? "";
  return brief.length > 0
    ? { kind: "send", prompt: brief }
    : { kind: "compose", prompt: creationHandoffPrompt(input.handoff) };
}

/**
 * Whether the one prompt mate sends by itself can actually go.
 *
 * The caller reports the answer back to the retry loop, and the loop spends
 * the handoff on a `true` — so this must not say yes to a send that will do
 * nothing. Two things stop it: no provider to take the message, and an empty
 * composer. The second is the race that cost a real one — the job is written
 * to the composer's store, the send reads it back from a ref the store fills
 * on the next render, and a send in the same tick reads the ref before the
 * write reaches it. Answering `false` there retries a moment later, by which
 * time the prompt has landed; answering `true` loses the job silently.
 */
export function creationJobSendable(input: {
  readonly providerAvailable: boolean;
  readonly composerText: string;
}): boolean {
  return input.providerAvailable && input.composerText.trim().length > 0;
}
