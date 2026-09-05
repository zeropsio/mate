import { operationClosing } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsOperationStep } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  type DecodedEntry,
  detailField,
  errorInfoFor,
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

export function buildImportFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "import" ? decoded.card : undefined;
  const read = readImport(decoded);
  const basePhase = phaseFor(call.status);
  const phase =
    basePhase === "done" && read.steps.some((s) => s.state === "failed") ? "failed" : basePhase;
  const subject = read.hostnames.length > 0 ? read.hostnames.join(", ") : "the services";
  const target = read.hostnames[0];
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
    steps: read.steps,
    links: [],
    ...detailField([
      read.document !== undefined ? readString(read.document.nextActions) : undefined,
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    ...(target !== undefined ? { target: { hostname: target } } : {}),
    hasResult: read.document !== undefined,
    phaseOverride: phase,
  };
}
