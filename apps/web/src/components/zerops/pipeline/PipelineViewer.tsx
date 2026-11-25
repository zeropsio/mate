/**
 * What a pipeline put out, beside its steps: its build log, its runtime prepare log, a failed
 * deploy's service log around the failure, and the zerops.yaml it ran — one at a time in one
 * fixed frame, so the steps and the output read together. A log is read only while it is shown,
 * streams while its step runs, follows its newest line while the reader is at the bottom, and
 * shows each line's time.
 */
import type { BuildLogLine } from "@t3tools/client-runtime/zerops/activity/buildLog";
import { useState, type JSX } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { formatTimestamp } from "~/timestampFormat";
import { useBuildLog } from "~/zerops/activity/useBuildLog";
import type { PipelineLog, PipelineLogKind } from "~/zerops/activity/usePipeline";

import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { CodeBlock, LogView } from "../../ui/code-block";
import { CopyButton } from "../../ui/copy-button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { emptyLogWords } from "../ZeropsBuildLog";
import { Loading } from "~/components/ui/loading";
import { Text } from "~/components/ui/text";

export type PipelineOutput = PipelineLogKind | "config";

const LABEL: Readonly<Record<PipelineOutput, string>> = {
  build: "Build log",
  prepare: "Prepare log",
  service: "Service log",
  config: "zerops.yaml",
};

const ORDER: ReadonlyArray<PipelineOutput> = ["build", "prepare", "service", "config"];

/** A line at or under this syslog severity is an error. */
const FAILED_SEVERITY_MAX = 3;

/** The most lines a log's read brings: one that holds this many is cut at its start. */
const SHOWN_LINES_MAX = 500;

export function PipelineViewer({
  projectId,
  logs,
  config,
  setup,
  shown,
  onShow,
}: {
  readonly projectId: string;
  readonly logs: Readonly<Partial<Record<PipelineLogKind, PipelineLog>>>;
  readonly config: string | null;
  readonly setup: string | null;
  readonly shown: PipelineOutput | null;
  readonly onShow: (output: PipelineOutput) => void;
}): JSX.Element | null {
  const outputs = ORDER.filter((output) =>
    output === "config" ? config !== null : logs[output] !== undefined,
  );
  if (outputs.length === 0 || shown === null) return null;
  const log = shown === "config" ? undefined : logs[shown];
  return (
    <section
      aria-label="Pipeline output"
      className="flex min-h-0 min-w-0 flex-col gap-2"
      data-zerops-pipeline-output={shown}
    >
      <ToggleGroup
        aria-label="Show"
        onValueChange={(next) => {
          const picked = outputs.find((output) => output === next[0]);
          if (picked !== undefined) onShow(picked);
        }}
        value={[shown]}
        variant="segmented"
      >
        {outputs.map((output) => (
          <Toggle key={output} value={output}>
            {LABEL[output]}
          </Toggle>
        ))}
      </ToggleGroup>
      {shown === "config" ? (
        config === null ? null : (
          <ConfigPane config={config} setup={setup} />
        )
      ) : log === undefined ? null : (
        <LogPane key={shown} kind={shown} log={log} projectId={projectId} />
      )}
    </section>
  );
}

function LogPane({
  projectId,
  log,
  kind,
}: {
  readonly projectId: string;
  readonly log: PipelineLog;
  readonly kind: PipelineLogKind;
}): JSX.Element {
  const { lines, status } = useBuildLog({ projectId, query: log.query, live: log.live });
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [times, setTimes] = useState(true);
  const live = status === "live";
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Text className="flex items-center gap-2" render={<div />} variant="note">
        <span className="min-w-0 flex-1 truncate">
          {kind === "service"
            ? "The service's own lines, a minute either side of the failure"
            : live
              ? "Live"
              : lines.length === 0
                ? null
                : lines.length >= SHOWN_LINES_MAX
                  ? `The last ${String(lines.length)} lines`
                  : `${String(lines.length)} lines`}
        </span>
        <Button aria-pressed={times} onClick={() => setTimes(!times)} size="sm" variant="ghost">
          {times ? "Hide times" : "Show times"}
        </Button>
        <CopyButton
          disabled={lines.length === 0}
          label="the log"
          value={() => lines.map((line) => line.text).join("\n")}
        />
      </Text>
      {lines.length === 0 && emptyLogWords(status) === null ? (
        <Card className="h-96 md:h-140">
          <div className="p-4">
            <Loading count={8} label="The log" shape="lines" />
          </div>
        </Card>
      ) : lines.length === 0 ? (
        <Card variant="inset">
          <Text
            className="flex h-96 items-center justify-center md:h-140"
            render={<p />}
            variant="description"
            data-zerops-pipeline-log-empty
          >
            {kind === "service" && status === "ended"
              ? "The service wrote nothing around the failure."
              : emptyLogWords(status)}
          </Text>
        </Card>
      ) : (
        <LogLines format={timestampFormat} lines={lines} live={live} times={times} />
      )}
    </div>
  );
}

function LogLines({
  lines,
  live,
  times,
  format,
}: {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly live: boolean;
  readonly times: boolean;
  readonly format: Parameters<typeof formatTimestamp>[1];
}): JSX.Element {
  return (
    <LogView
      height="pane"
      label="Log"
      lines={lines.map((line) => ({
        id: line.id,
        text: line.text,
        ...(times ? { time: formatTimestamp(line.at, format), at: line.at } : {}),
        ...(line.severity <= FAILED_SEVERITY_MAX ? { tone: "failed" as const } : {}),
      }))}
      live={live}
    />
  );
}

function ConfigPane({
  config,
  setup,
}: {
  readonly config: string;
  readonly setup: string | null;
}): JSX.Element {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Text render={<p />} truncate variant="note">
        {setup === null ? "As the pipeline ran it" : `As the pipeline ran it, setup ${setup}`}
      </Text>
      <CodeBlock copy="zerops.yaml" height="pane" title="zerops.yaml" wrap={false}>
        {config}
      </CodeBlock>
    </div>
  );
}
