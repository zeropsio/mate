import { NO_RESTARTS, readRestart, restartReadout } from "../../../data/projections/restart.ts";
/**
 * delete / scale / manage / env — no `payloads.ts` card, just a message
 * document plus the process outcome `decodeProcessOutcome` reads off it.
 */
import { readString } from "../../cards/decode.ts";
import { decodeProcessOutcome, type ZeropsProcessOutcome } from "../../cards/payloads.ts";
import { envChangeWords, operationClosing } from "../../operations/phrases.ts";
import { isEnvironmentSecretAsk } from "../classify.ts";
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
  const envChange =
    kind !== "env"
      ? undefined
      : isEnvironmentSecretAsk(call.toolName, call.input)
        ? readEnvironmentSecretAsk(call.input, decoded.document)
        : readEnvChange(call.input, decoded.document);
  // The service it names, the one it observes: none where it names none, and none for the Mate's
  // own vault, whose container is nothing a person is shown.
  const named =
    envChange === undefined
      ? readSimpleSubject(call.input, decoded.document)
      : envChange.scope === "service" &&
          envChange.mate !== true &&
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
        : envChange?.mate === true
          ? "its own vault"
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
  // Mobile later: native still supplies tool results, without account observation demand.
  const reading =
    returnedRestart === undefined
      ? undefined
      : (context?.restarts?.(returnedRestart) ?? readRestart(NO_RESTARTS, returnedRestart));
  const restart = reading?.process;
  const phase = reading?.phase ?? callPhase;
  const restartWords =
    reading === undefined ? undefined : restartReadout(reading, named ?? subject, NaN);
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
    ...(restart !== undefined ? { processIds: [restart.id] } : {}),
    kicker: `${KIND_LABEL[kind]} · ${subject}`,
    voice,
    voiceSource,
    ...(restart === undefined
      ? {}
      : {
          phaseOverride: phase,
          ...(reading === undefined ? {} : { restartReading: reading }),
        }),
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
        phase === "failed"
          ? "FAILED"
          : phase === "done"
            ? "ACTIVE"
            : phase === "uncertain"
              ? "waiting"
              : "in_progress",
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
 * in any case) names the project's variables, `mate` (a FlexBool too) the Mate's
 * own vault, else `serviceHostname` a service's; `generate-dotenv` writes a `.env`
 * for its `setup` block. An input that names no service (`mate`: zcp resolves its
 * own) takes the one zcp's answer names. The variables are only counted: their
 * values can be secrets.
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
      : (readInputString(input, "serviceHostname") ?? answeredService(document));
  const count = action === "set" || action === "delete" ? variablesCount(input) : undefined;
  const scope = project && asked !== "dotenv" ? "project" : "service";
  const mate = scope === "service" && asked !== "dotenv" && readFlexBool(input, "mate");
  const refused = action === "dotenv" ? refusedByHand(document) : undefined;
  const request = action === "request" ? readVaultRequest(input, document) : undefined;
  return {
    action,
    scope,
    ...(scope === "project" || service === undefined ? {} : { service }),
    ...(mate ? { mate } : {}),
    ...(count === undefined ? {} : { count }),
    ...(refused === undefined ? {} : { refused }),
    ...(request === undefined ? {} : { request }),
  };
}

/**
 * The service zcp's answer says a call went to: a request's (`requested`, or `alreadySet`), else
 * the answer's own (`set`, `delete`). None before it answers.
 */
function answeredService(document: Record<string, unknown> | undefined): string | undefined {
  return (
    readString(readObject(document?.requested)?.serviceHostname) ??
    readString(readObject(document?.alreadySet)?.serviceHostname) ??
    readString(document?.serviceHostname)
  );
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
  // `why` from a zcp that names the value for people, `reason` from one before it.
  const reason = readInputString(input, "why") ?? readInputString(input, "reason");
  const label = readInputString(input, "label");
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
    ...(label === undefined ? {} : { label }),
    alreadySet: already !== undefined,
  };
}

/**
 * A secret asked for in the application's stage or production (`zerops_propose_env secret=true`):
 * a request like `zerops_env`'s, its key and vault from the input (`scope`, `service`), always
 * hidden, and from zcp's answer the environment it goes to and the services the card restarts.
 */
function readEnvironmentSecretAsk(
  input: Record<string, unknown> | undefined,
  document: Record<string, unknown> | undefined,
): ZeropsEnvChange {
  // Trimmed as zcp trims them, so the card matches the engine's record of the ask.
  const service = readInputString(input, "service")?.trim() || undefined;
  const scope = readInputString(input, "scope")?.trim() === "service" ? "service" : "project";
  const key = readInputString(input, "key")?.trim() || undefined;
  const answered = readObject(document?.requested);
  const reason = readInputString(input, "reason");
  const label =
    typeof answered?.label === "string" && answered.label !== "" ? answered.label : undefined;
  const environment = readEnvironment(answered?.environment);
  const generate =
    typeof answered?.generate === "string" && answered.generate !== ""
      ? answered.generate
      : undefined;
  const restart = Array.isArray(answered?.restart)
    ? answered.restart.flatMap((entry: unknown) => {
        const service = readObject(entry);
        return typeof service?.serviceId === "string" && typeof service.hostname === "string"
          ? [{ serviceId: service.serviceId, hostname: service.hostname }]
          : [];
      })
    : [];
  return {
    action: "request",
    scope,
    ...(scope === "project" || service === undefined ? {} : { service }),
    ...(key === undefined
      ? {}
      : {
          request: {
            key,
            sensitive: true,
            ...(reason === undefined ? {} : { reason }),
            ...(label === undefined ? {} : { label }),
            alreadySet: false,
            ...(environment === undefined ? {} : { environment }),
            ...(restart.length === 0 ? {} : { restart }),
            ...(generate === undefined ? {} : { generate }),
          },
        }),
  };
}

function readEnvironment(value: unknown): ZeropsVaultRequest["environment"] {
  const environment = readObject(value);
  const kind = environment?.kind;
  return (kind === "stage" || kind === "production") &&
    typeof environment?.projectId === "string" &&
    typeof environment.name === "string"
    ? { kind, projectId: environment.projectId, name: environment.name }
    : undefined;
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
