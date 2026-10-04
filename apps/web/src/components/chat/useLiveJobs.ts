/**
 * The live background jobs as a watcher sees them (`lingerLiveJobs`): a job
 * the server stops naming lingers a moment, on its own timer.
 */
import { useEffect, useState } from "react";

import { lingerDue, lingerLiveJobs, type LingeringLiveJobs, type LiveJobs } from "./liveJobs.logic";

export function useLiveJobs(live: LiveJobs | null): LiveJobs | null {
  const [shown, setShown] = useState<{
    readonly from: LiveJobs | null;
    readonly jobs: LingeringLiveJobs;
  }>(() => ({ from: live, jobs: lingerLiveJobs(null, live, Date.now()) }));
  if (shown.from !== live) {
    setShown({ from: live, jobs: lingerLiveJobs(shown.jobs, live, Date.now()) });
  }
  const due = lingerDue(shown.jobs);
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(
      () =>
        setShown((current) => ({
          from: current.from,
          jobs: lingerLiveJobs(current.jobs, current.from, Math.max(Date.now(), due)),
        })),
      Math.max(0, due - Date.now()) + 5,
    );
    return () => clearTimeout(timer);
  }, [due]);
  return shown.jobs.live;
}
