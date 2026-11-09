/**
 * The organization's first GitHub app as Git's surfaces once read it (`GitMirrorApp`), read while
 * shown: `null` while HQ is still asked, and a way to ask again after the person changed it on
 * GitHub. Repositories come from every app, so a picker still offers all of them.
 *
 * Removed once the mirror surfaces read useGitMirrorApps.
 */
import {
  appName,
  appRepositories,
  installationStanding,
  unansweredInstallations,
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
  const first = setting.state === "known" ? setting.held.apps[0] : undefined;
  const app: GitMirrorApp | null =
    setting.state === "unread" || setting.state === "reading"
      ? null
      : setting.state === "known" && first !== undefined
        ? {
            kind: "connected",
            name: appName(first),
            appId: first.appId,
            repositories: appRepositories(setting.held),
            installUrl: first.installUrl,
            installTrip: true,
            waiting: setting.held.apps.flatMap((one) =>
              one.installations.flatMap((installation) =>
                installation.state !== "unknown" && installationStanding(installation) === "waiting"
                  ? [
                      {
                        account: installation.account,
                        repositories: installation.repositories.map(
                          (repository) => repository.fullName,
                        ),
                      },
                    ]
                  : [],
              ),
            ),
            unanswered: unansweredInstallations(setting.held),
          }
        : setting.state === "known" || setting.state === "unsupported"
          ? { kind: "none" }
          : // HQ's answer could not be read: nothing is said of an app that may be there.
            { kind: "unknown" };
  return {
    app,
    again,
    install: (returnTo = window.location.href) => {
      if (first === undefined) return;
      void install(first.appId, returnTo).then((url) => {
        if (url !== null) window.location.assign(url);
      });
    },
  };
}
