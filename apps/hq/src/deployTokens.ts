/**
 * An environment's deploy token (SPEC §3.2b, main E02): a token reaching exactly that project, as
 * a Basic user, minted by the person who attached it. HQ checks it when it is handed over
 * (`structure.ts`) and again before each environment's deploys (`deploys.ts`): a token that no
 * longer answers, or now reaches more — the platform lets a token raise its own role — is no key.
 * The deploy is refused in main's words (E08), the key is marked invalid until an admin mints a
 * new one, and the event is logged: HQ cannot revoke it, its own token being org Read only.
 *
 * @module deployTokens
 */
import type { ZeropsOwnToken } from "./zerops/api.ts";

/**
 * Whether a token reaches exactly one project, `projectId`, as a Basic user, in the org `orgId`
 * and nothing more: no org role, no project making, no finances (main E02).
 */
export const reachesOnly = (token: ZeropsOwnToken, orgId: string, projectId: string) =>
  token.orgId === orgId &&
  token.roleCode === "NO_ACCESS" &&
  !token.canCreateProjects &&
  !token.canViewFinances &&
  !token.canEditFinances &&
  token.projects.length === 1 &&
  token.projects[0]?.projectId === projectId &&
  token.projects[0].roleCode === "BASIC_USER";

/** Why an environment without a usable key deploys nothing, in main's words (E08). */
export const noDeployToken = (environment: string) =>
  `${environment} has no deploy token yet; an admin who opens the projects page in Zerops Mate mints it`;

/** Why an environment's key that no longer answers deploys nothing, in the words of main's E08. */
export const deadDeployToken = (environment: string) =>
  `${environment}'s deploy token no longer answers; an admin who opens the projects page in Zerops Mate mints a new one`;

/** Why an environment's key that reaches more than its project deploys nothing (main E08). */
export const widenedDeployToken = (environment: string) =>
  `${environment}'s deploy token reaches more than its project; an admin who opens the projects page in Zerops Mate mints a new one`;

/** Why no environment deploys while HQ has no key to open deploy tokens with (`deployKeys.ts`). */
export const noKeySecret = (environment: string) =>
  `HQ cannot open ${environment}'s deploy token: HQ_KEY_SECRET is not set to a key`;

/**
 * Why an environment whose deploy token does not open under HQ's key deploys nothing: sealed under
 * another key, as after a restore onto an HQ with another one, or changed since.
 */
export const unopenedDeployToken = (environment: string) =>
  `${environment}'s deploy token does not open with HQ's key: HQ deploys again once HQ_KEY_SECRET is the key it was sealed under, or once an admin who opens the projects page in Zerops Mate mints a new one`;
