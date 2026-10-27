import type {
  FlowReleaseRow,
  GitDelivery,
  GitDeliveryEnvironment,
} from "@t3tools/client-runtime/zerops";
import type { HqPushNavigationJob } from "@t3tools/shared/hqStream";

const PUSH_WORDS = {
  queued: "Queued",
  submitting: "Pushing",
  pushed: "Pushed",
  refused: "Refused",
  unresolved: "Outcome unresolved",
  superseded: "Superseded",
} satisfies Record<HqPushNavigationJob["state"], string>;

export function gitPushHistory(jobs: GitDeliveryEnvironment["jobs"]) {
  return jobs
    .filter((job): job is HqPushNavigationJob => job.kind === "push")
    .map((job) => ({
      id: job.id,
      name: job.service,
      cause: job.cause.replaceAll("_", " "),
      summary: [job.sha.slice(0, 7), job.reason].filter(Boolean).join(" · "),
      word: PUSH_WORDS[job.state],
      attention: job.state === "refused" || job.state === "unresolved",
    }));
}

/** Navigation is newest first; a retry replaces only its repository's earlier attempt. */
export function gitReleaseHistory(
  release: Pick<FlowReleaseRow, "tag" | "verdict">,
  delivery: GitDelivery | undefined,
  jobs: GitDeliveryEnvironment["jobs"],
) {
  if (release.tag === delivery?.version)
    return { word: delivery.line, reason: undefined, attention: delivery.blocked };
  if (release.tag === delivery?.previousVersion)
    return { word: `Previously pushed ${release.tag}`, reason: undefined, attention: false };
  const latest = new Map<string, HqPushNavigationJob>();
  for (const job of jobs) {
    if (
      job.kind === "push" &&
      job.cause === "release" &&
      job.ref === release.tag &&
      !latest.has(job.service)
    )
      latest.set(job.service, job);
  }
  const pushes = [...latest.values()];
  const words = [...new Set(pushes.map((job) => PUSH_WORDS[job.state]))];
  return {
    word:
      release.verdict === "refused"
        ? "Refused"
        : words.length === 0
          ? "Hand-over not reported"
          : words.length === 1
            ? words[0]!
            : pushes.map((job) => `${job.service}: ${PUSH_WORDS[job.state]}`).join(" · "),
    reason:
      pushes
        .flatMap((job) =>
          job.reason === null
            ? []
            : [pushes.length === 1 ? job.reason : `${job.service}: ${job.reason}`],
        )
        .join(" · ") || undefined,
    attention:
      release.verdict === "refused" ||
      pushes.some((job) => job.state === "refused" || job.state === "unresolved"),
  };
}
