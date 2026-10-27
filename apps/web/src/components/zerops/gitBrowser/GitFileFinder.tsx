/**
 * The file finder: every file at the page's commit, narrowed as a name is typed (`t` opens it).
 * HQ lists the paths once per commit; matching runs here.
 */
import { STILL_READING_HOLD_MS } from "@t3tools/client-runtime/zerops/projections";
import { PATHS_LIMIT } from "@t3tools/shared/hqGitBrowse/paths";
import { useDeferredValue, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";
import type { ProjectFilePickerMatch } from "~/components/files/ProjectFilePicker.logic";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTheme } from "~/hooks/useTheme";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import { useHeldFor } from "~/zerops/useHeldFor";
import { GitReadStopped } from "./GitAtCommit";
import type { GitBrowseSearch } from "./GitBrowseView";
import { FINDER_PAGE, finderMatches } from "./GitFileFinder.logic";

const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** A link to another page of the repository: a plain click opens it here, any other as a link. */
export function GitPageLink({
  to,
  hrefOf,
  navigate,
  className,
  children,
}: {
  readonly to: GitBrowseSearch;
  readonly hrefOf: (search: GitBrowseSearch) => string;
  readonly navigate: (search: GitBrowseSearch) => void;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={hrefOf(to)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** Where a typed query falls in a name or path, its letters marked. */
function Marked({
  value,
  indices,
}: {
  readonly value: string;
  readonly indices: ReadonlyArray<number>;
}) {
  const marked = new Set(indices);
  const parts: ReactNode[] = [];
  let run = "";
  let runMarked = false;
  const flush = (at: number) => {
    if (run === "") return;
    parts.push(
      runMarked ? (
        <strong className="font-semibold text-foreground" key={at}>
          {run}
        </strong>
      ) : (
        run
      ),
    );
    run = "";
  };
  for (let at = 0; at < value.length; at++) {
    if (marked.has(at) !== runMarked) {
      flush(at);
      runMarked = marked.has(at);
    }
    run += value.charAt(at);
  }
  flush(value.length);
  return <>{parts}</>;
}

export function GitFileFinder({
  appId,
  repo,
  sha,
  initialQuery,
  navigate,
  hrefOf,
}: {
  readonly appId: string;
  readonly repo: string;
  /** The commit the page reads. */
  readonly sha: string;
  readonly initialQuery: string;
  readonly navigate: (search: GitBrowseSearch) => void;
  readonly hrefOf: (search: GitBrowseSearch) => string;
}) {
  const { resolvedTheme } = useTheme();
  const [typed, setTyped] = useState(initialQuery);
  const query = useDeferredValue(typed);
  const [shown, setShown] = useState({ of: "", count: FINDER_PAGE });
  const count = shown.of === query ? shown.count : FINDER_PAGE;
  const { view, again } = useGitBrowse({ appId, repo, read: "paths", params: { sha } }, true);
  const paths = view.state === "known" ? view.answer.paths : null;
  // "Reading" only once a read outlasts the usual wait.
  const slow = useHeldFor(view.state === "unread", STILL_READING_HOLD_MS);
  const found = useMemo(
    () => (paths === null ? null : finderMatches(paths, query, count)),
    [paths, query, count],
  );
  const open = (row: ProjectFilePickerMatch): GitBrowseSearch => ({
    rev: sha,
    view: "code",
    path: row.path,
    kind: "file",
  });
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        aria-label="Find a file"
        autoFocus
        placeholder="Find a file by name…"
        value={typed}
        onChange={(event) => setTyped(event.currentTarget.value)}
        onKeyDown={(event) => {
          const first = found?.rows[0];
          if (event.key !== "Enter" || first === undefined) return;
          event.preventDefault();
          navigate(open(first));
        }}
      />
      {view.state === "known" && view.answer.truncated ? (
        <p className="text-xs text-muted-foreground" role="status">
          The finder sees the first {PATHS_LIMIT.toLocaleString("en-US")} files. Search the content
          to reach the rest.
        </p>
      ) : null}
      {found !== null ? (
        found.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {paths?.length === 0 ? "No files here." : "No file at this commit matches that name."}
          </p>
        ) : (
          <ul aria-label="Files" className="flex min-w-0 flex-col">
            {found.rows.map((row) => (
              <li key={row.path}>
                <GitPageLink
                  to={open(row)}
                  hrefOf={hrefOf}
                  navigate={navigate}
                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PierreEntryIcon
                    pathValue={row.path}
                    kind="file"
                    theme={resolvedTheme}
                    className="size-3.5 shrink-0"
                  />
                  <span className="shrink-0 text-muted-foreground">
                    <Marked value={row.name} indices={row.nameMatchIndices} />
                  </span>
                  {row.path === row.name ? null : (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      <Marked value={row.path} indices={row.pathMatchIndices} />
                    </span>
                  )}
                </GitPageLink>
              </li>
            ))}
          </ul>
        )
      ) : view.state === "unread" ? (
        slow ? (
          <p className="text-sm text-muted-foreground" role="status">
            Reading the files…
          </p>
        ) : null
      ) : view.state === "known" ? null : (
        <GitReadStopped view={view} at={{ appId, repo }} onAgain={again} />
      )}
      {found?.more ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShown({ of: query, count: count + FINDER_PAGE })}
          >
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
