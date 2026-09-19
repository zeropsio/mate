/**
 * How a deploy got here: the Actions run behind the commit a stop is running,
 * its jobs, and the log of whichever one somebody opens.
 *
 * A failed deploy used to be a red dot and nothing else — the reads for this
 * had existed since the forge landed and were wired to nothing. A job that
 * failed offers *Run again*, which is the only verb Gitea has here.
 *
 * Presentational: the reading is `useZeropsDeployRun`'s.
 */
import { jobDuration, type GiteaActionJob } from "@t3tools/client-runtime/zerops";
import { useCallback, useState } from "react";

import type { ZeropsDeployRun } from "~/zerops/useZeropsDeployRun";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { StatusDot } from "./primitives";

/** Gitea's own words for how a job ended, as a tone and a word. */
function jobTone(job: {
  readonly status?: string | undefined;
  readonly conclusion?: string | undefined;
}): { readonly tone: "ok" | "busy" | "failed" | "off"; readonly word: string } {
  const conclusion = job.conclusion ?? "";
  if (conclusion === "success") return { tone: "ok", word: "Passed" };
  if (conclusion === "failure") return { tone: "failed", word: "Failed" };
  if (conclusion === "cancelled") return { tone: "off", word: "Cancelled" };
  if (conclusion === "skipped") return { tone: "off", word: "Skipped" };
  if (job.status === "waiting" || job.status === "queued") return { tone: "busy", word: "Queued" };
  return { tone: "busy", word: "Running" };
}

export function ZeropsDeployRunView({ run }: { readonly run: ZeropsDeployRun }) {
  const { state } = run;
  if (state.kind === "no-gitea") {
    return <Note>Sign in to Gitea to read the build behind this deploy.</Note>;
  }
  if (state.kind === "reading") return <Note>Reading the build&hellip;</Note>;
  if (state.kind === "failed") return <Note>{state.reason}</Note>;
  if (state.kind === "none") {
    return <Note>No build was found for this commit in the recent runs.</Note>;
  }
  if (state.jobs.length === 0) {
    return <Note>The build ran with no jobs Gitea will report.</Note>;
  }
  return (
    <ul className="flex flex-col" data-zerops-surface="zerops-deploy-run">
      {state.jobs.map((job) => (
        <JobRow job={job} key={job.id} run={run} />
      ))}
    </ul>
  );
}

function JobRow({ job, run }: { readonly job: GiteaActionJob; readonly run: ZeropsDeployRun }) {
  const [log, setLog] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const { tone, word } = jobTone(job);
  const failed = job.conclusion === "failure";

  const toggle = useCallback(() => {
    if (log !== null) {
      setLog(null);
      return;
    }
    setReading(true);
    void run
      .readLog(job.id)
      .then((text) => {
        setLog(text.length === 0 ? "Gitea kept no log for this job." : text);
      })
      .finally(() => {
        setReading(false);
      });
  }, [job.id, log, run]);

  const duration = jobDuration(job.started_at, job.completed_at);
  return (
    <li
      className="border-b border-border/60 last:border-b-0"
      data-zerops-surface="zerops-deploy-job"
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_4rem_7rem_auto] items-center gap-3 py-2">
        <button
          aria-expanded={log !== null}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left text-sm text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          onClick={toggle}
          type="button"
        >
          {/* The log is the whole reason to be on this row; hover was the only
              thing that said so, and a phone never hovers. */}
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
              log !== null && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate">{job.name ?? `Job ${String(job.id)}`}</span>
        </button>
        {/* How long it took: the one number every other forge puts here. */}
        <span className="truncate text-end font-mono text-xs text-muted-foreground tabular-nums">
          {duration ?? ""}
        </span>
        <StatusDot
          className="min-w-0 text-xs text-muted-foreground"
          label={reading ? "Reading" : word}
          sentence
          tone={reading ? "busy" : tone}
        />
        {!failed ? null : (
          <Button
            disabled={rerunning}
            onClick={() => {
              setRerunning(true);
              void run.rerun(job.id).finally(() => {
                setRerunning(false);
              });
            }}
            size="sm"
            variant="ghost"
          >
            {rerunning ? "Starting…" : "Run again"}
          </Button>
        )}
      </div>
      {log === null ? null : (
        <pre
          className="mb-2 max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-muted-foreground"
          data-zerops-surface="zerops-deploy-job-log"
        >
          {log}
        </pre>
      )}
    </li>
  );
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
