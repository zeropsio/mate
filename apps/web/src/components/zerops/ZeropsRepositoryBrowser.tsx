import { useState } from "react";
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
      ) : source.entries.length === 0 ? (
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
                  className="min-w-0 cursor-pointer truncate rounded-sm text-left text-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  onClick={() =>
                    onOpen(
                      [source.path, entry.path].filter(Boolean).join("/"),
                      entry.type === "tree" ? "tree" : "file",
                    )
                  }
                >
                  {entry.path}
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
  allowed,
  repo,
  query,
  onNavigate,
  onBack,
}: {
  readonly appId: string;
  readonly allowed: boolean | undefined;
  readonly repo: string;
  readonly query: RepositoryQuery;
  readonly onNavigate: (query: RepositoryQuery) => void;
  readonly onBack: () => void;
}) {
  const [cloneOpen, setCloneOpen] = useState(false);
  const { source, again } = useRepositorySource({ appId, repo, query }, allowed);
  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-foreground">{repo}</h2>
      <Button variant="ghost" size="sm" onClick={onBack}>
        Back to repositories
      </Button>
    </div>
  );
  if (source.state !== "known") {
    return (
      <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
        {heading}
        <p className="text-sm text-muted-foreground" role={source.alert ? "alert" : "status"}>
          {source.words}
        </p>
        <div>
          <Button variant="ghost" size="sm" disabled={source.busy} onClick={again}>
            Read again
          </Button>
        </div>
      </section>
    );
  }
  const { source: value, busy, failed } = source;
  return (
    <section className="flex min-w-0 flex-col gap-4" data-zerops-surface="repository-browser">
      {heading}
      <details onToggle={(event) => setCloneOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm text-message-action">Clone with HTTPS</summary>
        <div className="pt-3">
          {cloneOpen ? <ZeropsGitCredentials appId={appId} repo={repo} /> : null}
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Branch
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            value={value.branches.find((branch) => branch.sha === value.revision)?.ref ?? ""}
            onChange={(event) => onNavigate({ rev: event.target.value, path: "", kind: "tree" })}
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
        <Button variant="ghost" size="sm" disabled={busy} onClick={again}>
          {busy ? "Reading…" : "Read again"}
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
      {failed ? (
        <p className="text-sm text-status-failed" role="alert">
          HQ could not read this repository again.
        </p>
      ) : null}
      <>
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
    </section>
  );
}
