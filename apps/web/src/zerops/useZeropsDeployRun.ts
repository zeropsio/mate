/**
 * The build behind one deploy: Gitea's Actions run for the commit a stop is
 * running, its jobs, and the log of whichever job somebody opens.
 *
 * Read on demand like the history, not on the sixty-second clock — a build
 * nobody is looking at is a request per group per minute for a pane that is
 * usually shut. With no Gitea token to read with it says so, and reads once
 * one is back.
 *
 * The client has had `listActionRuns`, `listActionJobs`, `actionJobLogs` and
 * `rerunActionJob` since the forge landed and used none of them anywhere, so a
 * failed deploy was a red dot and nothing else. Gitea cannot be asked for the
 * run of a given commit, only for a branch's runs, so the run is found by
 * matching `head_sha` in the newest page — a deploy older than that page has
 * no run here, which is the honest answer rather than a wrong one.
 */
import type { GiteaActionJob } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useState } from "react";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

/** How far back the run listing looks for the commit's build. */
export const DEPLOY_RUN_SEARCH = 50;

export type ZeropsDeployRunState =
  | { readonly kind: "no-gitea" }
  | { readonly kind: "reading" }
  | { readonly kind: "none" }
  | {
      readonly kind: "read";
      readonly runId: number;
      readonly runNumber: number | undefined;
      readonly jobs: ReadonlyArray<GiteaActionJob>;
    }
  | { readonly kind: "failed"; readonly reason: string };

export interface ZeropsDeployRunRequest {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repo: string | undefined;
  /** The whole sha the stop runs; a short one never matches a run's head. */
  readonly sha: string | undefined;
}

export interface ZeropsDeployRun {
  readonly state: ZeropsDeployRunState;
  /** Reads one job's log, or its reason for refusing. */
  readonly readLog: (jobId: number) => Promise<string>;
  /** Runs a job again; the caller re-reads. */
  readonly rerun: (jobId: number) => Promise<void>;
  readonly refresh: () => void;
}

export function useZeropsDeployRun(request: ZeropsDeployRunRequest | null): ZeropsDeployRun {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repo = request?.repo;
  const sha = request?.sha;
  const readable = useGiteaReadable(giteaOrigin);
  const [state, setState] = useState<ZeropsDeployRunState>({ kind: "reading" });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (
      giteaOrigin === undefined ||
      owner === undefined ||
      repo === undefined ||
      sha === undefined
    ) {
      setState({ kind: "no-gitea" });
      return;
    }
    const client = readable ? giteaClientFor(giteaOrigin) : null;
    if (client === null) {
      setState({ kind: "no-gitea" });
      return;
    }
    let live = true;
    setState({ kind: "reading" });
    void client
      .listActionRuns(owner, repo, { limit: DEPLOY_RUN_SEARCH })
      .then(async (runs) => {
        const run = runs.find((entry) => entry.head_sha === sha);
        if (run === undefined) {
          if (live) setState({ kind: "none" });
          return;
        }
        const jobs = await client.listActionJobs(owner, repo, run.id);
        if (live) {
          setState({ kind: "read", runId: run.id, runNumber: run.run_number, jobs });
        }
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "failed", reason: zeropsErrorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [giteaOrigin, owner, readable, repo, sha, generation]);

  const readLog = useCallback(
    async (jobId: number) => {
      if (giteaOrigin === undefined || owner === undefined || repo === undefined) return "";
      const client = giteaClientFor(giteaOrigin);
      if (client === null) return "";
      return client.actionJobLogs(owner, repo, jobId).catch((error: unknown) => {
        // The log is the whole of what this surface shows, so its refusal is
        // what it shows instead — never an empty pane.
        return zeropsErrorMessage(error);
      });
    },
    [giteaOrigin, owner, repo],
  );

  const rerun = useCallback(
    async (jobId: number) => {
      if (giteaOrigin === undefined || owner === undefined || repo === undefined) return;
      const client = giteaClientFor(giteaOrigin);
      if (client === null) return;
      await client.rerunActionJob(owner, repo, jobId);
      setGeneration((value) => value + 1);
    },
    [giteaOrigin, owner, repo],
  );

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  return { state, readLog, rerun, refresh };
}
