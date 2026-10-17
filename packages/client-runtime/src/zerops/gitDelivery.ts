/** Git standing has one owner: accepted destinations, frozen entries and confirmed hand-overs. */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqPushCiFailure, HqPushReceipt } from "@t3tools/shared/hqDeploys";
import type { HqEnvironmentIdentity } from "@t3tools/shared/hqEnvironment";
import type { HqGitReleasePreflight, Release, ReleaseRollout } from "@t3tools/shared/hqRelease";
import type { HqPushNavigationJob } from "@t3tools/shared/hqStream";
import type { HqJob } from "./hq/environments.ts";

export interface GitDeliveryEnvironment extends HqEnvironmentIdentity {
  readonly tier: "stage" | "production";
  readonly jobs: ReadonlyArray<HqJob | HqPushNavigationJob>;
  readonly release?: ReleaseRollout | null;
}

export interface GitDeliveryFacts {
  readonly releases?: ReadonlyArray<Release> | undefined;
  readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
  readonly preflight?: Readonly<Record<string, HqGitReleasePreflight>> | undefined;
  readonly live?: boolean;
}

export type GitStanding =
  | "checking"
  | "not-released"
  | "pushing"
  | "pushed"
  | "partly"
  | "unresolved"
  | "refused"
  | "last-known";

export interface GitRepositoryDelivery {
  readonly repo: string;
  readonly sha: string;
  readonly state: HqPushNavigationJob["state"] | "unknown" | "left-out";
  readonly reason: string | null;
  readonly job: HqPushNavigationJob | undefined;
  readonly confirmed: HqPushReceipt | undefined;
}

export interface GitDelivery {
  readonly kind: "git";
  readonly standing: GitStanding;
  readonly line: string;
  readonly version: string | undefined;
  readonly activeVersion: string | undefined;
  readonly queuedVersion: string | undefined;
  readonly previousVersion: string | undefined;
  readonly repositories: ReadonlyArray<GitRepositoryDelivery>;
  readonly pushed: number;
  readonly total: number;
  /** Waiting changes compare these confirmed tips, never an accepted or queued sha. */
  readonly lastPushed: ReadonlyMap<string, string>;
  readonly nextActor: "hq" | "person" | "none";
  readonly nextAction: string;
  readonly blocked: boolean;
  /**
   * Only HQ's last preflight or a push it refused as diverged blocks the release, and the review runs
   * the preflight again on opening: a branch settled since then is released from there, so its door
   * stays open while the release is blocked.
   */
  readonly recheck: boolean;
  readonly release: {
    readonly allowed: boolean;
    readonly reason: string | undefined;
    readonly actions: ReadonlyArray<"release" | "cancel" | "replace-token">;
  };
}

/** What the origin's CI reported for a repository's confirmed push: `words`, then `failed` checks, then `notes`. */
export interface GitCiLine {
  readonly words: string;
  readonly failed: ReadonlyArray<HqPushCiFailure>;
  readonly notes: ReadonlyArray<string>;
}

/** HQ's CI record on the confirmed hand-over is the only source; no record, no line. */
export function gitCiLine(repo: GitRepositoryDelivery): GitCiLine | undefined {
  const ci = repo.confirmed === undefined ? undefined : repo.job?.evidence?.ci;
  if (ci === undefined) return undefined;
  const count = ci.done < ci.total ? [`${ci.done} of ${ci.total} done`] : [];
  const stopped = ci.watch === "stopped" && ci.reason !== null ? [ci.reason] : [];
  switch (ci.verdict) {
    case "unreadable":
      return {
        words: `CI unreadable: ${ci.reason ?? "HQ couldn't read it"}`,
        failed: [],
        notes: [],
      };
    case "none":
      return {
        words: ci.watch === "watching" ? "CI not reported yet" : "No CI reported",
        failed: [],
        notes: stopped,
      };
    case "running":
      return { words: "CI running", failed: [], notes: [...count, ...stopped] };
    case "failed":
      return { words: "CI failed", failed: ci.failed, notes: [...count, ...stopped] };
    case "passed":
      return { words: "CI passed", failed: [], notes: [] };
  }
}

/** No remote/service/version reads and no receiver inference: a push never proves `live`. */
export function gitDeliveryOf(
  environment: GitDeliveryEnvironment,
  facts: GitDeliveryFacts = {},
): GitDelivery | undefined {
  if (environment.target.kind !== "git") return undefined;
  const { target } = environment;
  const jobs = environment.jobs.filter((job): job is HqPushNavigationJob => job.kind === "push");
  const belongs = (release: Release) =>
    release.state === "approved" &&
    release.target === "git" &&
    release.releaseTarget?.environmentId === environment.id &&
    release.releaseTarget.target.kind === "git" &&
    release.releaseTarget.target.branch === target.branch &&
    release.releaseTarget.target.delivery === target.delivery;
  const releases = facts.releases?.filter(belongs);
  const accepted = releases?.find((release) => release.tag === environment.release?.tag);
  const matches = (job: HqPushNavigationJob, repo: string, sha: string, tag?: string) =>
    job.service === repo && job.sha === sha && (tag === undefined || job.ref === tag);
  const confirmed = (job: HqPushNavigationJob | undefined) => {
    const receipt = job?.evidence?.confirmed;
    return job?.state === "pushed" &&
      receipt?.after === job.sha &&
      receipt.ref === `refs/heads/${target.branch}`
      ? receipt
      : undefined;
  };
  const lastPushed = new Map<string, string>();
  for (const job of jobs) {
    const receipt = confirmed(job);
    if (receipt !== undefined && !lastPushed.has(job.service))
      lastPushed.set(job.service, receipt.after);
  }
  const wanted =
    environment.tier === "production"
      ? accepted?.entries
      : facts.repos
          ?.filter((repo) => repo.remote != null)
          .flatMap((repo) =>
            repo.mainHead === null ? [] : [{ service: repo.name, sha: repo.mainHead }],
          );
  const repositories: GitRepositoryDelivery[] = (wanted ?? []).map(({ service: repo, sha }) => {
    const omitted = environment.release?.leftOut.find(
      (entry) => entry.service === repo && entry.sha === sha && entry.job === null,
    );
    const job = jobs.find(
      (job) => matches(job, repo, sha, accepted?.tag) && job.state !== "superseded",
    );
    return {
      repo,
      sha,
      state: omitted !== undefined ? "left-out" : (job?.state ?? "unknown"),
      reason: omitted?.reason ?? job?.reason ?? null,
      job,
      confirmed: omitted === undefined ? confirmed(job) : undefined,
    };
  });
  // Omitted repositories belong to the frozen rollout too, even when not in its included entries.
  if (accepted !== undefined) {
    for (const entry of environment.release?.leftOut ?? []) {
      if (repositories.some((repo) => repo.repo === entry.service)) continue;
      repositories.push({
        repo: entry.service,
        sha: entry.sha,
        state: "left-out",
        reason: entry.reason,
        job: undefined,
        confirmed: undefined,
      });
    }
  }
  const pushed = repositories.filter((repo) => repo.confirmed !== undefined).length;
  const total = repositories.length;
  // An ended timestamp does not settle an unowned writer or an unresolved hand-over (L3d/e).
  const blocker =
    jobs.find((job) => job.state === "unresolved") ??
    jobs.find((job) => job.state === "submitting") ??
    jobs.find((job) => job.state === "queued");
  const active = jobs.find((job) => job.state === "submitting" || job.state === "unresolved");
  const queued = jobs.find((job) => job.state === "queued");
  const failed = repositories.find((repo) => repo.state === "refused");
  const unresolved = repositories.find((repo) => repo.state === "unresolved");
  const unknown = wanted === undefined || repositories.some((repo) => repo.state === "unknown");
  const currentRollout = environment.release;
  const rolloutMatches =
    currentRollout?.target === "git" &&
    currentRollout.releaseTarget?.environmentId === environment.id &&
    currentRollout.releaseTarget.target.kind === "git" &&
    currentRollout.releaseTarget.target.branch === target.branch;
  let standing: GitStanding =
    target.delivery !== "direct" ||
    (environment.tier === "production" && currentRollout != null && !rolloutMatches)
      ? "checking"
      : unresolved !== undefined || blocker?.state === "unresolved"
        ? "unresolved"
        : blocker !== undefined
          ? "pushing"
          : unknown
            ? "checking"
            : pushed > 0 && pushed < total
              ? "partly"
              : failed !== undefined
                ? "refused"
                : pushed > 0 && pushed === total
                  ? "pushed"
                  : "not-released";
  if (environment.tier === "production" && currentRollout == null && releases !== undefined)
    standing =
      blocker?.state === "unresolved" ? "unresolved" : blocker ? "pushing" : "not-released";
  const previous = releases?.find(
    (release) =>
      release.tag !== accepted?.tag &&
      release.entries.length > 0 &&
      release.entries.every((entry) =>
        jobs.some(
          (job) =>
            matches(job, entry.service, entry.sha, release.tag) && confirmed(job) !== undefined,
        ),
      ),
  );
  const version = accepted?.tag;
  const label = version ?? (environment.tier === "stage" ? target.branch : "release");
  const result = repositories
    .filter((repo) => repo.confirmed === undefined)
    .map((repo) => `${repo.repo}: ${repo.reason ?? repo.state}`)
    .join("; ");
  const line =
    standing === "checking"
      ? "Checking what HQ pushed…"
      : standing === "not-released"
        ? environment.tier === "production"
          ? "Not released yet"
          : "Nothing pushed yet · pushes on the next merge"
        : standing === "pushing"
          ? `Pushing ${active?.ref ?? queued?.ref ?? label}…`
          : standing === "pushed"
            ? `Pushed ${label}`
            : standing === "partly"
              ? `Pushed ${pushed} of ${total}: ${result}`
              : standing === "unresolved"
                ? `Mate couldn't confirm the push of ${active?.ref ?? label}. ${blocker?.evidence?.nextAction ?? "Check the remote branch."}`
                : `${label} wasn't pushed: ${result}`;
  const refusal = facts.repos?.find((repo) => repo.remote?.invalidSince != null);
  const preflights = Object.values(facts.preflight ?? {}).filter((entry) => {
    const repo = facts.repos?.find((repo) => repo.name === entry.repo);
    return (
      repo?.mainHead === entry.sha &&
      repo.remote?.url === entry.remote.url &&
      repo.remote.keptAt === entry.remote.keptAt &&
      entry.ref === `refs/heads/${target.branch}`
    );
  });
  const preflight = preflights.find((entry) => entry.verdict !== "ready");
  // HQ found the branch ready after its push refused it as diverged: the person settled it.
  const diverged =
    failed?.reason === "diverged" &&
    !preflights.some(
      (entry) =>
        entry.repo === failed.repo &&
        entry.verdict === "ready" &&
        Date.parse(entry.checkedAt) > Date.parse(failed.job?.endedAt ?? failed.job?.at ?? ""),
    );
  const failedRemote = facts.repos?.find((repo) => repo.name === failed?.repo)?.remote;
  const attempted = failed?.job?.evidence?.attempt;
  const replaced =
    attempted !== undefined &&
    failedRemote != null &&
    failedRemote.keptAt !== attempted.credentialKeptAt &&
    failedRemote.url === attempted.remote.url &&
    failedRemote.repositoryId === attempted.remote.repositoryId &&
    failedRemote.invalidSince === null;
  const credential =
    refusal !== undefined ||
    preflight?.verdict === "credential" ||
    (failed?.reason === "credential" && !replaced);
  const reason =
    target.delivery !== "direct"
      ? "Pull-request delivery is not available here yet."
      : facts.live === false
        ? "HQ's standing is last known."
        : blocker !== undefined
          ? line
          : credential
            ? "The remote refused Mate's token, so this release can't go out. Replace the token in this production's settings, then release again."
            : preflight !== undefined
              ? (preflight.reason ??
                `The remote preflight is ${preflight.verdict}; this release can't go out.`)
              : diverged
                ? "The remote branch has commits Mate doesn't, so this release can't go out."
                : undefined;
  const actor =
    blocker?.evidence?.nextActor ?? (replaced ? undefined : failed?.job?.evidence?.nextActor);
  return {
    kind: "git",
    standing: facts.live === false ? "last-known" : standing,
    line: facts.live === false ? `Last known · ${line}` : line,
    version,
    activeVersion: active?.ref ?? undefined,
    queuedVersion: queued?.ref ?? undefined,
    previousVersion: previous?.tag,
    repositories,
    pushed,
    total,
    lastPushed,
    nextActor: actor ?? (reason !== undefined ? "person" : "none"),
    nextAction:
      blocker?.evidence?.nextAction ??
      (replaced ? undefined : failed?.job?.evidence?.nextAction) ??
      (credential ? "Replace token" : ""),
    blocked: reason !== undefined,
    recheck:
      target.delivery === "direct" &&
      facts.live !== false &&
      blocker === undefined &&
      !credential &&
      (preflight !== undefined || diverged),
    release: {
      allowed: reason === undefined,
      reason,
      actions:
        reason === undefined
          ? ["release", "cancel"]
          : credential
            ? ["replace-token", "cancel"]
            : ["cancel"],
    },
  };
}
