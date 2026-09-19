/**
 * How a Mate is named by the machinery around it, and how to read those names
 * back.
 *
 * zcp registers a Mate's bot in Gitea as `mate-{projectId}` and works on
 * `mate/{login}` (gitea-mate `mate.go`, zcp `gitea_repo.go`). Those two shapes
 * are the only place a Mate's project id leaks into somebody else's namespace,
 * and four modules have to turn them back into a Mate — whose change this is,
 * who said this, whose branch this is.
 *
 * Its own module because both `projectFlow.ts` and `gitTab.ts` need it and
 * they already point one way: a rule that lived in the first and was wanted by
 * the second would have made a cycle out of a string prefix.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module mateIdentity
 */

const BOT_LOGIN_PREFIX = "mate-";
const MATE_BRANCH_PREFIX = "mate/";

/** The bot login of a Mate's project — what the broker registers it as. */
export function mateBotLogin(projectId: string): string {
  return `${BOT_LOGIN_PREFIX}${projectId}`;
}

/** The Mate's project behind a bot login, or `undefined` for a person. */
export function mateProjectOfLogin(login: string | undefined): string | undefined {
  if (login === undefined || !login.startsWith(BOT_LOGIN_PREFIX)) return undefined;
  const projectId = login.slice(BOT_LOGIN_PREFIX.length);
  return projectId.length > 0 ? projectId : undefined;
}

/** The Mate's project behind zcp's branch name, or `undefined` for any other branch. */
export function mateProjectOfBranch(ref: string | undefined): string | undefined {
  if (ref === undefined || !ref.startsWith(MATE_BRANCH_PREFIX)) return undefined;
  return mateProjectOfLogin(ref.slice(MATE_BRANCH_PREFIX.length));
}

/**
 * A branch as a person reads it.
 *
 * `mate/mate-PXGYIVK9RLWlE3eTL3Qwow` is a project id inside a bot login inside
 * a ref: three machine names and nothing a reader can use. It is the same leak
 * `changeAuthorName` closed for a change's author, in the same words — a Mate's
 * own working branch is named after the Mate, and every other branch is named
 * after itself, because a person chose that name and it means something.
 */
export function branchLabel(ref: string | null, mateName: string | undefined): string {
  if (ref === null || ref.length === 0) return "detached";
  if (mateProjectOfBranch(ref) === undefined) return ref;
  return mateName === undefined ? "the Mate's branch" : `${mateName}'s branch`;
}
