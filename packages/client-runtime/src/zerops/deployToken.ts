/**
 * An environment's deploy token (spec §10.8, D27).
 *
 * A job deploys, with `zcli push`; the account's broker decides whether it may
 * and hands it the key. That key is one integration token per stage and
 * production — `NO_ACCESS` in the org, `BASIC_USER` on the environment's
 * project and nothing else — because a token cannot mint a token (ledger
 * 2026-09-15): it cannot be one per job, so it is one per environment, minted
 * by the app as the person who adds the environment and kept where only the
 * broker reads it, as a secret variable on the broker's own service.
 *
 * The variable's name is the one spelling the app and the broker cannot
 * disagree on (`gitea-mate/internal/deploy/grant.go`, `TokenVariable`): the
 * prefix and the project id's bytes in upper-case hex. A project id is
 * base64url — it may carry `-`, which a variable's name may not.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module deployToken
 */

import type { ZeropsProjectGrant } from "./groupReach.ts";

/** The broker's service in the account's Gitea project, as the import names it. */
export const BROKER_HOSTNAME = "broker";

export const DEPLOY_TOKEN_VARIABLE_PREFIX = "MATE_DEPLOY_TOKEN_";

/** `MATE_DEPLOY_TOKEN_{HEX}` — where one environment's key is kept on the broker. */
export function deployTokenVariable(projectId: string): string {
  let hex = "";
  for (const byte of new TextEncoder().encode(projectId)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${DEPLOY_TOKEN_VARIABLE_PREFIX}${hex.toUpperCase()}`;
}

/** `deploy-Todo - stage` — what the token is called in the account's token list. */
export function deployTokenName(environmentName: string): string {
  return `deploy-${environmentName.trim()}`;
}

export type DeployTokenPlan =
  /** The broker already holds this environment's key. */
  | { readonly kind: "held" }
  /** Mint one and write it: the org role, the one grant, the variable. */
  | {
      readonly kind: "mint";
      readonly name: string;
      readonly roleCode: "NO_ACCESS";
      readonly projects: ReadonlyArray<ZeropsProjectGrant>;
      readonly variable: string;
    };

/**
 * What an environment's key needs, given the names of the variables the
 * broker's service carries. Never a value: whether the key is there is all the
 * app ever learns about it after writing it.
 */
export function planDeployToken(input: {
  readonly projectId: string;
  readonly environmentName: string;
  readonly brokerVariables: ReadonlyArray<string>;
}): DeployTokenPlan {
  const variable = deployTokenVariable(input.projectId);
  if (input.brokerVariables.includes(variable)) return { kind: "held" };
  return {
    kind: "mint",
    name: deployTokenName(input.environmentName),
    roleCode: "NO_ACCESS",
    projects: [{ projectId: input.projectId, roleCode: "BASIC_USER" }],
    variable,
  };
}

/**
 * The environments whose key the broker does not hold, out of the projects a
 * group declares — what the projects page mints on its next read, for a
 * person who may (an org owner or admin).
 */
export function environmentsWithoutDeployToken(input: {
  readonly declaredProjects: ReadonlyArray<string>;
  readonly brokerVariables: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const held = new Set(input.brokerVariables);
  return input.declaredProjects.filter((projectId) => !held.has(deployTokenVariable(projectId)));
}
