/**
 * A folder or file of the repository at the page's branch, tag or commit, read by today's source
 * read until the tree and file view replaces it.
 */
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { useRepositorySource } from "~/zerops/useRepositorySource";
import { ZeropsRepositorySource } from "../ZeropsRepositorySource";
import type { GitRepoPageProps } from "./GitBrowseView";

export function GitRepoCode({ appId, repo, search, navigate }: GitRepoPageProps) {
  const path = search.path ?? "";
  const kind = search.kind ?? "tree";
  const { source, again } = useRepositorySource(
    {
      appId,
      repo,
      query: { ...(search.rev === undefined ? {} : { rev: search.rev }), path, kind },
    },
    true,
  );
  // A link out of what was read names the commit it was read at, never the branch that may move.
  const rev =
    source.state === "known" && source.source.revision !== null
      ? source.source.revision
      : search.rev;
  const open = (next: { readonly path: string; readonly kind: "tree" | "file" }) =>
    navigate({ ...(rev === undefined ? {} : { rev }), view: "code", ...next });
  return (
    <Card variant="flat">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
            {path || "/"}
          </span>
          <Button variant="ghost" size="sm" disabled={source.busy} onClick={again}>
            {source.busy ? "Reading source…" : "Read again"}
          </Button>
          {path !== "" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => open({ path: path.split("/").slice(0, -1).join("/"), kind: "tree" })}
            >
              Up one folder
            </Button>
          ) : null}
        </div>
        {source.state === "known" ? (
          <>
            {source.failed ? (
              <p className="text-sm text-status-failed" role="alert">
                HQ could not read this repository again. Showing the last read source.
              </p>
            ) : null}
            <ZeropsRepositorySource
              source={source.source}
              onOpen={(next, nextKind) => open({ path: next, kind: nextKind })}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role={source.alert ? "alert" : "status"}>
            {source.state === "reading" ? "Reading source…" : source.words}
          </p>
        )}
      </div>
    </Card>
  );
}
