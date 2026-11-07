/**
 * The organization's GitHub app as Git's surfaces read it (`GitMirrorApp`), read while shown:
 * `null` while HQ is still asked, and a way to ask again after the person changed it on GitHub.
 */
import {
  appName,
  appRepositories,
  installationStanding,
} from "../components/settings/automationSettings.logic";
import type { GitMirrorApp } from "../components/zerops/gitMirror.logic";
import { useGithubApp } from "./useTaskSourceSettings";

export function useGitMirrorApp(shown = true): {
  readonly app: GitMirrorApp | null;
  readonly again: () => void;
  /** Leaves for GitHub's install page through HQ's trip, coming back to `returnTo` (this page). */
  readonly install: (returnTo?: string) => void;
} {
  const { read, again, install } = useGithubApp(shown);
  const setting = read.setting;
  const app: GitMirrorApp | null =
    setting.state === "unread" || setting.state === "reading"
      ? null
      : setting.state === "known" && setting.held.state === "connected"
        ? {
            kind: "connected",
            name: appName(setting.held),
            ...(setting.held.appId === undefined ? {} : { appId: setting.held.appId }),
            repositories: appRepositories(setting.held),
            installUrl: setting.held.installUrl,
            installTrip: setting.held.public !== undefined,
            waiting: setting.held.installations
              .filter((installation) => installationStanding(installation) === "waiting")
              .map((installation) => ({
                account: installation.account,
                repositories: installation.repositories.map((repository) => repository.fullName),
              })),
          }
        : setting.state === "known" || setting.state === "unsupported"
          ? { kind: "none" }
          : // HQ's answer could not be read: nothing is said of an app that may be there.
            { kind: "unknown" };
  return {
    app,
    again,
    install: (returnTo = window.location.href) => {
      void install(returnTo).then((url) => {
        if (url !== null) window.location.assign(url);
      });
    },
  };
}
