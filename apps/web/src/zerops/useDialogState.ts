import { useCallback, useRef, useState } from "react";

/** Person-owned openings; an operation's reply belongs only to the opening that started it. */
export function useDialogState<T>() {
  const [dialog, update] = useState<T | null>(null);
  const opening = useRef({});
  const setDialog = useCallback((next: T | null) => {
    opening.current = {};
    update(next);
  }, []);
  const captureReply = useCallback(() => {
    const started = opening.current;
    return (next: T | null) => {
      if (opening.current !== started) return;
      if (next === null) opening.current = {};
      update(next);
    };
  }, []);
  return [dialog, setDialog, captureReply] as const;
}
