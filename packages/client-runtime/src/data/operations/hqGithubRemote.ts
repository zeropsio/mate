/**
 * A repository mirrored to GitHub through the organization's GitHub app, with no token: HQ's
 * answer starts it, and its repository record — the remote at that repository, reached through the
 * app — is what ends it, so the mirror dialog says *Saving…* until the record shows it.
 *
 * @module data/operations/hqGithubRemote
 */
import type { OperationKind } from "./kind.ts";
import { shownInFacts } from "./shownInFacts.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "connect-git-remote-via-app": {
      readonly orgId: string;
      readonly appId: string;
      /** HQ's repository: `appdev`. */
      readonly repo: string;
      /** The GitHub repository the app is installed on: `owner/name`. */
      readonly repository: string;
    };
  }
}

/** `owner/name` of a GitHub address, lowercased; null for any other. */
export function githubFullName(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== "github.com") return null;
  const [owner, name] = parsed.pathname
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .split("/");
  return owner === undefined || name === undefined || owner === "" || name === ""
    ? null
    : `${owner}/${name}`.toLowerCase();
}

export const connectGitRemoteViaApp: OperationKind<"connect-git-remote-via-app"> = {
  kind: "connect-git-remote-via-app",
  executor: "hq",
  ...shownInFacts(
    (intent) => intent.appId,
    (read, intent) => {
      const repos = read.fact("hqAppDetail", `${intent.appId}/repos`);
      if (repos.kind !== "known" || repos.value.kind !== "repos") return false;
      const remote = repos.value.value.find((repo) => repo.name === intent.repo)?.remote;
      return (
        remote != null &&
        remote.via === "app" &&
        githubFullName(remote.url) === intent.repository.toLowerCase()
      );
    },
  ),
  observedIn: (intent) => ({ family: "hqAppDetail", ownerId: intent.appId }),
};
