/**
 * The repository's search page at the commit its branch, tag or commit names: a file by name
 * (the finder) or lines by content (`git grep` on HQ), each match opening its file at its line.
 */
import { STILL_READING_HOLD_MS } from "@t3tools/client-runtime/zerops/projections";
import { grepFiles } from "@t3tools/client-runtime/zerops/gitBrowse/grep";
import {
  GREP_MATCH_LIMIT,
  GREP_QUERY_MIN,
  type GitGrepMatch,
} from "@t3tools/shared/hqGitBrowse/grep";
import { useMemo, useState } from "react";
import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import { HighlightedSearchLine } from "~/components/search/HighlightedSearchLine";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Toggle } from "~/components/ui/toggle";
import { Toggle as GroupToggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useTheme } from "~/hooks/useTheme";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import { useHeldFor } from "~/zerops/useHeldFor";
import type { GitBrowseSearch, GitRepoPageProps } from "./GitBrowseView";
import { GitFileFinder, GitPageLink } from "./GitFileFinder";

/** Lines mounted at first and added on each "Show more": each is highlighted. */
const RESULTS_PAGE = 100;

const SCOPES = [
  { value: "name", label: "File name" },
  { value: "content", label: "Content" },
] as const;

const splitPath = (path: string) => {
  const at = path.lastIndexOf("/");
  return at === -1
    ? { name: path, folder: "" }
    : { name: path.slice(at + 1), folder: path.slice(0, at) };
};

/** A file of the page's commit opened at a line. */
const fileAt = (sha: string, path: string, line?: number): GitBrowseSearch => ({
  rev: sha,
  view: "code",
  path,
  kind: "file",
  ...(line === undefined ? {} : { lines: `L${line}` }),
});

function ContentSearch({
  appId,
  repo,
  sha,
  search,
  navigate,
  hrefOf,
}: Pick<GitRepoPageProps, "appId" | "repo" | "search" | "navigate" | "hrefOf"> & {
  readonly sha: string;
}) {
  const { resolvedTheme } = useTheme();
  const q = search.q ?? "";
  const regex = search.mode === "regex";
  const folder = search.path ?? "";
  const [typed, setTyped] = useState(q);
  const [typedFolder, setTypedFolder] = useState(folder);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [tooShort, setTooShort] = useState(false);
  const asked = q.length >= GREP_QUERY_MIN;
  const ask = (next: { q: string; regex: boolean; folder: string }) =>
    navigate({
      ...(search.rev === undefined ? {} : { rev: search.rev }),
      view: "search",
      scope: "content",
      q: next.q,
      ...(next.regex ? { mode: "regex" as const } : {}),
      ...(next.folder === "" ? {} : { path: next.folder }),
    });
  const params = {
    sha,
    q,
    ...(regex ? { mode: "regex" as const } : {}),
    ...(folder === "" ? {} : { path: folder }),
    ...(caseSensitive ? { case: "1" as const } : {}),
  };
  const { view, again } = useGitBrowse(
    { appId, repo, read: "grep", params },
    asked ? true : undefined,
  );
  const identity = JSON.stringify(params);
  const [shown, setShown] = useState({ of: "", count: RESULTS_PAGE });
  const count = shown.of === identity ? shown.count : RESULTS_PAGE;
  const answer = view.state === "known" ? view.answer : null;
  const files = useMemo(
    () => (answer === null ? [] : grepFiles(answer.matches.slice(0, count))),
    [answer, count],
  );
  const fileCount = useMemo(
    () => (answer === null ? 0 : new Set(answer.matches.map((match) => match.path)).size),
    [answer],
  );
  const slow = useHeldFor(asked && view.state === "unread", STILL_READING_HOLD_MS);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form
        aria-label="Search the content"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = typed.trim();
          setTooShort(next.length < GREP_QUERY_MIN);
          if (next.length >= GREP_QUERY_MIN) ask({ q: next, regex, folder: typedFolder.trim() });
        }}
      >
        <div className="min-w-64 flex-1">
          <Input
            aria-label="Text to search for"
            autoFocus
            maxLength={200}
            placeholder={regex ? "Regular expression…" : "Text to search for…"}
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
        </div>
        <div className="w-56">
          <Input
            aria-label="In folder"
            placeholder="In folder (optional)"
            value={typedFolder}
            onChange={(event) => setTypedFolder(event.currentTarget.value)}
          />
        </div>
        <Toggle
          aria-label="Match case"
          pressed={caseSensitive}
          size="sm"
          variant="outline"
          onPressedChange={setCaseSensitive}
        >
          Aa
        </Toggle>
        <Toggle
          aria-label="Use regular expression"
          pressed={regex}
          size="sm"
          variant="outline"
          onPressedChange={(pressed) => {
            if (asked) ask({ q, regex: pressed, folder });
            else
              navigate({
                ...(search.rev === undefined ? {} : { rev: search.rev }),
                view: "search",
                scope: "content",
                ...(pressed ? { mode: "regex" as const } : {}),
              });
          }}
        >
          .*
        </Toggle>
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>
      {tooShort ? (
        <p className="text-sm text-muted-foreground" role="status">
          Type at least {GREP_QUERY_MIN} characters to search.
        </p>
      ) : null}
      {!asked ? (
        <p className="text-sm text-muted-foreground">
          Search every text file at this commit. Binary files are not searched.
        </p>
      ) : answer !== null ? (
        <>
          <p className="text-xs text-muted-foreground" role="status">
            {answer.matches.length === 0
              ? "No line at this commit matches."
              : `${answer.matches.length.toLocaleString("en-US")} matching lines in ${fileCount.toLocaleString("en-US")} ${fileCount === 1 ? "file" : "files"}`}
          </p>
          {answer.deadlineHit ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-status-attention" role="alert">
                The search stopped after 10 seconds. Narrow it to a folder.
              </p>
              <Button variant="ghost" size="sm" onClick={again}>
                Read again
              </Button>
            </div>
          ) : answer.truncated ? (
            <p className="text-sm text-status-attention" role="alert">
              The search stops at {GREP_MATCH_LIMIT} matches. Narrow the search.
            </p>
          ) : null}
          <div className="flex min-w-0 flex-col gap-3">
            {files.map((file) => {
              const { name, folder: inFolder } = splitPath(file.path);
              return (
                <section key={file.path} aria-label={file.path} className="flex min-w-0 flex-col">
                  <GitPageLink
                    to={fileAt(sha, file.path)}
                    hrefOf={hrefOf}
                    navigate={navigate}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PierreEntryIcon
                      pathValue={file.path}
                      kind="file"
                      theme={resolvedTheme}
                      className="size-3.5 shrink-0"
                    />
                    <span className="shrink-0 font-medium text-foreground">{name}</span>
                    <span className="min-w-0 truncate text-muted-foreground">{inFolder}</span>
                  </GitPageLink>
                  {file.matches.map((match: GitGrepMatch) => (
                    <GitPageLink
                      key={`${match.path}:${match.line}`}
                      to={fileAt(sha, match.path, match.line)}
                      hrefOf={hrefOf}
                      navigate={navigate}
                      className="flex h-7 min-w-0 items-center gap-3 rounded-md px-2 font-mono text-xs hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                        {match.line}
                      </span>
                      <span className="min-w-0 flex-1 truncate whitespace-pre">
                        <HighlightedSearchLine
                          match={{
                            path: match.path,
                            lineNumber: match.line,
                            lineContent: match.text,
                            matchRanges: match.ranges,
                          }}
                          path={match.path}
                          theme={resolvedTheme}
                        />
                      </span>
                    </GitPageLink>
                  ))}
                </section>
              );
            })}
          </div>
          {answer.matches.length > count ? (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShown({ of: identity, count: count + RESULTS_PAGE })}
              >
                Show more
              </Button>
            </div>
          ) : null}
        </>
      ) : view.state !== "failed" && view.state !== "refused" ? (
        slow ? (
          <p className="text-sm text-muted-foreground" role="status">
            Searching…
          </p>
        ) : null
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-status-failed" role="alert">
            {view.state === "refused" && view.reason === "invalid" && regex
              ? "Git cannot read this regular expression. Check it, or search for the text as written."
              : view.words}
          </p>
          <Button variant="ghost" size="sm" onClick={again}>
            Read again
          </Button>
        </div>
      )}
    </div>
  );
}

export function GitSearchView(props: GitRepoPageProps) {
  const { appId, repo, home, search, navigate, hrefOf, onHomeAgain } = props;
  const scope = search.scope ?? "name";
  const slow = useHeldFor(home.state === "unread", STILL_READING_HOLD_MS);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ToggleGroup
        aria-label="Search by"
        variant="segmented"
        value={[scope]}
        onValueChange={(value) => {
          const next = value[0] === "content" ? "content" : "name";
          navigate({
            ...(search.rev === undefined ? {} : { rev: search.rev }),
            view: "search",
            scope: next,
            ...(search.q === undefined ? {} : { q: search.q }),
          });
        }}
      >
        {SCOPES.map((option) => (
          <GroupToggle key={option.value} value={option.value}>
            {option.label}
          </GroupToggle>
        ))}
      </ToggleGroup>
      {home.state === "known" ? (
        home.answer.sha === null ? (
          <p className="text-sm text-muted-foreground">No commits on this branch yet.</p>
        ) : scope === "name" ? (
          <GitFileFinder
            key={home.answer.sha}
            appId={appId}
            repo={repo}
            sha={home.answer.sha}
            initialQuery={search.q ?? ""}
            navigate={navigate}
            hrefOf={hrefOf}
          />
        ) : (
          <ContentSearch
            key={`${home.answer.sha}:${search.q ?? ""}:${search.path ?? ""}`}
            appId={appId}
            repo={repo}
            sha={home.answer.sha}
            search={search}
            navigate={navigate}
            hrefOf={hrefOf}
          />
        )
      ) : home.state === "withheld" ? null : home.state === "unread" ? (
        slow ? (
          <p className="text-sm text-muted-foreground" role="status">
            Reading the repository…
          </p>
        ) : null
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-status-failed" role="alert">
            {home.state === "refused" && home.reason === "commit_not_found"
              ? "This branch, tag or commit is not in the repository."
              : home.words}
          </p>
          <Button variant="ghost" size="sm" onClick={onHomeAgain}>
            Read again
          </Button>
        </div>
      )}
    </div>
  );
}
