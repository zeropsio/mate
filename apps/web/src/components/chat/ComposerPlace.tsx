/**
 * What stops the person writing in a conversation takes the composer's own place: one quiet line
 * that says it once and offers its one way out — an archived conversation, a crewmate's earlier
 * one (the owner's pick, S6 on the "Composer Strips" board, 2026-10-12). A colleague's Mate has its
 * own (`ZeropsReadOnlyConversationFooter`). A repository cloning stops nothing but Send: it stands
 * at the composer's top (`ComposerCloneAsk`).
 */
import type { ThreadId } from "@t3tools/contracts";
import { ArchiveRestoreIcon, HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";
import { InlineButton } from "~/components/ui/button";

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
}

export interface ComposerPlaceActions {
  readonly restore: () => void;
  readonly openCurrent: () => void;
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
  return null;
}

/** The line in the composer's place: drawn as the composer's main surface, inside its glass. */
export function ComposerPlaceLine({ notice }: { readonly notice: ComposerPlaceNotice }) {
  const { action } = notice;
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl" data-composer-place={notice.id}>
      <div
        className="relative z-10 flex min-h-12 min-w-0 items-center gap-2.5 px-4 py-2 text-line text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground"
        data-chat-composer-main-surface="true"
        role="status"
      >
        <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-4">
          {notice.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{notice.words}</span>
        {action === undefined ? null : (
          <InlineButton
            className="shrink-0"
            disabled={action.busy === true}
            onClick={action.onAction}
          >
            {action.label}
          </InlineButton>
        )}
      </div>
    </div>
  );
}
