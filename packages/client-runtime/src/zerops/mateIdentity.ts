/**
 * How a Mate is named by the machinery around it, and how to read those names
 * back.
 *
 * Main's zcp registered a Mate's bot in Gitea as `mate-{projectId}` and worked
 * on `mate/{login}` (gitea-mate `mate.go`, main's zcp `gitea_repo.go`). Against
 * HQ, zcp works on `mate/{projectId}` and pushes each change to
 * `mate/{projectId}/{number}` (zcp `hqMateBranch`, `hq.Client.ChangeBranch`), and
 * a Mate migrated from main still carries `mate/mate-{projectId}` until zcp moves
 * it. Those shapes are the only place a Mate's project id leaks into somebody
 * else's namespace, and four modules have to turn them back into a Mate — whose
 * change this is, who said this, whose branch this is.
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
/**
 * A Zerops project id: 22 characters of base64url. What sets HQ's `mate/{projectId}` apart from a
 * branch a person named `mate/something`.
 */
const PROJECT_ID = /^[A-Za-z0-9_-]{22}$/u;
/** HQ's branch of a Mate's change: its project id, then the change's number. */
const CHANGE_BRANCH = /^([A-Za-z0-9_-]{22})\/\d+$/u;

/** The Mate's project behind a bot login, or `undefined` for a person. */
export function mateProjectOfLogin(login: string | undefined): string | undefined {
  if (login === undefined || !login.startsWith(BOT_LOGIN_PREFIX)) return undefined;
  const projectId = login.slice(BOT_LOGIN_PREFIX.length);
  return projectId.length > 0 ? projectId : undefined;
}

/**
 * The Mate's project behind zcp's branch name — main's `mate/mate-{projectId}`, HQ's
 * `mate/{projectId}` or a change's `mate/{projectId}/{number}` — or `undefined` for any other
 * branch.
 */
export function mateProjectOfBranch(ref: string | undefined): string | undefined {
  if (ref === undefined || !ref.startsWith(MATE_BRANCH_PREFIX)) return undefined;
  const rest = ref.slice(MATE_BRANCH_PREFIX.length);
  if (rest.startsWith(BOT_LOGIN_PREFIX)) return mateProjectOfLogin(rest);
  if (PROJECT_ID.test(rest)) return rest;
  return CHANGE_BRANCH.exec(rest)?.[1];
}

/**
 * A branch as a person reads it.
 *
 * `mate/PXGYIVK9RLWlE3eTL3Qwow` is a project id inside a ref (on main, inside a
 * bot login too): machine names and nothing a reader can use. A Mate's own working
 * branch is named after the Mate, and every other branch is named after itself,
 * because a person chose that name and it means something.
 */
export function branchLabel(ref: string | null, mateName: string | undefined): string {
  if (ref === null || ref.length === 0) return "detached";
  if (mateProjectOfBranch(ref) === undefined) return ref;
  return mateName === undefined ? "the Mate's branch" : `${mateName}'s branch`;
}
