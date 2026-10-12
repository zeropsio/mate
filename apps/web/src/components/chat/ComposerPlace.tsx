/**
 * What stops the person writing in a conversation takes the composer's own place: one quiet line
 * that says it once and offers its one way out — an archived conversation, a crewmate's earlier
 * one, a repository still cloning (the owner's pick, S6 on the "Composer Strips" board,
 * 2026-10-12). A colleague's Mate has its own (`ZeropsReadOnlyConversationFooter`).
 */
import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type ProjectCloneSnapshot,
  type ThreadId,
} from "@t3tools/contracts";
import { ArchiveRestoreIcon, DownloadIcon, HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export interface ComposerPlaceNotice {
  readonly id: string;
  readonly icon: ReactNode;
  /** What stops the writing, on one line; its key words in `<strong>`. */
  readonly words: ReactNode;
  readonly action?: {
    readonly label: string;
    readonly onAction: () => void;
    /** It is under way: the button says so and waits. */
    readonly busy?: boolean;
  };
  /** It says that something failed. */
  readonly failed?: boolean;
}

/** What may stop the writing, as the records say it; the first that holds takes the place. */
export interface ComposerPlaceRecord {
  /** The conversation is archived; `restoring` while Restore runs. */
  readonly archived: { readonly restoring: boolean } | null;
  /** A crewmate's earlier conversation: it goes on in `currentThreadId` (`crewChatNotices`). */
  readonly crewRetired: {
    readonly text: string;
    readonly currentThreadId: ThreadId | null;
  } | null;
  /** The project's repository clone, while it is not done. */
  readonly clone: ProjectCloneSnapshot | null;
}

export interface ComposerPlaceActions {
  readonly restore: () => void;
  readonly openCurrent: () => void;
  readonly cancelClone: () => void;
  readonly retryClone: () => void;
}

export function composerPlaceNotice(
  record: ComposerPlaceRecord,
  actions: ComposerPlaceActions,
): ComposerPlaceNotice | null {
  if (record.archived !== null) {
    return {
      id: "archived",
      icon: <ArchiveRestoreIcon />,
      words: (
        <>
          <strong>This conversation is archived.</strong> Restore it to carry on here.
        </>
      ),
      action: record.archived.restoring
        ? { label: "Restoring...", onAction: () => {}, busy: true }
        : { label: "Restore", onAction: actions.restore },
    };
  }
  if (record.crewRetired !== null) {
    return {
      id: "crew-earlier",
      icon: <HistoryIcon />,
      words: record.crewRetired.text,
      ...(record.crewRetired.currentThreadId === null
        ? {}
        : { action: { label: "Open it", onAction: actions.openCurrent } }),
    };
  }
  const clone = record.clone;
  if (clone === null || clone.phase === "done") return null;
  const name = projectCloneDisplayName(clone);
  if (clone.phase === "running") {
    return {
      id: "clone",
      icon: <DownloadIcon />,
      words: (
        <>
          <strong>Cloning {name}</strong> · {projectCloneProgressSummary(clone)}
        </>
      ),
      action: { label: "Cancel", onAction: actions.cancelClone },
    };
  }
  const cancelled = clone.phase === "cancelled";
  const why = cancelled ? "Retry to bring in the repository." : clone.error;
  return {
    id: "clone",
    icon: <DownloadIcon />,
    words: (
      <>
        <strong>{cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`}</strong>
        {why ? ` · ${why}` : null}
      </>
    ),
    action: { label: "Retry", onAction: actions.retryClone },
    ...(cancelled ? {} : { failed: true }),
  };
}

/** The line in the composer's place: drawn as the composer's main surface, inside its glass. */
export function ComposerPlaceLine({ notice }: { readonly notice: ComposerPlaceNotice }) {
  const { action } = notice;
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl" data-composer-place={notice.id}>
      <div
        className="relative z-10 flex min-h-12 min-w-0 items-center gap-2.5 px-4 py-2 text-line text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground"
        data-chat-composer-main-surface="true"
        role={notice.failed ? "alert" : "status"}
      >
        <span
          aria-hidden="true"
          className={cn("flex shrink-0 [&_svg]:size-4", notice.failed && "text-status-failed-text")}
        >
          {notice.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{notice.words}</span>
        {action === undefined ? null : (
          <button
            className="shrink-0 cursor-pointer rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:no-underline"
            disabled={action.busy === true}
            onClick={action.onAction}
            type="button"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
