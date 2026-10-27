/**
 * Nothing is read while the tab is hidden (527bbf7f7's rule): a read that falls due then waits for
 * the tab's return, and goes once.
 */
const tabHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/** Runs `run` now while the tab is shown, else once it is shown again; the result stops waiting. */
export function whenShown(run: () => void): () => void {
  if (!tabHidden()) {
    run();
    return () => undefined;
  }
  const shown = () => {
    if (tabHidden()) return;
    document.removeEventListener("visibilitychange", shown);
    run();
  };
  document.addEventListener("visibilitychange", shown);
  return () => document.removeEventListener("visibilitychange", shown);
}
