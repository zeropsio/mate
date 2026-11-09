/**
 * The organization's GitHub apps, as HQ makes and keeps them, and the pull requests they mirror
 * Mate's changes to: the wire between HQ and the client.
 *
 * An organization holds any number of apps, each made with GitHub's manifest flow, so each is its
 * own (`<name>[bot]`), its private key sealed in HQ and its webhook pointed at HQ. A repository
 * connects through one of them; every comment, reaction, branch and pull request HQ writes there is
 * that app's, never a person's.
 *
 * - `GET /api/org/github` → {@link HqGithubView}, any member;
 * - `POST /api/org/github/manifest` {@link HqGithubManifestRequest} → {@link HqGithubManifestView},
 *   owner or admin: the browser posts `manifest` to `postUrl` as a form, and GitHub's page creates
 *   the app; GitHub sends the browser back to HQ, which adds it (never replacing another) and sends
 *   it on to install it;
 * - `POST /api/org/github/apps/:appId/install` {@link HqGithubInstallRequest} →
 *   {@link HqGithubInstallView}, owner or admin: GitHub's install page with a one-time state, so
 *   what is installed from it comes back accepted and added by the caller;
 * - `POST /api/org/github/apps/:appId/confirm` → 204, owner or admin: the caller vouches for an app
 *   nobody sealed, once HQ proved its key still answers GitHub;
 * - `DELETE /api/org/github/apps/:appId` → 204, owner or admin: HQ forgets that app and its
 *   installations (deleting it is GitHub's); remotes through it read invalid;
 * - `POST /api/org/github/installations/:id/accept` | `…/suspend` | `…/resume` → 204, owner or
 *   admin: HQ acts on a waiting installation's repositories, or GitHub suspends or resumes it;
 * - `PUT /api/apps/:appId/repos/:repo/remote/app` {@link HqRepoRemoteViaAppRequest} → 204, a
 *   structure writer: the repository mirrors to one an app is installed on, with no token.
 *
 * @module hqGithub
 */
import * as Schema from "effect/Schema";

/** A repository an app is installed on. */
export const HqGithubRepository = Schema.Struct({
  /** GitHub's repository id. */
  id: Schema.Number,
  /** `owner/name`. */
  fullName: Schema.String,
  private: Schema.Boolean,
  defaultBranch: Schema.String,
  /**
   * The Mate code repository whose remote (through any app, or a token) is this GitHub repository:
   * its HQ application id and repository name, and the organization's app its remote goes through
   * (`null` for a token); `null` while none is.
   */
  usedBy: Schema.NullOr(
    // Application and repo both null: an application the caller may not read uses it — taken,
    // never named. `githubAppId` is said to every member.
    Schema.Struct({
      application: Schema.NullOr(Schema.String),
      repo: Schema.NullOr(Schema.String),
      githubAppId: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type HqGithubRepository = typeof HqGithubRepository.Type;

/** Where an app is installed, as GitHub answered HQ's read: an account and the repositories it may reach there. */
export const HqGithubReadInstallation = Schema.Struct({
  id: Schema.Number,
  account: Schema.String,
  accountType: Schema.Literals(["Organization", "User"]),
  repositorySelection: Schema.Literals(["all", "selected"]),
  repositories: Schema.Array(HqGithubRepository),
  suspended: Schema.Boolean,
  /**
   * `accepted`: HQ acts on its repositories; `waiting`: nobody here started it, and HQ acts on none
   * of them until an Owner or Admin accepts it; `suspended`: GitHub suspended it.
   */
  state: Schema.Literals(["accepted", "waiting", "suspended"]),
  /** GitHub's page to change which repositories it reaches. */
  manageUrl: Schema.String,
  /** The Zerops user id whose install trip added it; `null` when it was added on GitHub. */
  addedBy: Schema.NullOr(Schema.String),
});
export type HqGithubReadInstallation = typeof HqGithubReadInstallation.Type;

/** An installation GitHub did not answer about at HQ's read: it exists, and nothing else is known. */
export const HqGithubUnreadInstallation = Schema.Struct({
  id: Schema.Number,
  state: Schema.Literal("unknown"),
});

export const HqGithubInstallation = Schema.Union([
  HqGithubReadInstallation,
  HqGithubUnreadInstallation,
]);
export type HqGithubInstallation = typeof HqGithubInstallation.Type;

/** One of the organization's GitHub apps. */
export const HqGithubApp = Schema.Struct({
  /** The app's id on GitHub: what names it on HQ's routes, and the source a ruleset pins `mate/gate` to. */
  appId: Schema.Number,
  /** The app's slug; its bot is `<slug>[bot]`. */
  slug: Schema.String,
  /** The app's name as GitHub shows it ("Acme Mate"); absent from an HQ that keeps none. */
  name: Schema.optionalKey(Schema.String),
  /** What GitHub shows as the author of everything it writes: `<slug>[bot]`. */
  botLogin: Schema.String,
  /** The account that owns the app (an organization or a person). */
  owner: Schema.String,
  /** Whether `owner` is an organization or a person; absent while HQ does not know. */
  ownerType: Schema.optionalKey(Schema.Literals(["User", "Organization"])),
  /** The app's page on GitHub. */
  appUrl: Schema.String,
  /** GitHub's page to install it on more repositories; what is installed from it waits. */
  installUrl: Schema.String,
  /** Whether it installs beyond its owner: `false`, only on `owner`; `null` while GitHub does not say. */
  public: Schema.NullOr(Schema.Boolean),
  /**
   * The Zerops user id of the Owner or Admin who sealed the app's secrets or confirmed it, and when
   * (ISO). Both `null` for an app nobody vouched for: HQ acts with it on nothing
   * (`needs_owner_seal`) until an Owner or Admin makes it again from its manifest.
   */
  sealedBy: Schema.NullOr(Schema.String),
  sealedAt: Schema.NullOr(Schema.String),
  installations: Schema.Array(HqGithubInstallation),
});
export type HqGithubApp = typeof HqGithubApp.Type;

export const HqGithubView = Schema.Struct({
  /** Oldest first; empty while the organization has none. */
  apps: Schema.Array(HqGithubApp),
});
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

export const HqGithubInstallRequest = Schema.Struct({
  /** Where HQ sends the browser once GitHub installed it: a Mate page. */
  returnTo: Schema.String,
});
export type HqGithubInstallRequest = typeof HqGithubInstallRequest.Type;

export const HqGithubInstallView = Schema.Struct({
  /** GitHub's install page, carrying a one-time state binding its return to this request. */
  url: Schema.String,
});
export type HqGithubInstallView = typeof HqGithubInstallView.Type;

export const HqRepoRemoteViaAppRequest = Schema.Struct({
  /** `owner/name` of a repository an app is installed on. */
  repository: Schema.String.check(Schema.isMinLength(3)),
  /**
   * The organization's app to go through. Absent: the one app whose accepted installation reaches
   * the repository; with several, HQ refuses `app_ambiguous`.
   */
  githubAppId: Schema.optionalKey(Schema.Number),
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
