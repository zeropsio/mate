/**
 * What has happened to a codebase, drawn the way the menu draws a project.
 *
 * The version on a stop used to be a link into Gitea and *History* a second
 * one. Neither worked: the app holds the only Gitea token, so a person's
 * browser has no session there and both landed on a sign-in page (measured
 * 2026-09-19). Gitea answers this perfectly well as an API, so the answer is
 * drawn here instead of handed off — "we can still make the system available,
 * just give the basic functions our face" (the owner, 2026-09-19).
 *
 * Same language as the left menu: one spine, a node per commit, and the stops
 * that are running a commit wear their name on it. The rows sit flush and the
 * rail is opaque for the same reason they are there.
 *
 * Structural only: the folding is `groupHistory`'s (R5), the reading is the
 * caller's.
 */
import { groupHistory, historyLine, type HistoryEntry } from "@t3tools/client-runtime/zerops";

import type { ZeropsCommitsState } from "~/zerops/useZeropsRepositoryCommits";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/** What the dialog is looking at, and what the reads answered. */
export interface ZeropsHistoryRequest {
  /** The repository, as the recipe names it — never guessed from a hostname. */
  readonly repo: string;
  /** `environment name → the whole sha it runs`. */
  readonly deployed: ReadonlyMap<string, string>;
}

export function ZeropsHistoryView({
  request,
  commits,
}: {
  readonly request: ZeropsHistoryRequest;
  readonly commits: ZeropsCommitsState;
}) {
  if (commits.kind === "no-gitea") {
    return <HistoryNote>Sign in to Gitea to read this repository&rsquo;s history.</HistoryNote>;
  }
  if (commits.kind === "failed") {
    return <HistoryNote>{commits.reason}</HistoryNote>;
  }
  if (commits.kind === "reading") {
    return <HistoryNote>Reading the history&hellip;</HistoryNote>;
  }
  const entries = groupHistory({
    commits: commits.commits,
    deployed: request.deployed,
    // A release tag lives on the group repository and names each service's
    // commit in its message, so it cannot be matched to this repository's
    // history by sha. Folding releases on is its own piece of work.
    tags: new Map(),
  });
  if (entries.length === 0) {
    return <HistoryNote>Nothing has landed on this repository yet.</HistoryNote>;
  }
  return (
    <ul className="flex flex-col" data-zerops-surface="zerops-history">
      {entries.map((entry, index) => (
        <HistoryRow
          entry={entry}
          first={index === 0}
          key={entry.sha}
          last={index === entries.length - 1}
        />
      ))}
    </ul>
  );
}

function HistoryRow({
  entry,
  first,
  last,
}: {
  readonly entry: HistoryEntry;
  readonly first: boolean;
  readonly last: boolean;
}) {
  const line = historyLine(entry);
  const live = entry.deployedTo.length > 0;
  return (
    <li className="flex min-w-0 items-stretch gap-2.5" data-zerops-surface="zerops-history-commit">
      <span className="relative flex w-5 shrink-0 flex-col items-center self-stretch">
        <span aria-hidden="true" className={first ? RAIL_BLANK : RAIL_LINE} />
        {/* A commit something is running is a stop on this line, so it is the
            same filled node the menu gives one; the rest are open. */}
        <span
          aria-hidden="true"
          className={
            live
              ? "size-2 shrink-0 rounded-full bg-[var(--zerops-status-ok)]"
              : "size-2 shrink-0 rounded-full border border-[var(--zerops-rail)] bg-[var(--app-theme-surface)]"
          }
        />
        <span aria-hidden="true" className={last ? RAIL_BLANK : RAIL_LINE} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium">
            {entry.subject}
          </span>
          <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground tabular-nums">
            {entry.shortSha}
          </span>
        </span>
        {line === undefined ? null : (
          <span className="truncate text-xs leading-4 text-muted-foreground">{line}</span>
        )}
      </span>
    </li>
  );
}

function HistoryNote({ children }: { readonly children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

const RAIL_LINE = "w-px flex-1 bg-[var(--zerops-rail)]";
const RAIL_BLANK = "w-px flex-1";

export function ZeropsHistoryDialog({
  open,
  onOpenChange,
  request,
  commits,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly request: ZeropsHistoryRequest | null;
  readonly commits: ZeropsCommitsState;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-xl">
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>{request === null ? "History" : request.repo}</DialogTitle>
            <DialogDescription>
              What has landed here, newest first, and what is running it.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {request === null ? null : <ZeropsHistoryView commits={commits} request={request} />}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
