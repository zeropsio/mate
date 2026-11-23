/**
 * An environment's deploy token (SPEC §3.2b, main D27/E03).
 *
 * HQ deploys a stage and a production as the environment, with one integration token per
 * environment that HQ mints, names and keeps itself (its `deploy_key` operation), and never answers
 * back. HQ says only whether it holds one, whether the one it holds still works (`keyHeld`,
 * `keyInvalid`), and its Zerops id (`keyId`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module deployToken
 */

/** Whether HQ deploys an environment with a key that works: one it holds, and not found broken. */
export function environmentKeyed(environment: {
  readonly keyHeld: boolean;
  readonly keyInvalid: boolean;
}): boolean {
  return environment.keyHeld && !environment.keyInvalid;
}
