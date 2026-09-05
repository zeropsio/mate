import {
  humanizeToolName,
  operationClosing,
  operationStatusWord,
} from "../../operations/phrases.ts";
import type { ZeropsCall } from "../types.ts";
import {
  type BuiltCardFields,
  decodeCall,
  detailField,
  errorInfoFor,
  firstLine,
  phaseFor,
  undecodedDetail,
} from "./shared.ts";

/** A failed call whose tool is otherwise hidden/generic-shaped — always kind `error`. */
export function buildErrorFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const toolLabel = humanizeToolName(call.toolName);
  const phase = phaseFor(call.status);
  const code = decoded.card?.kind === "error" ? decoded.card.code : undefined;

  return {
    subject: toolLabel,
    kicker: `Error · ${code ?? toolLabel}`,
    voice: `${toolLabel} failed.`,
    voiceSource: "mate",
    statusWord: operationStatusWord("error", phase),
    closing: operationClosing("error", phase === "running" ? "failed" : phase, {
      errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
    }),
    steps: [],
    links: [],
    ...detailField([
      errorInfo?.diagnostic,
      errorInfo?.suggestion,
      decoded.card === undefined ? undecodedDetail(call) : undefined,
    ]),
    hasResult: decoded.document !== undefined,
    phaseOverride: "failed",
  };
}
