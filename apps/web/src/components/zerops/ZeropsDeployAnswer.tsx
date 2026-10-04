/** HQ's answer replaces a service's planned deploy line, inside the section that names it. */
import type { ReviewPress } from "@t3tools/client-runtime/zerops";
import { deployAnswerSaid } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { Fragment } from "react";
import { useDeployAnswerLogs } from "~/zerops/activity/useDeployAnswerLogs";
import { ZeropsDeployLog } from "./ZeropsDeployLog";

export function ZeropsDeployAnswer({
  answer,
  rows,
  showEnvironment,
}: {
  readonly answer?: HqDeployAnswer | undefined;
  readonly showEnvironment?: boolean | undefined;
  readonly rows?: ReadonlyArray<{ readonly service: string; readonly line: string }> | undefined;
}) {
  const logs = useDeployAnswerLogs(answer);
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
                    {job.line}
                    {log === undefined ? null : (
                      <ZeropsDeployLog
                        key={log.target.jobId}
                        projectId={log.projectId}
                        service={job.service!}
                        target={log.target}
                      />
                    )}
                  </span>
                </Fragment>
              );
            }),
        )}
        {fallback.map(({ service, line }) => (
          <Fragment key={service}>
            <b>{service}</b>
            <span>{line}</span>
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
  return press.deploys.jobs.length > 0 || press.deploys.note?.trim() ? press.deploys : undefined;
}
