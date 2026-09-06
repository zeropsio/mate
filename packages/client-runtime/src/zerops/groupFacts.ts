/**
 * Telling a Mate about the rest of its group.
 *
 * A Mate can see exactly one project: the container's integration token is
 * `NO_ACCESS` at the organization with `ADMIN` on the project it lives in. So
 * an agent that looks around finds its own control plane and nothing else —
 * not the group it belongs to, not the production environment its work is
 * bound for, not what that environment runs. Measured 2026-09-06: asked to
 * build an application and ship it, a Mate read its project, concluded there
 * was nowhere to run anything, and provisioned a runtime and a database of its
 * own. It was not wrong; it was uninformed.
 *
 * Membership is a tag on each project (`groups.ts`), which only something
 * holding the account's own token can read — the client. So the client writes
 * the group down, as ordinary environment variables on the Mate's `zcp`, the
 * same channel that carries its Gitea credential (`giteaCredential.ts`).
 *
 * ## What is written, and what is deliberately not
 *
 * `MATE_GROUP` is the group's name, and `MATE_ENVIRONMENTS` is the rest of the
 * group as JSON: role, project name, project id, and the services that project
 * runs. Enough to answer "where does this go when it ships" and "does what I
 * am building match what production runs" — the drift that a Mate cannot
 * otherwise even detect.
 *
 * **No credential is written.** Knowing production exists is not permission to
 * deploy into it: that path is the repository's pipeline, and a token for it
 * lives in the CI secrets where a person put it. A Mate that could push
 * straight into production would make the pipeline decorative.
 *
 * The JSON is emitted in a fixed order — the group's own role order, then by
 * name — so a second reconcile over an unchanged group writes nothing at all.
 *
 * Nothing here reaches a network or a clock (rule R1).
 *
 * @module groupFacts
 */

import type { ZeropsEnvironmentRole } from "./groups.ts";

/** The group's display name, as the client shows it. */
export const MATE_GROUP_ENV_KEY = "MATE_GROUP";
/** The rest of the group, as JSON. */
export const MATE_ENVIRONMENTS_ENV_KEY = "MATE_ENVIRONMENTS";

const ROLE_ORDER: ReadonlyArray<ZeropsEnvironmentRole> = ["dev", "devstage", "stage", "prod"];

/** One service in a sibling environment, as much of it as is worth carrying. */
export interface ZeropsGroupFactService {
  readonly hostname: string;
  /** The platform's own version name, e.g. `nodejs@22`. */
  readonly type: string;
}

/** One of the group's other environments, as a Mate is told about it. */
export interface ZeropsGroupFactEnvironment {
  readonly role?: ZeropsEnvironmentRole | undefined;
  readonly name: string;
  readonly projectId: string;
  readonly services: ReadonlyArray<ZeropsGroupFactService>;
}

export interface ZeropsGroupFactsInput {
  /** The group's name. Absent for a group nothing has named yet. */
  readonly groupName?: string | undefined;
  /** Every environment in the group, the Mate's own included — it is dropped. */
  readonly environments: ReadonlyArray<ZeropsGroupFactEnvironment>;
  /** The project the Mate itself lives in. */
  readonly selfProjectId: string;
}

function rank(role: ZeropsEnvironmentRole | undefined): number {
  return role === undefined ? ROLE_ORDER.length : ROLE_ORDER.indexOf(role);
}

/**
 * The environment variables that describe this group, or `{}` when there is
 * nothing to say — a group of one has no siblings, and writing an empty list
 * would tell a Mate that production is absent rather than unknown.
 */
export function formatGroupFacts(input: ZeropsGroupFactsInput): Readonly<Record<string, string>> {
  const others = input.environments
    .filter((environment) => environment.projectId !== input.selfProjectId)
    .sort(
      (left, right) =>
        rank(left.role) - rank(right.role) ||
        left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
    )
    .map((environment) => ({
      ...(environment.role === undefined ? {} : { role: environment.role }),
      name: environment.name,
      projectId: environment.projectId,
      services: [...environment.services]
        .sort((left, right) => left.hostname.localeCompare(right.hostname, "en"))
        .map((service) => ({ hostname: service.hostname, type: service.type })),
    }));

  if (others.length === 0) return {};
  return {
    ...(input.groupName === undefined ? {} : { [MATE_GROUP_ENV_KEY]: input.groupName }),
    [MATE_ENVIRONMENTS_ENV_KEY]: JSON.stringify(others),
  };
}

export interface ZeropsGroupFactsPlan {
  /** Keys to write. A write is a delete followed by a create: there is no update. */
  readonly write: ReadonlyArray<string>;
  readonly values: Readonly<Record<string, string>>;
  /** A service env write reaches new processes only. */
  readonly restart: boolean;
}

/**
 * What to write onto the Mate, given what it already carries. A key whose
 * value is already exact is left alone, so re-running over an unchanged group
 * is not a restart.
 */
export function planGroupFacts(input: {
  readonly facts: Readonly<Record<string, string>>;
  readonly current: Readonly<Record<string, string>>;
}): ZeropsGroupFactsPlan {
  const write = Object.keys(input.facts).filter((key) => input.current[key] !== input.facts[key]);
  const values: Record<string, string> = {};
  for (const key of write) values[key] = input.facts[key] ?? "";
  return { write, values, restart: write.length > 0 };
}
