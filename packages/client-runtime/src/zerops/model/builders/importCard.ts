import { operationClosing } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsOperationPhase, ZeropsOperationStep } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  type DecodedEntry,
  detailField,
  errorInfoFor,
  explanationField,
  failedCallReason,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  undecodedDetail,
} from "./shared.ts";
import { readString } from "../../cards/decode.ts";

export interface ImportRead {
  readonly hostnames: string[];
  readonly steps: ZeropsOperationStep[];
  readonly summary?: string | undefined;
  readonly errorFirstLine?: string | undefined;
  readonly document?: Record<string, unknown> | undefined;
}

/** Shared with the bootstrap builder — a `zerops_import` call joined into a session. */
export function readImport(decoded: DecodedEntry): ImportRead {
  const card = decoded.card?.kind === "import" ? decoded.card : undefined;
  if (card === undefined) {
    return { hostnames: [], steps: [], document: decoded.document };
  }
  const byHost = new Map<string, { status: string; failReason?: string }>();
  for (const service of card.services) {
    byHost.set(service.hostname, {
      status: service.status,
      ...(service.failReason !== undefined ? { failReason: service.failReason } : {}),
    });
  }
  const hostnames = [...byHost.keys()];
  const steps = hostnames.map((hostname) => {
    const info = byHost.get(hostname)!;
    const failed = info.failReason !== undefined;
    return buildStep(hostname, hostname, failed ? "FAILED" : info.status, info.failReason);
  });
  const errorFirstLine =
    card.errors.length > 0
      ? firstLine(card.errors[0]!.message)
      : steps.find((s) => s.state === "failed")?.note !== undefined
        ? firstLine(steps.find((s) => s.state === "failed")!.note!)
        : undefined;
  return {
    hostnames,
    steps,
    ...(card.summary !== undefined ? { summary: card.summary } : {}),
    ...(errorFirstLine !== undefined ? { errorFirstLine } : {}),
    document: decoded.document,
  };
}

/**
 * The `services[].hostname` values of an inline import YAML (`content`), in
 * its order — known from the call's start, so the card and the overlay name
 * their targets before the result lands. A line reader, not a YAML parser: a
 * hostname written in a shape it does not recognise is simply not known
 * until the result names it. `filePath` imports carry no YAML to read.
 */
function importYamlHostnames(input: Record<string, unknown>): ReadonlyArray<string> {
  const content = readString(input.content);
  if (content === undefined) {
    return [];
  }
  return content.split("\n").flatMap((line) => {
    const hostname = line.match(/^\s*(?:-\s+)?hostname:\s*["']?([a-z0-9]+)["']?\s*(?:#.*)?$/)?.[1];
    return hostname === undefined ? [] : [hostname];
  });
}

/** A YAML-named service the result has not reported on yet reads as the call's own phase. */
const UNREPORTED_STEP_STATUS: Readonly<Record<ZeropsOperationPhase, string>> = {
  running: "in_progress",
  done: "FINISHED",
  failed: "FAILED",
  uncertain: "pending",
  declined: "pending",
  stopped: "pending",
  interrupted: "pending",
  reset: "pending",
};

export function buildImportFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "import" ? decoded.card : undefined;
  const read = readImport(decoded);
  const basePhase = phaseFor(call.status);
  const phase =
    basePhase === "done" && read.steps.some((s) => s.state === "failed") ? "failed" : basePhase;
  const hostnames = [...new Set([...importYamlHostnames(call.input), ...read.hostnames])];
  const processIds = (card?.services ?? []).flatMap((service) =>
    service.processId === undefined ? [] : [service.processId],
  );
  const subject = hostnames.length > 0 ? hostnames.join(", ") : "the services";
  const target = hostnames[0];
  const steps = hostnames.flatMap((hostname) => {
    if (card === undefined) {
      return [buildStep(hostname, hostname, UNREPORTED_STEP_STATUS[phase])];
    }
    const reported = read.steps.find((step) => step.id === hostname);
    if (reported !== undefined) {
      return [reported];
    }
    const error = card.errors.find((entry) => entry.hostname === hostname);
    return error === undefined ? [] : [buildStep(hostname, hostname, "FAILED", error.message)];
  });
  const { voice, voiceSource } = mateVoiceFor("import", subject);

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("import", "failed", {
            errorFirstLine:
              read.errorFirstLine ??
              (errorInfo !== undefined ? firstLine(errorInfo.message) : undefined),
          })
        : phase === "done"
          ? card !== undefined
            ? operationClosing("import", "done", {
                summary: read.summary,
                createdCount: read.hostnames.length,
              })
            : "Finished."
          : operationClosing("import", phase, {});

  return {
    subject,
    kicker: `${KIND_LABEL.import} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord("import", phase, card !== undefined, call.resultText !== undefined),
    ...(closing !== undefined ? { closing } : {}),
    steps,
    links: [],
    ...detailField([
      card?.nextActions,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    ...(target !== undefined ? { target: { hostname: target } } : {}),
    hasResult: read.document !== undefined,
    ...(processIds.length > 0 ? { processIds } : {}),
    ...(errorInfo !== undefined
      ? explanationField(failedCallReason(decoded, errorInfo))
      : explanationField(read.errorFirstLine)),
    phaseOverride: phase,
  };
}
