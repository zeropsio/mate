/**
 * The live background jobs as a watcher sees them (`lingerLiveJobs`): a job
 * the server stops naming lingers a moment, on its own timer.
 */
import { useEffect, useLayoutEffect, useState } from "react";

import { lingerDue, lingerLiveJobs, type LingeringLiveJobs, type LiveJobs } from "./liveJobs.logic";

export function useLiveJobs(live: LiveJobs | null): LiveJobs | null {
  const [jobs, setJobs] = useState<LingeringLiveJobs>(() => lingerLiveJobs(null, live, Date.now()));
  // Before paint: a change never shows a frame of the old judgement.
  useLayoutEffect(() => {
    setJobs((current) => lingerLiveJobs(current, live, Date.now()));
  }, [live]);
  const due = lingerDue(jobs);
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(
      () =>
        setJobs((current) =>
          lingerLiveJobs(
            current,
            current.live === null ? null : { ids: current.named },
            Math.max(Date.now(), due),
          ),
        ),
      Math.max(0, due - Date.now()) + 5,
    );
    return () => clearTimeout(timer);
  }, [due]);
  return jobs.live;
}
