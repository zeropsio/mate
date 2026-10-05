/**
 * Where a deploy's build stands, read by the appVersion its result named — the handle a
 * `BUILD_TRIGGERED` result leaves once zcp stopped following the build. The deploy card's phase
 * is this answer, never a clock: running while the build runs, its end once it ended, uncertain
 * only where the platform cannot be asked.
 */
import type { ZeropsLifecycle } from "@t3tools/contracts";

import type { ProcessHistoryRead } from "../data/types.ts";
import type { Known } from "../knowledge/index.ts";
import { attributeActivity } from "./attribution.ts";
import type { ActivityProcess } from "./dto.ts";
import { outcomeFor } from "./observe.ts";

/**
 * `unread` until a read of the project could show the build; `unobservable` where none can —
 * the project is not readable, or what Zerops lists of it no longer holds the build.
 */
export type DeployBuildRead = "unread" | "running" | "finished" | "failed" | "unobservable";

/** What the account store holds of a project's processes. */
export interface ProjectBuildsRead {
  /** What runs and what ran; undefined until a read landed. */
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  /** Where the read of the project's newest process history stands. */
  readonly processHistory: ProcessHistoryRead;
}

export function readDeployBuild(
  read: ProjectBuildsRead | "unobservable",
  projectId: string,
  appVersionId: string,
): DeployBuildRead {
  if (read === "unobservable") return "unobservable";
  if (read.processes === undefined) return "unread";
  const attribution = attributeActivity({
    processes: read.processes,
    projectId,
    serviceIds: [],
    startedAtMs: 0,
    kind: "deploy",
    exact: { appVersionId },
  });
  if (attribution.projectMismatch) return "unobservable";
  const build = attribution.stepSource;
  if (build === undefined) {
    return read.processHistory === "read" || read.processHistory === "failed"
      ? "unobservable"
      : "unread";
  }
  const outcome = outcomeFor(build);
  if (outcome === undefined) return "running";
  return outcome === "finished" ? "finished" : "failed";
}

/** The project a thread works in: named, still being read, or none to read builds by. */
export type ThreadProject = { readonly projectId: string } | "reading" | "none";

/** The thread's project, as its lifecycle's envelope names it. */
export function threadProjectOf(lifecycle: Known<ZeropsLifecycle> | undefined): ThreadProject {
  switch (lifecycle?.state) {
    case "unread":
    case "reading":
      return "reading";
    case "known": {
      const projectId = lifecycle.value.envelope?.project.id;
      return projectId === undefined ? "none" : { projectId };
    }
    default:
      return "none";
  }
}
