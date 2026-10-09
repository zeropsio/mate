import { useProjectActivityRead } from "~/zerops/activity/useProjectActivity";
import { useState } from "react";
import { deployLogProcess, type DeployLogTarget } from "@t3tools/client-runtime/zerops/hq";
import { useDeployLog } from "~/zerops/activity/useDeployLog";
import { Button } from "../ui/button";
import { ZeropsBuildLog } from "./ZeropsBuildLog";
import { PipelineCalculating, PipelineStepList } from "./operation/PipelineStepList";

/** The same process handles open from a stop or the answer to a merge, release, or Run again. */
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
  const history = useProjectActivityRead(projectId);
  const unavailable =
    history.processHistory === "read" &&
    history.processes !== undefined &&
    deployLogProcess(target, projectId, history.processes)?.appVersion === undefined;
  return (
    <div className="pb-2" data-zerops-deploy-job={target.jobId}>
      {!open && unavailable ? (
        <p className="text-xs text-muted-foreground">
          Deploy history unavailable in Zerops’ recent processes.
        </p>
      ) : null}
      <Button aria-expanded={open} onClick={() => setOpen(!open)} size="compact" variant="ghost">
        {open ? "Hide deploy" : unavailable ? "Check deploy history" : "View deploy"}
      </Button>
      {open ? (
        <DeployLogDetails
          key={target.jobId}
          projectId={projectId}
          service={service}
          target={target}
        />
      ) : null}
    </div>
  );
}

function DeployLogDetails({
  projectId,
  target,
  service,
}: {
  readonly projectId: string;
  readonly target: DeployLogTarget;
  readonly service: string;
}) {
  const { read, buildLog, words } = useDeployLog(projectId, target, service);
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
      {words === undefined ? null : <p className="text-xs text-muted-foreground">{words}</p>}
      {pipeline === undefined ? null : pipeline.calculating || pipeline.steps.length === 0 ? (
        read?.live ? (
          <PipelineCalculating aria-label={`${service} deploy steps`} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Zerops keeps no pipeline steps for this deploy.
          </p>
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
