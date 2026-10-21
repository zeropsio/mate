/** A folder's entries or a file's text as today's source read answers them. */
import { FileIcon, FolderIcon } from "lucide-react";
import type { RepositorySource } from "@t3tools/shared/hqGit";

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
