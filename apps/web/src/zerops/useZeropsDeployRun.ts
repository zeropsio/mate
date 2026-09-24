/**
 * The build behind one deploy: Gitea's Actions run for the commit a stop is
 * running, its jobs, and the log of whichever job somebody opens.
 *
 * Read on demand like the history, not on the sixty-second clock — a build
 * nobody is looking at is a request per group per minute for a pane that is
 * usually shut. With no Gitea token to read with — none held, or a 401 that
 * no token recovered — it says so, and reads once one is back. A build already answered keeps its answer while the token is
 * gone and while it is read again (DESIGN §4.6: a 401 never blanks what was
 * read); a refresh reads it afresh.
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
import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * An answer, the read it answers and the generation of that read; `key` is `null` for a request
 * with nothing to read.
 */
interface HeldDeployRun {
  readonly key: string | null;
  readonly generation: number;
  readonly state: ZeropsDeployRunState;
}

/** The held answer, kept when it already answers `key`, otherwise `waiting`. */
function holdFor(key: string, generation: number, waiting: ZeropsDeployRunState) {
  return (held: HeldDeployRun): HeldDeployRun =>
    held.key === key &&
    (held.state.kind === "read" || held.state.kind === "none" || held.state.kind === "failed")
      ? held
      : { key, generation, state: waiting };
}

/**
 * Where the last rerun pressed stands: its POST out, or landed and waiting for the read of the
 * generation it asked for, or refused.
 */
type RerunWait =
  | { readonly kind: "idle" }
  | { readonly kind: "posting" }
  | { readonly kind: "reading"; readonly generation: number }
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
  /** Runs a job of the run read here again, then reads the run again; a refusal is `rerunFailure`. */
  readonly rerun: (jobId: number) => Promise<void>;
  readonly refresh: () => void;
  /** From the rerun's press until the read after it answers; a later refresh supersedes it. */
  readonly rerunning: boolean;
  /** Why Gitea refused the last rerun pressed, until another is pressed. */
  readonly rerunFailure: string | null;
}

export function useZeropsDeployRun(request: ZeropsDeployRunRequest | null): ZeropsDeployRun {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repo = request?.repo;
  const sha = request?.sha;
  const readable = useGiteaReadable(giteaOrigin);
  const [held, setHeld] = useState<HeldDeployRun>({
    key: null,
    generation: 0,
    state: { kind: "reading" },
  });
  const [generation, setGeneration] = useState(0);
  /** The generation last asked for, so a rerun knows which read answers it. */
  const asked = useRef(0);
  const readAgain = useCallback(() => {
    asked.current += 1;
    setGeneration(asked.current);
    return asked.current;
  }, []);
  const [rerunWait, setRerunWait] = useState<RerunWait>({ kind: "idle" });

  useEffect(() => {
    if (
      giteaOrigin === undefined ||
      owner === undefined ||
      repo === undefined ||
      sha === undefined
    ) {
      setHeld({ key: null, generation, state: { kind: "no-gitea" } });
      return;
    }
    const key = JSON.stringify([giteaOrigin, owner, repo, sha, generation]);
    let unauthorized = false;
    const client = readable
      ? giteaClientFor(giteaOrigin, () => {
          unauthorized = true;
        })
      : null;
    if (client === null) {
      setHeld(holdFor(key, generation, { kind: "no-gitea" }));
      return;
    }
    let live = true;
    setHeld(holdFor(key, generation, { kind: "reading" }));
    void client
      .listActionRuns(owner, repo, { limit: DEPLOY_RUN_SEARCH })
      .then(async (runs) => {
        const run = runs.find((entry) => entry.head_sha === sha);
        if (run === undefined) {
          if (live) setHeld({ key, generation, state: { kind: "none" } });
          return;
        }
        const jobs = await client.listActionJobs(owner, repo, run.id);
        if (live) {
          setHeld({
            key,
            generation,
            state: { kind: "read", runId: run.id, runNumber: run.run_number, jobs },
          });
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        setHeld(
          unauthorized
            ? holdFor(key, generation, { kind: "no-gitea" })
            : { key, generation, state: { kind: "failed", reason: zeropsErrorMessage(error) } },
        );
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

  const runId = held.state.kind === "read" ? held.state.runId : undefined;
  const rerun = useCallback(
    async (jobId: number) => {
      if (giteaOrigin === undefined || owner === undefined || repo === undefined) return;
      if (runId === undefined) return;
      const client = giteaClientFor(giteaOrigin);
      if (client === null) return;
      setRerunWait({ kind: "posting" });
      try {
        await client.rerunActionJob(owner, repo, runId, jobId);
      } catch (error) {
        setRerunWait({ kind: "failed", reason: zeropsErrorMessage(error) });
        return;
      }
      setRerunWait({ kind: "reading", generation: readAgain() });
    },
    [giteaOrigin, owner, readAgain, repo, runId],
  );

  const refresh = useCallback(() => {
    readAgain();
  }, [readAgain]);

  const rerunning =
    rerunWait.kind === "posting" ||
    (rerunWait.kind === "reading" &&
      rerunWait.generation === generation &&
      (held.generation !== generation || held.state.kind === "reading"));
  return {
    state: held.state,
    readLog,
    rerun,
    refresh,
    rerunning,
    rerunFailure: rerunWait.kind === "failed" ? rerunWait.reason : null,
  };
}
