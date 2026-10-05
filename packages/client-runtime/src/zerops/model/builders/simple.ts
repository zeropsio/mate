/**
 * delete / scale / manage / env — no `payloads.ts` card, just a message
 * document plus the process outcome `decodeProcessOutcome` reads off it.
 */
import { readString } from "../../cards/decode.ts";
import { decodeProcessOutcome, type ZeropsProcessOutcome } from "../../cards/payloads.ts";
import { envChangeWords, operationClosing } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsEnvChange } from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  errorInfoFor,
  explanationField,
  failedCallReason,
  firstLine,
  firstParagraph,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  readInputString,
} from "./shared.ts";

const SIMPLE_VOICE_SOURCE_FIELDS = ["hostname", "serviceHostname", "targetService"] as const;

function readSimpleSubject(
  input: Record<string, unknown> | undefined,
  document: Record<string, unknown> | undefined,
): string | undefined {
  for (const field of SIMPLE_VOICE_SOURCE_FIELDS) {
    const fromInput = readInputString(input, field);
    if (fromInput !== undefined) {
      return fromInput;
    }
  }
  for (const field of SIMPLE_VOICE_SOURCE_FIELDS) {
    const fromDocument = document !== undefined ? readString(document[field]) : undefined;
    if (fromDocument !== undefined) {
      return fromDocument;
    }
  }
  return undefined;
}

export function buildSimpleFields(
  kind: "delete" | "scale" | "manage" | "env",
  call: ZeropsCall,
): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const phase = phaseFor(call.status);
  const envChange = kind === "env" ? readEnvChange(call.input) : undefined;
  const subject =
    envChange === undefined
      ? (readSimpleSubject(call.input, decoded.document) ?? "the service")
      : envChange.scope === "project"
        ? "the project"
        : (envChange.service ?? "the service");
  const { voice, voiceSource } =
    envChange === undefined
      ? mateVoiceFor(kind, subject)
      : { voice: `${envChangeWords(envChange, "running")}.`, voiceSource: "mate" as const };

  const outcome =
    decoded.document !== undefined ? decodeProcessOutcome(decoded.document) : undefined;
  const rawMessage =
    decoded.document !== undefined ? readString(decoded.document.message) : undefined;
  const summary = decoded.document !== undefined ? readString(decoded.document.summary) : undefined;
  const messageFirstParagraph = rawMessage !== undefined ? firstParagraph(rawMessage) : undefined;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing(kind, "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? operationClosing(kind, "done", { message: messageFirstParagraph, summary })
          : operationClosing(kind, phase, {});

  return {
    subject,
    kicker: `${KIND_LABEL[kind]} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      kind,
      phase,
      decoded.document !== undefined,
      call.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    steps: [
      buildStep(
        kind,
        subject,
        phase === "failed" ? "FAILED" : phase === "done" ? "ACTIVE" : "in_progress",
      ),
    ],
    links: [],
    // The project, or a setup block a `.env` is written for, is no service to observe.
    ...(envChange === undefined || (envChange.scope === "service" && envChange.action !== "dotenv")
      ? { target: { hostname: subject } }
      : {}),
    ...(envChange !== undefined ? { envChange } : {}),
    hasResult: decoded.document !== undefined,
    ...(errorInfo !== undefined
      ? explanationField(failedCallReason(decoded, errorInfo))
      : explanationField(outcomeReason(decoded.document, outcome))),
  };
}

/** The platform's reason for a failed process, else zcp's own word on a process it stopped waiting for. */
function outcomeReason(
  document: Record<string, unknown> | undefined,
  outcome: ZeropsProcessOutcome | undefined,
): string | undefined {
  if (outcome?.process?.status === "FAILED") {
    return outcome.process.failReason ?? readString(document?.message);
  }
  if (outcome?.timedOut === true) {
    return readString(document?.message) ?? readString(document?.warning);
  }
  return undefined;
}

const ENV_ACTIONS: Readonly<Record<string, ZeropsEnvChange["action"]>> = {
  get: "get",
  set: "set",
  delete: "delete",
  "generate-dotenv": "dotenv",
};

/**
 * What a `zerops_env` call changes and where, from its input (zcp
 * `internal/tools/env.go`): `project` (a boolean, or its string from some
 * agents) names the project's variables, else `serviceHostname` a service's;
 * `generate-dotenv` writes a `.env` for its `setup` block. The variables are
 * only counted: their values can be secrets.
 */
function readEnvChange(input: Record<string, unknown> | undefined): ZeropsEnvChange {
  const action = ENV_ACTIONS[readInputString(input, "action") ?? ""] ?? "update";
  const project = input?.project === true || input?.project === "true";
  const service =
    action === "dotenv"
      ? (readInputString(input, "setup") ?? readInputString(input, "serviceHostname"))
      : readInputString(input, "serviceHostname");
  const count = action === "set" || action === "delete" ? variablesCount(input) : undefined;
  const scope = project && action !== "dotenv" ? "project" : "service";
  return {
    action,
    scope,
    ...(scope === "project" || service === undefined ? {} : { service }),
    ...(count === undefined ? {} : { count }),
  };
}

/**
 * How many variables an env call names: its `variables` list, or the count
 * the live step relays in its place (`variablesCount`, the server's
 * `ThreadLiveStep`), never their entries.
 */
function variablesCount(input: Record<string, unknown> | undefined): number | undefined {
  const variables = input?.variables;
  if (Array.isArray(variables)) return variables.length;
  const relayed = readInputString(input, "variablesCount");
  return relayed !== undefined && /^\d+$/u.test(relayed) ? Number(relayed) : undefined;
}
