/**
 * What a pipeline put out, beside its steps: its build log, its runtime prepare log, a failed
 * deploy's service log around the failure, and the zerops.yaml it ran — one at a time in one
 * fixed frame, so the steps and the output read together. A log is read only while it is shown,
 * streams while its step runs, follows its newest line while the reader is at the bottom, and
 * shows each line's time.
 */
import type { BuildLogLine } from "@t3tools/client-runtime/zerops/activity/buildLog";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { formatTimestamp } from "~/timestampFormat";
import { useBuildLog } from "~/zerops/activity/useBuildLog";
import type { PipelineLog, PipelineLogKind } from "~/zerops/activity/usePipeline";

import { Button } from "../../ui/button";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { emptyLogWords } from "../ZeropsBuildLog";

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

/** How long a copy says so. */
const COPIED_MS = 1_200;

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
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
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
        <CopyLines lines={lines} />
      </div>
      {lines.length === 0 ? (
        <p
          className="flex h-96 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground text-sm md:h-140"
          data-zerops-pipeline-log-empty
        >
          {kind === "service" && status === "ended"
            ? "The service wrote nothing around the failure."
            : emptyLogWords(status)}
        </p>
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
  const scrollerRef = useRef<HTMLOListElement>(null);
  const followingRef = useRef(true);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // A line arriving, or the frame changing size (its lines wrap anew), keeps the newest in
    // sight while the reader follows it.
    const pin = () => {
      if (followingRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    pin();
    const added = new MutationObserver(pin);
    added.observe(scroller, { childList: true });
    const resized = new ResizeObserver(pin);
    resized.observe(scroller);
    return () => {
      added.disconnect();
      resized.disconnect();
    };
  }, []);
  return (
    <ol
      aria-label="Log"
      aria-live={live ? "polite" : undefined}
      className="h-96 overflow-y-auto rounded-lg bg-muted/60 py-2 font-mono text-xs leading-5 md:h-140"
      data-zerops-pipeline-log
      onScroll={(event) => {
        const scroller = event.currentTarget;
        followingRef.current =
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
      }}
      ref={scrollerRef}
    >
      {lines.map((line) => (
        <li
          className={cn(
            "flex gap-3 px-3",
            line.severity <= FAILED_SEVERITY_MAX && "bg-destructive/8 text-destructive-foreground",
          )}
          data-zerops-pipeline-log-severity={line.severity}
          key={line.id}
        >
          {times ? (
            <time
              className="shrink-0 select-none text-muted-foreground tabular-nums"
              dateTime={line.at}
            >
              {formatTimestamp(line.at, format)}
            </time>
          ) : null}
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line.text}</span>
        </li>
      ))}
    </ol>
  );
}

function CopyLines({ lines }: { readonly lines: ReadonlyArray<BuildLogLine> }): JSX.Element {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      aria-label={copied ? "Copied the log" : "Copy the log"}
      disabled={lines.length === 0}
      onClick={() => {
        const text = lines.map((line) => line.text).join("\n");
        void writeTextToClipboard(text, "log").then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      size="icon-sm"
      variant="ghost"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function ConfigPane({
  config,
  setup,
}: {
  readonly config: string;
  readonly setup: string | null;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span className="min-w-0 flex-1 truncate">
          {setup === null ? "As the pipeline ran it" : `As the pipeline ran it, setup ${setup}`}
        </span>
        <Button
          aria-label={copied ? "Copied zerops.yaml" : "Copy zerops.yaml"}
          onClick={() => {
            void writeTextToClipboard(config, "zerops.yaml").then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          size="icon-sm"
          variant="ghost"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <pre
        className="h-96 overflow-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs leading-5 md:h-140"
        data-zerops-pipeline-config
      >
        {config}
      </pre>
    </div>
  );
}
