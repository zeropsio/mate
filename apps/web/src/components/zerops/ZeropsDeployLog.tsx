import { useProjectActivityRead } from "~/zerops/activity/useProjectActivity";
import { useState } from "react";
import { deployLogProcess, type DeployLogTarget } from "@t3tools/client-runtime/zerops/hq";
import { useDeployLog } from "~/zerops/activity/useDeployLog";
import { useOpenPipeline } from "~/zerops/pipelineSearch";
import { Button, InlineButton } from "../ui/button";
import { ZeropsBuildLog } from "./ZeropsBuildLog";
import { PipelineCalculating, PipelineStepList } from "./operation/PipelineStepList";
import { Text } from "~/components/ui/text";

/**
 * The same process handles open from a stop or the answer to a merge, release, or Run again: its
 * door at the end of its service's row in Where's list (`ZeropsDeployAnswer`), and what it opens
 * under the row, across the list.
 */
export function ZeropsDeployLog({
  projectId,
  target,
  service,
}: {
  readonly projectId: string;
  readonly target: DeployLogTarget;
  readonly service: string;
}) {
  const [open, setOpen] = useState(false);
  const unavailable = useDeployLogUnavailable(projectId, target);
  const openPipeline = useOpenPipeline();
  const versionId = target.appVersionId;
  if (versionId !== null) {
    // A deploy whose version is known opens its pipeline: one place for a pipeline's detail.
    return (
      <span className="justify-self-end" data-zerops-deploy-job={target.jobId}>
        <Button onClick={() => openPipeline(versionId)} size="sm" variant="link">
          View deploy
        </Button>
      </span>
    );
  }
  return (
    <>
      <span className="justify-self-end" data-zerops-deploy-job={target.jobId}>
        <Button aria-expanded={open} onClick={() => setOpen(!open)} size="sm" variant="link">
          {open ? "Hide deploy" : unavailable ? "Check deploy history" : "View deploy"}
        </Button>
      </span>
      {!open && unavailable ? (
        <Text className="col-span-full" render={<p />} variant="note">
          Deploy history unavailable in Zerops’ recent processes.
        </Text>
      ) : null}
      {open ? (
        <div className="col-span-full pb-2">
          <DeployLogDetails
            key={target.jobId}
            projectId={projectId}
            service={service}
            target={target}
          />
        </div>
      ) : null}
    </>
  );
}

/** Whether Zerops' recent processes no longer hold the deploy: its history is checked instead. */
export function useDeployLogUnavailable(projectId: string, target: DeployLogTarget): boolean {
  const history = useProjectActivityRead(projectId);
  return (
    history.processHistory === "read" &&
    history.processes !== undefined &&
    deployLogProcess(target, projectId, history.processes)?.appVersion === undefined
  );
}

/** What *View deploy* opens: the deploy's steps and its build log, read while it is open. */
export function DeployLogDetails({
  projectId,
  target,
  service,
}: {
  readonly projectId: string;
  readonly target: DeployLogTarget;
  readonly service: string;
}) {
  const { read, buildLog, words, again } = useDeployLog(projectId, target, service);
  const [logOpen, setLogOpen] = useState(false);
  const log =
    read?.query === undefined ? undefined : (
      <ZeropsBuildLog
        lines={buildLog.lines}
        status={buildLog.status}
        open={logOpen}
        onToggle={() => setLogOpen(!logOpen)}
        subject={service}
        stands={!read.live}
      />
    );
  const pipeline = read?.pipeline;
  return (
    <div className="pt-2" data-zerops-deploy-inspection>
      {words === undefined ? null : (
        <Text render={<p />} variant="note">
          {words}
          {again === undefined ? null : (
            <>
              {" "}
              <InlineButton onClick={again} tone="muted">
                Try again
              </InlineButton>
            </>
          )}
        </Text>
      )}
      {pipeline === undefined ? null : pipeline.calculating || pipeline.steps.length === 0 ? (
        read?.live ? (
          <PipelineCalculating aria-label={`${service} deploy steps`} />
        ) : (
          <Text render={<p />} variant="note">
            Zerops keeps no pipeline steps for this deploy.
          </Text>
        )
      ) : (
        <PipelineStepList
          aria-label={`${service} deploy steps`}
          steps={pipeline.steps}
          after={{ RUN_BUILD_COMMANDS: log }}
        />
      )}
      {pipeline?.steps.some(({ id }) => id === "RUN_BUILD_COMMANDS") ? null : log}
    </div>
  );
}
