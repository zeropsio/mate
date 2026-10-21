/**
 * The repository's pages, one line each in {@link VIEWS} and one tab in {@link GIT_VIEW_TABS}:
 * each page is its own chunk, so opening `/git` loads none of what another page draws with.
 */
import type { GitBrowseView as GitBrowseState } from "@t3tools/client-runtime/data";
import type { GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import type { RepositoryTarget } from "@t3tools/client-runtime/zerops/hq";
import type { GitHome } from "@t3tools/shared/hqGitBrowse/home";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { isEditableFocused } from "~/lib/editableFocus";
import type { GitSearch } from "~/routes/git";
import type { useRepositorySource } from "~/zerops/useRepositorySource";

export type GitView = NonNullable<GitSearch["view"]>;
/** A link inside one repository: everything `/git` carries but which repository it is. */
export type GitBrowseSearch = Omit<GitSearch, "appId" | "repo">;

/** What every page of a repository is given. */
export interface GitRepoPageProps {
  readonly appId: string;
  readonly repo: string;
  readonly project: string;
  readonly search: GitBrowseSearch;
  /** The home read the frame holds: the commit the page's ref names now. */
  readonly home: GitBrowseState<GitHome>;
  readonly onHomeAgain: () => void;
  /**
   * The source read the page draws ({@link pageSource}), held by the frame: its refusal withholds
   * the whole repository, never only the listing.
   */
  readonly source: ReturnType<typeof useRepositorySource>;
  readonly repository?: GitOverviewRepository | undefined;
  readonly changesFailure?: string | undefined;
  readonly onReadChanges?: (() => void) | undefined;
  readonly onOpenChange?: ((number: number) => void) | undefined;
  readonly navigate: (search: GitBrowseSearch) => void;
  readonly hrefOf: (search: GitBrowseSearch) => string;
}

/** The page a link names: its `view`; absent, home, or code where it names a path or kind. */
export const gitView = (search: Pick<GitSearch, "view" | "path" | "kind">): GitView =>
  search.view ?? (search.path !== undefined || search.kind !== undefined ? "code" : "home");

/**
 * The source read a page draws: home's top folder at the commit it resolved, code's path; none for
 * a page that reads no source. A view without a page draws home.
 */
export const pageSource = (
  view: GitView,
  search: GitBrowseSearch,
  home: GitBrowseState<GitHome>,
): RepositoryTarget["query"] | null => {
  const page = VIEWS[view] === undefined ? "home" : view;
  if (page === "code")
    return {
      ...(search.rev === undefined ? {} : { rev: search.rev }),
      path: search.path ?? "",
      kind: search.kind ?? "tree",
    };
  return page === "home" && home.state === "known" && home.answer.sha !== null
    ? { rev: home.answer.sha, path: "", kind: "tree" }
    : null;
};

const VIEWS: Partial<Record<GitView, ComponentType<GitRepoPageProps>>> = {
  home: lazy(() => import("./GitRepoHome").then((module) => ({ default: module.GitRepoHome }))),
  code: lazy(() => import("./GitRepoCode").then((module) => ({ default: module.GitRepoCode }))),
  commits: lazy(() =>
    import("./GitCommitsView").then((module) => ({ default: module.GitCommitsView })),
  ),
  search: lazy(() =>
    import("./GitSearchView").then((module) => ({ default: module.GitSearchView })),
  ),
};

/** The repository's tabs, each opening its first page and lit on any of them. */
export const GIT_VIEW_TABS: ReadonlyArray<{
  readonly label: string;
  readonly views: ReadonlyArray<GitView>;
}> = [
  { label: "Code", views: ["home", "code"] },
  { label: "History", views: ["commits"] },
  { label: "Search", views: ["search"] },
];

export function GitBrowseView(props: GitRepoPageProps & { readonly view: GitView }) {
  const View = VIEWS[props.view] ?? VIEWS.home!;
  const { navigate } = props;
  const { rev } = props.search;
  // `t` finds a file by name, from any page of the repository.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "t" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isEditableFocused(event.target)) return;
      event.preventDefault();
      navigate({ ...(rev === undefined ? {} : { rev }), view: "search", scope: "name" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, rev]);
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Opening…</p>}>
      <View {...props} />
    </Suspense>
  );
}
