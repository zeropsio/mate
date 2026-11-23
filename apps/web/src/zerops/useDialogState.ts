import { useState } from "react";

/** Owns openings and the replies and actions that belong to each one. */
export function createDialogReplies<T>(update: (next: T | null) => void) {
  let opening = {};
  const setDialog = (next: T | null) => {
    opening = {};
    update(next);
  };
  const captureReply = () => {
    const started = opening;
    const isCurrent = () => opening === started;
    const reply = (next: T | null) => {
      if (!isCurrent()) return;
      if (next === null) opening = {};
      update(next);
    };
    const ifCurrent = (action: () => void) => {
      if (isCurrent()) action();
    };
    return Object.assign(reply, { ifCurrent });
  };
  return { setDialog, captureReply };
}

/** Person-owned openings; an operation's reply belongs only to the opening that started it. */
export function useDialogState<T>() {
  const [dialog, update] = useState<T | null>(null);
  const [replies] = useState(() => createDialogReplies(update));
  return [dialog, replies.setDialog, replies.captureReply] as const;
}
