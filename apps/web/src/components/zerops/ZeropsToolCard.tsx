/** Presentational process shells for decoded `zerops_*` results. */
import type { ServiceStatusToneId } from "@t3tools/shared/brand";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";

import {
  Chip,
  FlatCard,
  MicroLabel,
  ProcessSteps,
  StatusDot,
  type ProcessStep,
  type ProcessStepState,
} from "~/components/zerops/primitives";
import type {
  ZeropsCardPayload,
  ZeropsCheckLine,
} from "@t3tools/client-runtime/zerops/cards/payloads";

const DONE = /^(active|deployed|done|finished|healthy|mounted|ok|pass|passed|success)$/iu;
const FAILED = /^(build_failed|degraded|error|fail|failed|unhealthy)$/iu;
const RUNNING = /^(building|current|deploying|in.?progress|running)$/iu;
const BUILD_TRIGGERED = /^build_triggered$/iu;

const HEADER_TONE_CLASS: Record<ServiceStatusToneId, string> = {
  ok: "bg-[var(--zerops-status-ok-surface)]",
  busy: "bg-[var(--zerops-status-busy-surface)]",
  attention: "bg-[var(--zerops-status-attention-surface)]",
  failed: "bg-[var(--zerops-status-failed-surface)]",
  off: "bg-[var(--zerops-status-off-surface)]",
};

const stepState = (status: string): ProcessStepState => {
  if (FAILED.test(status)) return "failed";
  if (RUNNING.test(status)) return "running";
  if (DONE.test(status)) return "done";
  return "queued";
};

const passed = (status: string) => DONE.test(status);
const failed = (status: string) => FAILED.test(status);
const sentenceCase = (value: string) =>
  value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1).toLowerCase()}`;

function UrlChip({ url }: { readonly url: string }) {
  return (
    <a
      aria-label={`Open ${url}`}
      className="inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 font-medium text-info-foreground text-xs hover:underline"
      data-zerops-chip-kind="url"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      <GlobeIcon aria-hidden="true" className="size-3 text-success-foreground" />
      <span>{url.replace(/^https?:\/\//u, "")}</span>
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
    </a>
  );
}

function InfoChip({
  label,
  tone = "off",
}: {
  readonly label: string;
  readonly tone?: ServiceStatusToneId;
}) {
  return <Chip data-zerops-chip-kind="info" label={label} tone={tone} />;
}

function CardShell({
  children,
  kicker,
  kind,
  outcome,
  status,
  steps,
  title,
  tone,
}: {
  readonly children?: React.ReactNode;
  readonly kicker: string;
  readonly kind: ZeropsCardPayload["kind"];
  readonly outcome: string;
  readonly status: string;
  readonly steps: ReadonlyArray<ProcessStep>;
  readonly title: string;
  readonly tone: ServiceStatusToneId;
}) {
  return (
    <FlatCard
      className="overflow-hidden"
      data-zerops-card
      data-zerops-card-kind={kind}
      data-zerops-card-tone={tone}
    >
      <header className={`${HEADER_TONE_CLASS[tone]} px-3 py-2.5`}>
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>{kicker}</MicroLabel>
          <span aria-label="Result status" role="status">
            <StatusDot label={status} pulse={tone === "busy"} tone={tone} />
          </span>
        </div>
        <div className="mt-1 font-medium text-foreground text-sm">
          <h3>{title}</h3>
        </div>
      </header>
      <div className="space-y-3 px-3 py-3 text-xs leading-relaxed">
        <ProcessSteps aria-label={`${title} progress`} steps={steps} />
        <div className="font-medium text-foreground text-sm">
          <p data-zerops-card-outcome="true">{outcome}</p>
        </div>
        {children}
      </div>
    </FlatCard>
  );
}

const checkStep = (check: ZeropsCheckLine, index: number): ProcessStep => ({
  id: `${check.name}:${index}`,
  label: check.name,
  state: stepState(check.status),
  stateLabel: check.status,
});

function CheckInfo({ checks }: { readonly checks: ReadonlyArray<ZeropsCheckLine> }) {
  const details = checks.flatMap((check) => [
    ...(check.httpStatus === undefined ? [] : [`${check.name} · HTTP ${check.httpStatus}`]),
    ...(check.detail === undefined ? [] : [`${check.name} · ${check.detail}`]),
  ]);
  return details.length === 0 ? null : (
    <div aria-label="Technical details" className="flex flex-wrap gap-1.5">
      {details.map((detail) => (
        <InfoChip key={detail} label={detail} />
      ))}
    </div>
  );
}

export function ZeropsToolCard({ payload }: { readonly payload: ZeropsCardPayload }) {
  switch (payload.kind) {
    case "plan": {
      const steps = payload.steps.map((step, index) => ({
        id: `${step.name}:${index}`,
        label: step.name,
        state: stepState(step.status),
        stateLabel: step.status,
      }));
      const hasFailure = steps.some((step) => step.state === "failed");
      const complete = payload.total > 0 && payload.completed >= payload.total;
      const tone = hasFailure ? "failed" : complete ? "ok" : "busy";
      const status = hasFailure ? "Failed" : complete ? "Complete" : "In progress";
      return (
        <CardShell
          kicker="Plan"
          kind={payload.kind}
          outcome={`${payload.completed} of ${payload.total} steps complete`}
          status={status}
          steps={steps}
          title={payload.intent ?? "Project plan"}
          tone={tone}
        >
          {payload.message === undefined ? null : (
            <p className="text-muted-foreground">{payload.message}</p>
          )}
        </CardShell>
      );
    }

    case "import": {
      const serviceSteps = payload.services.map((service, index) => ({
        id: `${service.hostname}:${index}`,
        label: service.hostname,
        state: stepState(service.status),
        stateLabel: service.status,
      }));
      const errorSteps = payload.errors.map((error, index) => ({
        id: `${error.hostname}:error:${index}`,
        label: error.hostname,
        state: "failed" as const,
        stateLabel: "Import failed",
      }));
      const steps = [...serviceSteps, ...errorSteps];
      const done = serviceSteps.filter((step) => step.state === "done").length;
      const hasFailure = steps.some((step) => step.state === "failed");
      const hasProgress = steps.some((step) => step.state === "running");
      const tone = hasFailure ? (done > 0 ? "attention" : "failed") : hasProgress ? "busy" : "ok";
      const status = hasFailure
        ? done > 0
          ? "Partially imported"
          : "Import failed"
        : hasProgress
          ? "Importing"
          : "Imported";
      return (
        <CardShell
          kicker="Import"
          kind={payload.kind}
          outcome={`${done} of ${steps.length} services imported`}
          status={status}
          steps={steps}
          title={`Import ${payload.projectName ?? "project"}`}
          tone={tone}
        >
          <div aria-label="Technical details" className="flex flex-wrap gap-1.5">
            {payload.services.flatMap((service) => [
              ...(service.action === undefined
                ? []
                : [
                    <InfoChip
                      key={`${service.hostname}:action`}
                      label={`${service.hostname} · ${service.action}`}
                    />,
                  ]),
              ...(service.failReason === undefined
                ? []
                : [
                    <InfoChip
                      key={`${service.hostname}:reason`}
                      label={`${service.hostname} · ${service.failReason}`}
                      tone="failed"
                    />,
                  ]),
            ])}
            {payload.errors.map((error) => (
              <InfoChip
                key={`${error.hostname}:error`}
                label={`${error.hostname} · ${error.message}`}
                tone="failed"
              />
            ))}
          </div>
        </CardShell>
      );
    }

    case "mount": {
      const steps = payload.mounts.map((mount, index) => ({
        id: `${mount.hostname}:${index}`,
        label: mount.hostname,
        state: mount.mounted ? ("done" as const) : ("failed" as const),
        stateLabel: mount.mounted ? "Mounted" : "Not mounted",
      }));
      const mounted = payload.mounts.filter((mount) => mount.mounted).length;
      const tone =
        mounted === payload.mounts.length ? "ok" : mounted === 0 ? "failed" : "attention";
      const status =
        tone === "ok" ? "Mounted" : tone === "failed" ? "Mount failed" : "Partially mounted";
      return (
        <CardShell
          kicker="Mount"
          kind={payload.kind}
          outcome={`${mounted} of ${payload.mounts.length} services mounted`}
          status={status}
          steps={steps}
          title={
            payload.mounts.length === 1 ? `Mount ${payload.mounts[0]!.hostname}` : "Mount services"
          }
          tone={tone}
        >
          <div aria-label="Technical details" className="flex flex-wrap gap-1.5">
            {payload.mounts.map((mount) => {
              const detail = mount.mountPath ?? mount.message;
              return detail === undefined ? null : (
                <InfoChip
                  key={mount.hostname}
                  label={`${mount.hostname} · ${detail}`}
                  tone={mount.mounted ? "off" : "failed"}
                />
              );
            })}
          </div>
        </CardShell>
      );
    }

    case "deploy": {
      const buildTriggered = BUILD_TRIGGERED.test(payload.status);
      const didFail = payload.failedPhase !== undefined || failed(payload.status);
      const state = didFail ? "failed" : buildTriggered ? "running" : stepState(payload.status);
      const tone = didFail ? "failed" : state === "running" ? "busy" : "ok";
      const status = didFail
        ? "Deploy failed"
        : buildTriggered
          ? "Build triggered"
          : state === "running"
            ? "Deploying"
            : "Deployed";
      const outcome = didFail
        ? `Failed${payload.failedPhase === undefined ? "" : ` during ${payload.failedPhase}`}${payload.failureCause === undefined ? "" : `: ${payload.failureCause}`}`
        : buildTriggered
          ? (payload.message ?? "Build and deploy continue asynchronously")
          : payload.buildDuration === undefined
            ? (payload.message ?? "Deployment completed")
            : `Deployment completed in ${payload.buildDuration}`;
      const steps: ReadonlyArray<ProcessStep> = [
        ...(payload.buildStatus === undefined
          ? []
          : [
              {
                id: "build",
                label: "Build",
                state: stepState(payload.buildStatus),
                stateLabel: payload.buildStatus,
              },
            ]),
        { id: "deploy", label: payload.target, state, stateLabel: payload.status },
      ];
      return (
        <CardShell
          kicker={`Deploy · ${payload.target}`}
          kind={payload.kind}
          outcome={outcome}
          status={status}
          steps={steps}
          title={`Deploy ${payload.target}`}
          tone={tone}
        >
          <div aria-label="Technical details" className="flex flex-wrap gap-1.5">
            {payload.buildStatus === undefined ? null : (
              <InfoChip label={`Build ${payload.buildStatus}`} tone={tone} />
            )}
            {payload.buildDuration === undefined ? null : (
              <InfoChip label={payload.buildDuration} />
            )}
            {payload.failureAction === undefined ? null : (
              <InfoChip label={payload.failureAction} tone="failed" />
            )}
            {payload.warnings.map((warning) => (
              <InfoChip key={warning} label={warning} tone="attention" />
            ))}
          </div>
          {payload.subdomainUrl === undefined ? null : (
            <div aria-label="URLs" className="flex flex-wrap gap-1.5">
              <UrlChip url={payload.subdomainUrl} />
            </div>
          )}
        </CardShell>
      );
    }

    case "verify": {
      const steps =
        payload.checks.length === 0
          ? [
              {
                id: "verify",
                label: payload.hostname,
                state: stepState(payload.status),
                stateLabel: payload.status,
              },
            ]
          : payload.checks.map(checkStep);
      const passedChecks = payload.checks.filter((check) => passed(check.status)).length;
      const didFail = failed(payload.status) || steps.some((step) => step.state === "failed");
      const tone = didFail
        ? "failed"
        : steps.some((step) => step.state === "running")
          ? "busy"
          : "ok";
      return (
        <CardShell
          kicker={`Verify · ${payload.hostname}`}
          kind={payload.kind}
          outcome={
            payload.checks.length === 0
              ? sentenceCase(payload.status)
              : `${passedChecks} of ${payload.checks.length} checks passed`
          }
          status={didFail ? "Checks failed" : tone === "busy" ? "Checking" : "Healthy"}
          steps={steps}
          title={`Verify ${payload.hostname}`}
          tone={tone}
        >
          <CheckInfo checks={payload.checks} />
        </CardShell>
      );
    }

    case "subdomain": {
      const action = sentenceCase(payload.action);
      const completed = payload.urls.length > 0 || /^(disable|disabled)$/iu.test(payload.action);
      return (
        <CardShell
          kicker={`Subdomain · ${payload.hostname}`}
          kind={payload.kind}
          outcome={`Subdomain ${payload.action.toLowerCase()}d`}
          status={completed ? `${action}d` : "Pending"}
          steps={[
            {
              id: "subdomain",
              label: payload.hostname,
              state: completed ? "done" : "queued",
              stateLabel: completed ? `${action}d` : "Pending",
            },
          ]}
          title={`${action} subdomain for ${payload.hostname}`}
          tone={completed ? "ok" : "attention"}
        >
          {payload.urls.length === 0 ? null : (
            <div aria-label="URLs" className="flex flex-wrap gap-1.5">
              {payload.urls.map((url) => (
                <UrlChip key={url} url={url} />
              ))}
            </div>
          )}
        </CardShell>
      );
    }

    case "error": {
      const steps: ReadonlyArray<ProcessStep> = [
        ...payload.checks.map(checkStep),
        { id: "operation-error", label: payload.code, state: "failed", stateLabel: "Failed" },
      ];
      return (
        <CardShell
          kicker={`Error · ${payload.code}`}
          kind={payload.kind}
          outcome={payload.message}
          status="Failed"
          steps={steps}
          title="Operation failed"
          tone="failed"
        >
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-destructive-foreground">
            {payload.message}
          </p>
          {payload.suggestion === undefined ? null : (
            <p className="text-muted-foreground">{payload.suggestion}</p>
          )}
          <div aria-label="Technical details" className="flex flex-wrap gap-1.5">
            {payload.failureClass === undefined ? null : (
              <InfoChip label={payload.failureClass} tone="failed" />
            )}
          </div>
          <CheckInfo checks={payload.checks} />
        </CardShell>
      );
    }
  }
}
