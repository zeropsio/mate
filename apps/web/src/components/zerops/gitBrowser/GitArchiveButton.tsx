/**
 * Download ZIP and Download tar.gz: the commit the pages read, as one archive the page reads and
 * saves. Read only when asked, and let go once saved; past its size cap the page offers the clone.
 */
import { STILL_READING_HOLD_MS } from "@t3tools/client-runtime/zerops/projections";
import { archiveName, type GitArchiveFormat } from "@t3tools/shared/hqGitBrowse/archive";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { useGitBrowse } from "~/zerops/useGitBrowse";
import { useHeldFor } from "~/zerops/useHeldFor";
import { GitReadStopped } from "./GitAtCommit";

const FORMATS: ReadonlyArray<{ readonly format: GitArchiveFormat; readonly label: string }> = [
  { format: "zip", label: "Download ZIP" },
  { format: "tar.gz", label: "Download tar.gz" },
];

/**
 * The commit's archive, read when asked and saved once it arrives; held by the repository's frame,
 * so it is still saved when the popover closes before it does. One archive is held: the one asked
 * last, until another is asked or the page leaves the repository.
 */
export function useGitArchive(appId: string, repo: string, sha: string | null) {
  const [asked, setAsked] = useState<{
    readonly sha: string;
    readonly format: GitArchiveFormat;
  } | null>(null);
  const current = asked !== null && asked.sha === sha ? asked : null;
  const { view, again } = useGitBrowse(
    {
      appId,
      repo,
      read: "archive",
      // Never asked, nothing is read, whatever commit it names.
      params: { sha: current?.sha ?? sha ?? "0".repeat(40), format: current?.format ?? "zip" },
    },
    current === null ? undefined : true,
  );
  const blob = current !== null && view.state === "known" ? view.answer : null;
  // The held archive's address, made when it is first saved and revoked once another is saved
  // or the page lets it go.
  const address = useRef<{ readonly of: Blob; readonly href: string } | null>(null);
  useEffect(
    () => () => {
      if (address.current !== null) URL.revokeObjectURL(address.current.href);
    },
    [],
  );
  const save = (at: string, format: GitArchiveFormat, archive: Blob) => {
    if (address.current?.of !== archive) {
      if (address.current !== null) URL.revokeObjectURL(address.current.href);
      address.current = { of: archive, href: URL.createObjectURL(archive) };
    }
    const anchor = document.createElement("a");
    anchor.href = address.current.href;
    anchor.download = archiveName(repo, at, format);
    anchor.click();
  };
  // Saved once it arrives, when it is still the one asked.
  const pending = useRef<typeof asked>(null);
  useEffect(() => {
    if (blob === null || current === null || pending.current !== current) return;
    pending.current = null;
    save(current.sha, current.format, blob);
  });
  const reading = current !== null && view.state === "unread";
  const slow = useHeldFor(reading, STILL_READING_HOLD_MS);
  return {
    /** Shown only once asked: a read past its patience, or why it did not arrive. */
    view: current === null ? null : view,
    reading,
    slow,
    again,
    ask: (format: GitArchiveFormat) => {
      if (sha === null) return;
      if (current?.format === format && blob !== null) return save(sha, format, blob);
      if (current?.format === format && view.state === "failed") {
        pending.current = current;
        return again();
      }
      const next = { sha, format };
      pending.current = next;
      setAsked(next);
    },
  };
}

export type GitArchive = ReturnType<typeof useGitArchive>;

export function GitArchiveButton({ archive }: { readonly archive: GitArchive }) {
  const { view, reading, slow, again, ask } = archive;
  return (
    <section aria-label="Download" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-foreground">Download</h2>
      <div className="flex flex-wrap items-center gap-2">
        {FORMATS.map(({ format, label }) => (
          <Button
            key={format}
            variant="secondary"
            size="sm"
            disabled={reading}
            onClick={() => ask(format)}
          >
            {label}
          </Button>
        ))}
      </div>
      {view === null ? null : reading ? (
        slow ? (
          <p className="text-xs text-muted-foreground" role="status">
            Reading the archive…
          </p>
        ) : null
      ) : view.state === "known" || view.state === "unread" ? null : (
        // Its refusal says what to do instead; the page it was asked on stays.
        <GitReadStopped view={view} at={null} onAgain={again} />
      )}
    </section>
  );
}
