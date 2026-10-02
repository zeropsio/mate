/**
 * The clock a reader without an event stream refreshes on: every `everyMs` while the page is
 * visible, nothing while it is hidden, and one refresh on coming back when a tick was missed. A
 * tab left open in the background asked Gitea everything every minute for as long as it stayed
 * open (pass 30, 2026-10-02).
 */
export interface PageVisibility {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function startRefreshClock(input: {
  readonly refresh: () => void;
  readonly everyMs: number;
  readonly page?: PageVisibility | undefined;
}): () => void {
  const page = input.page ?? (typeof document === "undefined" ? undefined : document);
  let missed = false;
  const timer = setInterval(() => {
    if (page?.hidden === true) {
      missed = true;
      return;
    }
    input.refresh();
  }, input.everyMs);
  const onVisibility = () => {
    if (page?.hidden === true || !missed) return;
    missed = false;
    input.refresh();
  };
  page?.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    page?.removeEventListener("visibilitychange", onVisibility);
  };
}
