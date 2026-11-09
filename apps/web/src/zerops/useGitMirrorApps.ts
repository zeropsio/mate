/**
 * The organization's GitHub apps as Git's surfaces read them: every app HQ holds for the
 * organization, and every installation of each, read while shown. `null` while HQ is still asked.
 *
 * A repository connects through one app; an account may have more than one app installed on it,
 * so the picker reads installations, each naming its app.
 */
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";

import { appName, installationStanding } from "../components/settings/automationSettings.logic";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";
import { useGithubApp } from "./useTaskSourceSettings";

export interface GitMirrorRepository {
  /** GitHub's repository id; `null` where HQ does not say it. */
  readonly id: number | null;
  /** `owner/name`. */
  readonly fullName: string;
  readonly private: boolean;
  readonly defaultBranch: string;
  /**
   * The Mate code repository already connected to it (any app or a token), else `null`; both
   * names `null` where it is an application the viewer may not read.
   */
  readonly usedBy: { readonly application: string | null; readonly repo: string | null } | null;
}

export interface GitMirrorInstallation {
  readonly installationId: number;
  /** The org app this installation is of. */
  readonly appId: number;
  readonly account: string;
  readonly accountType: "Organization" | "User";
  readonly standing: "accepted" | "waiting" | "suspended";
  /** Zerops user id of the person whose install trip added it; `null` when added on GitHub. */
  readonly addedBy: string | null;
  readonly manageUrl: string;
  readonly repositories: ReadonlyArray<GitMirrorRepository>;
}

export interface GitMirrorAppEntry {
  readonly appId: number;
  /** GitHub's name for the app, else its slug. */
  readonly name: string;
  readonly slug: string;
  /** The GitHub account that owns the app on GitHub. */
  readonly owner: string;
  readonly ownerType: "Organization" | "User" | null;
  readonly botLogin: string;
  /** Zerops user id of the person who set it up (sealed it); `null` while it waits for a Confirm. */
  readonly setUpBy: string | null;
  readonly setUpAt: string | null;
  /** Whether others can install it on their accounts; `null` where GitHub did not say. */
  readonly public: boolean | null;
  readonly installUrl: string;
  readonly appUrl: string;
  /**
   * Whether this person installs it through HQ's trip, which only an Owner or Admin may start (and
   * whose installation comes back accepted); anyone else installs it on GitHub's own page, and
   * what they add waits for an Owner or Admin's OK.
   */
  readonly installTrip: boolean;
  /** Installations GitHub did not answer about. */
  readonly unanswered: number;
}

export type GitMirrorApps =
  | {
      readonly kind: "ready";
      /** Oldest first; empty when the organization has no app. */
      readonly apps: ReadonlyArray<GitMirrorAppEntry>;
      /** Every answered installation of every app. */
      readonly installations: ReadonlyArray<GitMirrorInstallation>;
    }
  /** HQ's answer could not be read: nothing is said of apps that may be there. */
  | { readonly kind: "unknown" };

/** Where this person's last install trip stands: asked, or refused in HQ's words. */
export type GitMirrorInstallAction =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "refused"; readonly words: string };

export function useGitMirrorApps(shown = true): {
  readonly apps: GitMirrorApps | null;
  readonly again: () => void;
  /**
   * Leaves for GitHub's install page of `appId` through HQ's trip, coming back to `returnTo`;
   * resolves `false` where HQ refused or did not answer — its words are `installing`'s.
   */
  readonly install: (appId: number, returnTo?: string) => Promise<boolean>;
  readonly installing: GitMirrorInstallAction;
} {
  const { read, again, install } = useGithubApp(shown);
  const admin = roleAtLeast(useZeropsSessionOptional()?.activeOrganization?.roleCode, "ADMIN");
  const action = read.action;
  const installing: GitMirrorInstallAction =
    action.kind === "working" && action.verb === "github-install"
      ? { kind: "working" }
      : action.kind === "failed" || action.kind === "unresolved"
        ? { kind: "refused", words: action.words }
        : { kind: "idle" };
  const setting = read.setting;
  let apps: GitMirrorApps | null;
  if (setting.state === "unread" || setting.state === "reading") apps = null;
  else if (setting.state === "known")
    apps = {
      kind: "ready",
      apps: setting.held.apps.map((app) => ({
        appId: app.appId,
        name: appName(app),
        slug: app.slug,
        owner: app.owner,
        ownerType: app.ownerType ?? null,
        botLogin: app.botLogin,
        setUpBy: app.sealedBy,
        setUpAt: app.sealedAt,
        public: app.public,
        installUrl: app.installUrl,
        appUrl: app.appUrl,
        installTrip: admin,
        unanswered: app.installations.filter((one) => one.state === "unknown").length,
      })),
      installations: setting.held.apps.flatMap((app) =>
        app.installations.flatMap((installation) => {
          if (installation.state === "unknown") return [];
          const standing = installationStanding(installation);
          if (standing === "unknown") return [];
          return [
            {
              installationId: installation.id,
              appId: app.appId,
              account: installation.account,
              accountType: installation.accountType,
              standing,
              addedBy: installation.addedBy,
              manageUrl: installation.manageUrl,
              repositories: installation.repositories,
            },
          ];
        }),
      ),
    };
  // An HQ before the app list: none is said to be there.
  else if (setting.state === "unsupported") apps = { kind: "ready", apps: [], installations: [] };
  else apps = { kind: "unknown" };
  return {
    apps,
    again,
    install: async (appId, returnTo = window.location.href) => {
      const url = await install(appId, returnTo);
      if (url === null) return false;
      window.location.assign(url);
      return true;
    },
    installing,
  };
}
