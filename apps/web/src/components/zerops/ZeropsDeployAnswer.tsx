import { GitDeliveryStatus } from "./GitDeliveryStatus";
import type { GitDelivery } from "@t3tools/client-runtime/zerops";
import type { HqEnvironmentTarget } from "@t3tools/shared/hqEnvironment";
/** HQ's answer replaces a service's planned deploy line, inside the section that names it. */
import type { ReviewPress } from "@t3tools/client-runtime/zerops";
import { deployAnswerSaid } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { Fragment } from "react";
import {
  useDeployAnswerFollowing,
  useHandedOverAnswer,
} from "~/zerops/activity/useDeployAnswerFollowing";
import { ZeropsDeployLog } from "./ZeropsDeployLog";
import { GitBrowserLink, type GitLink } from "./gitBrowser/GitBrowserLink";

/** A service's planned deploy, in words, and the code it goes live with where that is known. */
export interface DeployWhereRow {
  readonly service: string;
  readonly line: string;
  readonly code?: GitLink | undefined;
}

export function ZeropsDeployAnswer(props: {
  readonly git?:
    | {
        readonly delivery: GitDelivery | undefined;
        readonly environment: {
          readonly target: Extract<HqEnvironmentTarget, { kind: "git" }>;
          readonly tier: "stage" | "production";
        };
      }
    | undefined;
  readonly answer?: HqDeployAnswer | undefined;
  readonly showEnvironment?: boolean | undefined;
  readonly rows?: ReadonlyArray<DeployWhereRow> | undefined;
}) {
  if (props.git !== undefined)
    return <GitDeliveryStatus environment={props.git.environment} delivery={props.git.delivery} />;
  return <PlatformDeployAnswer {...props} />;
}
function PlatformDeployAnswer({
  answer: asked,
  rows,
  showEnvironment,
}: {
  readonly answer?: HqDeployAnswer | undefined;
  readonly showEnvironment?: boolean | undefined;
  readonly rows?: ReadonlyArray<DeployWhereRow> | undefined;
}) {
  const { answer, logs } = useDeployAnswerFollowing(asked);
  const said = answer === undefined ? undefined : deployAnswerSaid(answer);
  const environments = said?.environments ?? [];
  const services = new Set(environments.flatMap(({ jobs }) => jobs.map(({ service }) => service)));
  const fallback = (rows ?? []).filter(({ service }) => !services.has(service));
  if (fallback.length === 0 && environments.length === 0 && said?.note === undefined) return null;
  return (
    <>
      <div className="rv-where">
        {environments.map(({ environment, jobs }) =>
          jobs
            .filter(({ service }) => service !== null)
            .map((job, index) => {
              const log = job.jobId === null ? undefined : logs.get(job.jobId);
              return (
                <Fragment key={`${environment} ${String(index)}`}>
                  <b>
                    {(showEnvironment ?? environments.length > 1) ? `${environment} · ` : ""}
                    {job.service}
                  </b>
                  <span data-zerops-job-state={job.state}>
                    <span>{job.standing}</span>
                    {job.sourceArchive === undefined ? null : (
                      <span className="block text-caption text-muted-foreground">
                        {job.sourceArchive}
                      </span>
                    )}
                  </span>
                  {log === undefined ? (
                    <span />
                  ) : (
                    <ZeropsDeployLog
                      key={log.target.jobId}
                      projectId={log.projectId}
                      service={job.service!}
                      target={log.target}
                    />
                  )}
                </Fragment>
              );
            }),
        )}
        {fallback.map(({ service, line, code }) => (
          <Fragment key={service}>
            <b>{service}</b>
            <span>{line}</span>
            {code === undefined ? (
              <span />
            ) : (
              <span>
                <GitBrowserLink to={code}>Browse files</GitBrowserLink>
              </span>
            )}
          </Fragment>
        ))}
      </div>
      {environments.map(({ environment, jobs }) =>
        jobs
          .filter(({ service }) => service === null)
          .map((job, index) => (
            <p
              className="rv-words"
              data-zerops-job-state={job.state}
              key={`${environment} ${String(index)}`}
            >
              {(showEnvironment ?? environments.length > 1) ? `${environment} · ` : ""}
              {job.text}
              {job.sourceArchive === undefined ? null : (
                <span className="block text-caption text-muted-foreground">
                  {job.sourceArchive}
                </span>
              )}
            </p>
          )),
      )}
      {said?.note === undefined ? null : <p className="rv-words">{said.note}</p>}
    </>
  );
}

/** The press's answer, only once HQ has answered it. */
export function answeredDeploys(press: ReviewPress): HqDeployAnswer | undefined {
  if (press.kind !== "done" || press.deploys === undefined) return undefined;
  const { jobs, note, planned } = press.deploys;
  return jobs.length > 0 || note?.trim() || planned === false ? press.deploys : undefined;
}

/**
 * The press's answer as its review says it: one that handed planning over, waiting for planning
 * until its rollout's jobs show, then those jobs.
 */
export function useReviewDeploys(press: ReviewPress): HqDeployAnswer | undefined {
  return useHandedOverAnswer(
    answeredDeploys(press),
    press.kind === "done" ? press.rollout : undefined,
  );
}
