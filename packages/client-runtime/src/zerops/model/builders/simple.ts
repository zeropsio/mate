import { restartCardReadout } from "../../activity/observedSteps.ts";
/**
 * delete / scale / manage / env — no `payloads.ts` card, just a message
 * document plus the process outcome `decodeProcessOutcome` reads off it.
 */
import { readString } from "../../cards/decode.ts";
import { decodeProcessOutcome, type ZeropsProcessOutcome } from "../../cards/payloads.ts";
import { envChangeWords, operationClosing } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsEnvChange, ZeropsVaultRequest } from "../types.ts";
import {
  type BuiltCardFields,
  type OperationBuildContext,
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
  context?: OperationBuildContext,
): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const callPhase = phaseFor(call.status);
  const envChange = kind === "env" ? readEnvChange(call.input, decoded.document) : undefined;
  // The service it names, the one it observes: none where it names none.
  const named =
    envChange === undefined
      ? readSimpleSubject(call.input, decoded.document)
      : envChange.scope === "service" &&
          envChange.action !== "dotenv" &&
          envChange.action !== "dotenvPreview"
        ? envChange.service
        : undefined;
  const subject =
    named ??
    (envChange?.scope === "project"
      ? "the project"
      : envChange?.action === "dotenv" || envChange?.action === "dotenvPreview"
        ? (envChange.service ?? "the service")
        : "the service");
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

  const returnedRestart =
    kind === "manage" && outcome?.process?.actionName === "stack.restart"
      ? outcome.process
      : undefined;
  const observedRestart =
    returnedRestart === undefined ? undefined : context?.processes?.(returnedRestart.id);
  // A history baseline behind a terminal tool result cannot put that process back in progress.
  const restart =
    observedRestart === undefined ||
    (returnedRestart !== undefined &&
      ["FAILED", "FINISHED", "CANCELED"].includes(returnedRestart.status) &&
      !["FAILED", "FINISHED", "CANCELED"].includes(observedRestart.status))
      ? returnedRestart
      : observedRestart;
  const phase =
    restart === undefined
      ? callPhase
      : restart.status === "FAILED" || restart.status === "CANCELED"
        ? "failed"
        : restart.status === "FINISHED"
          ? "done"
          : "running";
  const restartWords =
    restart === undefined ? undefined : restartCardReadout(restart, named ?? subject, NaN);
  // An env call's failure never carries an entry it was given: values can be secrets.
  const failure =
    errorInfo === undefined
      ? undefined
      : kind === "env"
        ? envFailureLine(firstLine(errorInfo.message), decoded.document, call.input)
        : firstLine(errorInfo.message);
  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing(kind, "failed", { errorFirstLine: failure })
        : phase === "done"
          ? operationClosing(kind, "done", { message: messageFirstParagraph, summary })
          : operationClosing(kind, phase, {});

  return {
    subject,
    ...(kind === "manage" && outcome?.process !== undefined
      ? { processIds: [outcome.process.id] }
      : {}),
    kicker: `${KIND_LABEL[kind]} · ${subject}`,
    voice,
    voiceSource,
    ...(restart === undefined ? {} : { phaseOverride: phase, restartProcess: restart }),
    statusWord:
      restartWords?.status ??
      gatedStatusWord(kind, phase, decoded.document !== undefined, call.resultText !== undefined),
    ...(restartWords === undefined
      ? closing !== undefined
        ? { closing }
        : {}
      : { closing: restartWords.text }),
    steps: [
      buildStep(
        kind,
        subject,
        phase === "failed" ? "FAILED" : phase === "done" ? "ACTIVE" : "in_progress",
      ),
    ],
    links: [],
    // The project, a setup block a `.env` is written for, or no name at all is no service to observe.
    ...(named === undefined ? {} : { target: { hostname: named } }),
    ...(envChange !== undefined ? { envChange } : {}),
    hasResult: decoded.document !== undefined,
    ...(restart !== undefined
      ? {}
      : errorInfo !== undefined
        ? explanationField(kind === "env" ? failure : failedCallReason(decoded, errorInfo))
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
  request: "request",
  "generate-dotenv": "dotenv",
};

/**
 * What a `zerops_env` call changes and where, from its input (zcp
 * `internal/tools/env.go`): `project` (zcp's FlexBool: a boolean, or "true"
 * in any case) names the project's variables, else `serviceHostname` a service's;
 * `generate-dotenv` writes a `.env` for its `setup` block. The variables are
 * only counted: their values can be secrets.
 */
function readEnvChange(
  input: Record<string, unknown> | undefined,
  document: Record<string, unknown> | undefined,
): ZeropsEnvChange {
  const asked = ENV_ACTIONS[readInputString(input, "action") ?? ""] ?? "update";
  // A preview writes nothing: it reads what a write would change.
  const action = asked === "dotenv" && readFlexBool(input, "preview") ? "dotenvPreview" : asked;
  const project = readFlexBool(input, "project");
  const service =
    action === "dotenv" || action === "dotenvPreview"
      ? (readInputString(input, "setup") ?? readInputString(input, "serviceHostname"))
      : readInputString(input, "serviceHostname");
  const count = action === "set" || action === "delete" ? variablesCount(input) : undefined;
  const scope = project && asked !== "dotenv" ? "project" : "service";
  const refused = action === "dotenv" ? refusedByHand(document) : undefined;
  const request = action === "request" ? readVaultRequest(input, document) : undefined;
  return {
    action,
    scope,
    ...(scope === "project" || service === undefined ? {} : { service }),
    ...(count === undefined ? {} : { count }),
    ...(refused === undefined ? {} : { refused }),
    ...(request === undefined ? {} : { request }),
  };
}

/**
 * What a request asked for: its key and reason from the input, how it is kept from zcp's answer
 * (`requested`, or `alreadySet` when the key is in that vault) — before it answers, the input's
 * flag, else the name as zcp reads it (`ops.DefaultSensitive`).
 */
function readVaultRequest(
  input: Record<string, unknown> | undefined,
  document: Record<string, unknown> | undefined,
): ZeropsVaultRequest | undefined {
  const key = readInputString(input, "key");
  if (key === undefined) return undefined;
  const already = readObject(document?.alreadySet);
  const answered = already ?? readObject(document?.requested);
  const reason = readInputString(input, "reason");
  const sensitive =
    typeof answered?.sensitive === "boolean"
      ? answered.sensitive
      : input?.sensitive !== undefined
        ? readFlexBool(input, "sensitive")
        : sensitiveByName(key);
  return {
    key,
    sensitive,
    ...(reason === undefined ? {} : { reason }),
    alreadySet: already !== undefined,
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** zcp's `ops.DefaultSensitive`: a name that reads as a secret is kept sensitive. */
const SENSITIVE_NAME = /SECRET|TOKEN|KEY|PASSWORD|PASS|DSN|PRIVATE|CREDENTIAL/u;

function sensitiveByName(key: string): boolean {
  return SENSITIVE_NAME.test(key.toUpperCase());
}

/**
 * A `.env` zcp's safety gate refused to write (`refused`), by how many of its
 * variables nothing sets (`diff.unowned`): set by hand, lost on a write.
 */
function refusedByHand(document: Record<string, unknown> | undefined): number | undefined {
  if (document?.refused !== true) return undefined;
  const diff = document.diff;
  const unowned =
    typeof diff === "object" && diff !== null && !Array.isArray(diff)
      ? (diff as Record<string, unknown>).unowned
      : undefined;
  return Array.isArray(unowned) ? unowned.length : 0;
}

/** zcp's FlexBool (`internal/tools/flexbool.go`): a boolean, or "true" in any case. */
function readFlexBool(input: Record<string, unknown> | undefined, key: string): boolean {
  const value = input?.[key];
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
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

/**
 * An env call's failure in words that never carry an entry it was given:
 * zcp's error for an entry with no "=" repeats it whole
 * (`internal/ops/helpers.go` `parseEnvPairs`), and an agent may pass a bare
 * secret. That error reads as what was wrong; any other line that repeats an
 * entry or its value reads as a refusal.
 */
function envFailureLine(
  line: string,
  document: Record<string, unknown> | undefined,
  input: Record<string, unknown> | undefined,
): string {
  if (readString(document?.code) === "INVALID_ENV_FORMAT") return "An entry wasn't KEY=value";
  const variables = Array.isArray(input?.variables) ? input.variables : [];
  const repeats = variables.some((entry) => {
    if (typeof entry !== "string") return false;
    const value = entry.includes("=") ? entry.slice(entry.indexOf("=") + 1) : entry;
    return (entry.length > 0 && line.includes(entry)) || (value.length > 0 && line.includes(value));
  });
  return repeats ? "Its variables were refused" : line;
}
