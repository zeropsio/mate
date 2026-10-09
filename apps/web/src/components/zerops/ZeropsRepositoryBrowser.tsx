import { FileIcon, FolderIcon } from "lucide-react";
import { useState } from "react";
import type { GitOverviewRepository } from "@t3tools/client-runtime/zerops";
import { FlatCard } from "./primitives";
import { ZeropsGitChangeRow } from "./ZeropsGitChangeRow";
import { ZeropsGitCredentials } from "./ZeropsGitCredentials";
import type { RepositorySource, RepositoryQuery } from "@t3tools/shared/hqGit";
import { Button } from "~/components/ui/button";
import { useRepositorySource } from "~/zerops/useRepositorySource";

export function ZeropsRepositorySource({
  source,
  onOpen,
}: {
  readonly source: RepositorySource;
  readonly onOpen: (path: string, kind: "tree" | "file") => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {source.kind === "file" ? (
        source.binary ? (
          <p className="text-sm text-muted-foreground">
            Binary file. Clone the repository to read it.
          </p>
        ) : (
          <pre className="overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs text-foreground">
            <code>{source.content}</code>
          </pre>
        )
      ) : source.revision === null ? (
        <p className="text-sm text-muted-foreground">No commits on this branch yet.</p>
      ) : source.entries.length === 0 && !source.truncated ? (
        <p className="text-sm text-muted-foreground">No files here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {source.entries.map((entry) => (
            <li className="flex min-h-10 items-center justify-between gap-3" key={entry.path}>
              {entry.type === "commit" ? (
                <span className="text-sm text-foreground">
                  {entry.path} · submodule {entry.sha.slice(0, 7)}
                </span>
              ) : (
                <button
                  className="flex min-w-0 cursor-pointer items-center gap-3 rounded-sm text-left text-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  onClick={() =>
                    onOpen(
                      [source.path, entry.path].filter(Boolean).join("/"),
                      entry.type === "tree" ? "tree" : "file",
                    )
                  }
                >
                  {entry.type === "tree" ? (
                    <FolderIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{entry.path}</span>
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {entry.type === "tree"
                  ? "Folder"
                  : entry.mode === "120000"
                    ? "Symbolic link"
                    : entry.type === "commit"
                      ? "Submodule"
                      : "File"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {source.truncated ? (
        <p className="text-sm text-muted-foreground">
          Only the first{" "}
          {source.kind === "file"
            ? "256 KiB are shown. Clone to read the whole file."
            : "entries are shown. Clone to read the whole directory."}
        </p>
      ) : null}
    </div>
  );
}

export function ZeropsRepositoryBrowser({
  appId,
  project,
  repository,
  changesFailure,
  onReadChanges,
  onOpenChange,
  allowed,
  accessReason,
  repo,
  query,
  onNavigate,
  onBack,
}: {
  readonly appId: string;
  readonly project: string;
  readonly repository?: GitOverviewRepository | undefined;
  readonly changesFailure?: string | undefined;
  readonly onReadChanges?: (() => void) | undefined;
  readonly onOpenChange?: ((number: number) => void) | undefined;
  readonly allowed: boolean | undefined;
  readonly accessReason?: string | undefined;
  readonly repo: string;
  readonly query: RepositoryQuery;
  readonly onNavigate: (query: RepositoryQuery) => void;
  readonly onBack: () => void;
}) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const { source, again } = useRepositorySource({ appId, repo, query }, allowed);
  const heading = (
    <>
      <nav className="flex min-w-0 flex-wrap items-center gap-2 text-sm" aria-label="Repository">
        <button
          type="button"
          className="cursor-pointer rounded-sm text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onBack}
        >
          Git
        </button>
        <span className="text-muted-foreground"> / {project} / </span>
        <span className="break-all font-medium text-foreground">{repo}</span>
        {repo === "group" ? <span className="text-xs text-muted-foreground">Recipe</span> : null}
      </nav>
      <div>
        <h1 className="text-xl font-medium text-foreground">{repo}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {project}’s {repo === "group" ? "recipe repository" : "repository"}
        </p>
      </div>
    </>
  );
  if (allowed !== true || source.state === "withheld") {
    return (
      <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
        {heading}
        <p className="text-sm text-muted-foreground" role="alert">
          {(source.state === "withheld" ? source.words : accessReason) ??
            (allowed === undefined
              ? "Your access to this repository has not been verified."
              : "You do not have access to this repository.")}
        </p>
      </section>
    );
  }
  const value = source.state === "known" ? source.source : undefined;
  return (
    <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
      {heading}
      <section aria-label="Open changes" className="flex flex-col gap-2">
        <h2 className="text-base font-medium text-foreground">Open changes</h2>
        {changesFailure === undefined ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-status-failed" role="alert">
              {changesFailure}
            </p>
            <Button variant="ghost" size="sm" onClick={onReadChanges}>
              Read again
            </Button>
          </div>
        )}
        {repository === undefined || repository.coverage === "unread" ? (
          <p className="text-sm text-muted-foreground">Changes not read yet.</p>
        ) : repository.coverage === "failed" ? (
          <p className="text-sm text-muted-foreground">Showing the last read changes.</p>
        ) : null}
        {repository !== undefined && repository.changes.length > 0 ? (
          <FlatCard>
            <div className="divide-y divide-border px-4 py-1">
              {repository.changes.map((change) => (
                <ZeropsGitChangeRow
                  key={change.pull.number}
                  change={change}
                  project={project}
                  repo={repo}
                  onOpen={
                    onOpenChange === undefined ? undefined : () => onOpenChange(change.pull.number)
                  }
                />
              ))}
            </div>
          </FlatCard>
        ) : repository?.coverage === "complete" ? (
          <p className="text-sm text-muted-foreground">No open changes.</p>
        ) : null}
      </section>
      <FlatCard>
        <details className="px-4 py-3" onToggle={(event) => setCloneOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Clone with HTTPS
          </summary>
          <div className="pt-3">
            {cloneOpen ? <ZeropsGitCredentials appId={appId} repo={repo} /> : null}
          </div>
        </details>
      </FlatCard>
      <section aria-label="Source" className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-base font-medium text-foreground">Source</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Browsing source does not switch a Mate’s checkout.
          </p>
        </div>
        <FlatCard>
          <div className="flex min-w-0 flex-col gap-3 p-4">
            {source.state !== "known" ? (
              <>
                <p
                  className="text-sm text-muted-foreground"
                  role={source.alert ? "alert" : "status"}
                >
                  {source.state === "reading" ? "Reading source…" : source.words}
                </p>
                <div>
                  <Button variant="ghost" size="sm" disabled={source.busy} onClick={again}>
                    Read again
                  </Button>
                </div>
              </>
            ) : null}
            {value === undefined ? null : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Branch
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
                      value={
                        value.branches.find((branch) => branch.ref === query.rev)?.ref ??
                        value.branches.find((branch) => branch.sha === value.revision)?.ref ??
                        ""
                      }
                      onChange={(event) =>
                        onNavigate({ rev: event.target.value, path: "", kind: "tree" })
                      }
                    >
                      <option value="" disabled>
                        Commit {value.revision?.slice(0, 7) ?? "unborn"}
                      </option>
                      {value.branches.map((branch) => (
                        <option key={branch.ref} value={branch.ref}>
                          {branch.ref.replace(/^refs\/heads\//u, "")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                    {query.path || "/"}
                    {value?.revision ? ` · ${value.revision.slice(0, 7)}` : ""}
                  </span>
                  <Button variant="ghost" size="sm" disabled={source.busy} onClick={again}>
                    {source.busy ? "Reading source…" : "Read again"}
                  </Button>
                </div>
                {query.path !== "" ? (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onNavigate({
                          ...(value?.revision ? { rev: value.revision } : {}),
                          path: query.path.split("/").slice(0, -1).join("/"),
                          kind: "tree",
                        })
                      }
                    >
                      Up one folder
                    </Button>
                  </div>
                ) : null}
                {source.state === "known" && source.failed ? (
                  <p className="text-sm text-status-failed" role="alert">
                    HQ could not read this repository again. Showing the last read source.
                  </p>
                ) : null}
                {value.branchesTruncated ? (
                  <p className="text-sm text-muted-foreground">
                    Only the first branches are listed. Clone to see them all.
                  </p>
                ) : null}
                <ZeropsRepositorySource
                  source={value}
                  onOpen={(path, kind) =>
                    onNavigate({ ...(value.revision ? { rev: value.revision } : {}), path, kind })
                  }
                />
              </>
            )}
          </div>
        </FlatCard>
      </section>
    </section>
  );
}
