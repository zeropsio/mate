import { operationClosing, sentenceCase } from "../../operations/phrases.ts";
import type { ZeropsCall } from "../types.ts";
import type { ZeropsCardPayload } from "../../cards/payloads.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  errorInfoFor,
  explanationField,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  pickFirst,
  readInputString,
} from "./shared.ts";

/** Humanizes `reason` (e.g. `health_probe_timeout`) into "Health probe timeout". */
function devServerStepNote(
  card: Extract<ZeropsCardPayload, { kind: "devServer" }>,
): string | undefined {
  if (card.reason !== undefined) {
    return sentenceCase(card.reason);
  }
  if (card.healthStatus !== undefined) {
    return `HTTP ${card.healthStatus}`;
  }
  return undefined;
}

const DEV_SERVER_STEP_LABEL: Readonly<Record<string, string>> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  status: "Health check",
  logs: "Logs",
};

/**
 * The one step's PASS/FAIL goal depends on the action: start/restart/status
 * want `running=true`, stop wants `running=false` — a successful stop
 * reporting `running=false` is the step succeeding, not failing.
 */
function devServerStepSucceeded(action: string, running: boolean): boolean {
  return action === "stop" ? !running : running;
}

export function buildDevServerFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "devServer" ? decoded.card : undefined;
  const phase = phaseFor(call.status);
  const subject =
    pickFirst(readInputString(call.input, "hostname"), card?.hostname) ?? "the dev server";
  const action = pickFirst(readInputString(call.input, "action"), card?.action) ?? "start";
  const { voice, voiceSource } = mateVoiceFor("devServer", subject);

  const steps =
    card !== undefined
      ? [
          buildStep(
            "dev-server",
            DEV_SERVER_STEP_LABEL[card.action] ?? sentenceCase(card.action),
            devServerStepSucceeded(card.action, card.running) ? "ACTIVE" : "FAILED",
            devServerStepNote(card),
          ),
        ]
      : [];

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("devServer", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? card !== undefined
            ? operationClosing("devServer", "done", {
                hostname: card.hostname,
                port: card.port,
                running: card.running,
                action: card.action,
              })
            : "Finished."
          : operationClosing("devServer", phase, {});

  return {
    subject,
    kicker: `${KIND_LABEL.devServer} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "devServer",
      phase,
      card !== undefined,
      call.resultText !== undefined,
      {
        running: card?.running,
        action,
      },
    ),
    ...(closing !== undefined ? { closing } : {}),
    // A server that did not come up says what its log said: the person reads
    // the crash, not a hint to the agent.
    ...(card !== undefined && !devServerStepSucceeded(card.action, card.running)
      ? explanationField(
          devServerStepNote(card) ?? `${card.hostname} did not come up`,
          card.logTail
            ?.split("\n")
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0),
        )
      : {}),
    steps,
    // The subdomain URL is not part of this result — it comes from the
    // client's own topology view as a prop the timeline supplies, never
    // baked into the operation here.
    links: [],
    target: { hostname: subject },
    hasResult: decoded.document !== undefined,
  };
}
