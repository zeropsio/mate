/**
 * An environment's deploy token (SPEC §3.2b, main D27/E03).
 *
 * HQ deploys a stage and a production as the environment, with one integration token per
 * environment — `NO_ACCESS` in the org, `BASIC_USER` on its project and nothing else — because a
 * token cannot mint a token (ledger 2026-09-15): only a person can, so the client of whoever adds
 * the environment, or may keep its key, mints it and hands it to HQ, which never answers it back.
 * HQ says only whether it holds one, and whether the one it holds still works (`keyHeld`,
 * `keyInvalid`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module deployToken
 */

import type { ZeropsProjectGrant } from "./groupReach.ts";

/** `deploy-Todo - stage` — what the token is called in the account's token list. */
export function deployTokenName(environmentName: string): string {
  return `deploy-${environmentName.trim()}`;
}

/** The token an environment's key is minted as: its name, the org role, the one grant. */
export interface DeployTokenMint {
  readonly name: string;
  readonly roleCode: "NO_ACCESS";
  readonly projects: ReadonlyArray<ZeropsProjectGrant>;
}

export function deployTokenMint(input: {
  readonly projectId: string;
  readonly environmentName: string;
}): DeployTokenMint {
  return {
    name: deployTokenName(input.environmentName),
    roleCode: "NO_ACCESS",
    projects: [{ projectId: input.projectId, roleCode: "BASIC_USER" }],
  };
}

/** Whether HQ deploys an environment with a key that works: one it holds, and not found broken. */
export function environmentKeyed(environment: {
  readonly keyHeld: boolean;
  readonly keyInvalid: boolean;
}): boolean {
  return environment.keyHeld && !environment.keyInvalid;
}
