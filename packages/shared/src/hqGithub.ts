/**
 * The organization's GitHub app, as HQ makes and keeps it, and the pull requests it mirrors Mate's
 * changes to: the wire between HQ and the client.
 *
 * HQ makes the app with GitHub's manifest flow, so it is the organization's own (`<name>[bot]`),
 * its private key sealed in HQ and its webhook pointed at HQ. Every comment, reaction, branch and
 * pull request HQ writes on a repository the app is installed on is the app's, never a person's.
 *
 * - `GET /api/org/github` → {@link HqGithubView}, any member;
 * - `POST /api/org/github/manifest` {@link HqGithubManifestRequest} → {@link HqGithubManifestView},
 *   owner or admin: the browser posts `manifest` to `postUrl` as a form, and GitHub's page creates
 *   the app; GitHub sends the browser back to HQ, which keeps the app and sends it on to install it;
 * - `DELETE /api/org/github` → 204, owner or admin: HQ forgets the app (deleting it is GitHub's);
 * - `PUT /api/apps/:appId/repos/:repo/remote/app` {@link HqRepoRemoteViaAppRequest} → 204, a
 *   structure writer: the repository mirrors to one the app is installed on, with no token.
 *
 * @module hqGithub
 */
import * as Schema from "effect/Schema";

/** A repository the app is installed on. */
export const HqGithubRepository = Schema.Struct({
  /** `owner/name`. */
  fullName: Schema.String,
  private: Schema.Boolean,
  defaultBranch: Schema.String,
});
export type HqGithubRepository = typeof HqGithubRepository.Type;

/** Where the app is installed: an account and the repositories it may reach there. */
export const HqGithubInstallation = Schema.Struct({
  id: Schema.Number,
  account: Schema.String,
  accountType: Schema.Literals(["Organization", "User"]),
  repositorySelection: Schema.Literals(["all", "selected"]),
  repositories: Schema.Array(HqGithubRepository),
  suspended: Schema.Boolean,
  /** GitHub's page to change which repositories it reaches. */
  manageUrl: Schema.String,
});
export type HqGithubInstallation = typeof HqGithubInstallation.Type;

export const HqGithubView = Schema.Union([
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({
    state: Schema.Literal("connected"),
    /** The app's slug; its bot is `<slug>[bot]`. */
    slug: Schema.String,
    /**
     * The app's id on GitHub: the source a ruleset pins `mate/gate` to. Absent from an older HQ.
     */
    appId: Schema.optionalKey(Schema.Number),
    /** The app's name as GitHub shows it ("Acme Mate"); absent from an HQ that keeps none. */
    name: Schema.optionalKey(Schema.String),
    /** What GitHub shows as the author of everything it writes: `<slug>[bot]`. */
    botLogin: Schema.String,
    /** The account that owns the app (an organization or a person). */
    owner: Schema.String,
    /** The app's page on GitHub. */
    appUrl: Schema.String,
    /** GitHub's page to install it on more repositories. */
    installUrl: Schema.String,
    installations: Schema.Array(HqGithubInstallation),
  }),
]);
export type HqGithubView = typeof HqGithubView.Type;

export const HqGithubManifestRequest = Schema.Struct({
  /** The GitHub organization that will own the app; `null`: the person's own account. */
  owner: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
  /** The app's name, unique across GitHub, at most 34 characters. */
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(34)),
  /** Where HQ sends the browser once the app is installed: a Mate page. */
  returnTo: Schema.String,
});
export type HqGithubManifestRequest = typeof HqGithubManifestRequest.Type;

export const HqGithubManifestView = Schema.Struct({
  /** GitHub's "new app" page the browser posts the manifest to. */
  postUrl: Schema.String,
  /** The app's definition, as GitHub reads it from the form's `manifest` field. */
  manifest: Schema.String,
  /** One-time state binding GitHub's return to this request. */
  state: Schema.String,
});
export type HqGithubManifestView = typeof HqGithubManifestView.Type;

export const HqRepoRemoteViaAppRequest = Schema.Struct({
  /** `owner/name` of a repository the app is installed on. */
  repository: Schema.String.check(Schema.isMinLength(3)),
});
export type HqRepoRemoteViaAppRequest = typeof HqRepoRemoteViaAppRequest.Type;

/** The pull request a change is mirrored to on GitHub. */
export const HqPullRequest = Schema.Struct({
  number: Schema.Int,
  url: Schema.String,
  state: Schema.Literals(["open", "merged", "closed"]),
  /** Its head's checks on GitHub; absent while none reported. */
  checks: Schema.optionalKey(Schema.Literals(["pending", "passing", "failing"])),
});
export type HqPullRequest = typeof HqPullRequest.Type;
