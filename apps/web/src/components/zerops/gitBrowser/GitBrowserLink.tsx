/**
 * A link from another page of Mate into the Git browser (`/git`): a review's file and commits, a
 * history's commits, what a release puts live. Its address opens in a new tab; a plain click is the
 * app's own navigation, and a dialog it sits in closes first ({@link LeaveForGitContext}).
 */
import { defaultStringifySearch, useRouter } from "@tanstack/react-router";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";

import { appBasePath } from "~/basePath";
import type { GitSearch } from "~/routes/git";

import { InlineButton } from "../../ui/button";

/** Where a link lands: one repository of one application, and the page in it. */
export type GitLink = GitSearch & { readonly appId: string; readonly repo: string };

/** The repository a link opens. */
export interface GitRepoAt {
  readonly appId: string;
  readonly repo: string;
}

/** A commit's page: its message and files. */
export const gitCommitLink = (at: GitRepoAt, sha: string): GitLink => ({
  appId: at.appId,
  repo: at.repo,
  rev: sha,
  view: "commit",
});

/** The repository's files as one commit holds them. */
export const gitCodeLink = (at: GitRepoAt, sha: string): GitLink => ({
  appId: at.appId,
  repo: at.repo,
  rev: sha,
  view: "code",
});

/** One file at one commit, at a line where one is named. */
export const gitFileLink = (
  at: GitRepoAt,
  sha: string,
  path: string,
  line?: number | undefined,
): GitLink => ({
  appId: at.appId,
  repo: at.repo,
  rev: sha,
  view: "code",
  kind: "file",
  path,
  ...(line === undefined ? {} : { lines: `L${String(line)}` }),
});

/** The link's address, as the router writes it, so a new tab opens the same page. */
export const gitHref = (link: GitSearch): string =>
  `${appBasePath()}/git${defaultStringifySearch(link)}`;

/** What a dialog does as one of its links leaves it for the browser: closes itself. */
export const LeaveForGitContext = createContext<(() => void) | null>(null);

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** An anchor's `href` and `onClick` for a link into the browser, or to Git where it names none. */
export function useGitLinkProps(link: GitSearch): {
  readonly href: string;
  readonly onClick: (event: MouseEvent) => void;
} {
  const router = useRouter({ warn: false });
  const leave = useContext(LeaveForGitContext);
  return {
    href: gitHref(link),
    onClick: (event) => {
      if (router === undefined || !plainClick(event)) return;
      event.preventDefault();
      leave?.();
      void router.navigate({ to: "/git", search: link });
    },
  };
}

/** An inline link into the browser, in a line of text. */
export function GitBrowserLink({
  to,
  tone,
  children,
}: {
  readonly to: GitSearch;
  readonly tone?: "default" | "muted";
  readonly children: ReactNode;
}) {
  const props = useGitLinkProps(to);
  return (
    <InlineButton render={<a {...props} />} tone={tone}>
      {children}
    </InlineButton>
  );
}
