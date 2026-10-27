/**
 * The organization's GitHub app as Git's surfaces read it (`GitMirrorApp`), read while shown:
 * `null` while HQ is still asked, and a way to ask again after the person changed it on GitHub.
 */
import { appName, appRepositories } from "../components/settings/automationSettings.logic";
import type { GitMirrorApp } from "../components/zerops/gitMirror.logic";
import { useGithubApp } from "./useTaskSourceSettings";

export function useGitMirrorApp(shown = true): {
  readonly app: GitMirrorApp | null;
  readonly again: () => void;
} {
  const { read, again } = useGithubApp(shown);
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
          }
        : setting.state === "known" || setting.state === "unsupported"
          ? { kind: "none" }
          : // HQ's answer could not be read: nothing is said of an app that may be there.
            { kind: "unknown" };
  return { app, again };
}
