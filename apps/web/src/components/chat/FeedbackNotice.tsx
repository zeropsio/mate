import {
  codexFeedbackNotice,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import { MessageSquareIcon } from "lucide-react";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { toastManager } from "../ui/toast";
import type { ConversationNotice } from "./ConversationRows";

/** `/feedback` in a Codex conversation, as its row at the conversation's end: sending, sent, failed. */
export function feedbackNotice(
  submission: CodexFeedbackSubmission,
  onDismiss: () => void,
): ConversationNotice | null {
  const notice = codexFeedbackNotice(submission);
  if (!notice) return null;
  return {
    id: `feedback:${submission.id}`,
    icon: <MessageSquareIcon />,
    words: (
      <>
        <strong>{notice.title}</strong>
        {notice.description ? ` · ${notice.description}` : null}
      </>
    ),
    ...(submission.status === "failed"
      ? {
          failed: true,
          announce: [notice.title, notice.description].filter(Boolean).join(": "),
        }
      : {}),
    ...(submission.status === "sent"
      ? {
          action: {
            label: "Copy ID",
            onAction: () => {
              void writeTextToClipboard(submission.feedbackId, "Codex feedback thread ID").catch(
                (error: unknown) => {
                  toastManager.add({
                    type: "error",
                    title: "Could not copy thread ID",
                    description: error instanceof Error ? error.message : "An error occurred.",
                  });
                },
              );
            },
          },
        }
      : {}),
    ...(submission.status !== "uploading"
      ? { dismissLabel: "Dismiss feedback notice", onDismiss }
      : {}),
  };
}
