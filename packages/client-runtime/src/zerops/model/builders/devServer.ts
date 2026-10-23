import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { operationClosing, sentenceCase } from "../../operations/phrases.ts";
import type { ZeropsCall, ZeropsOperationStep } from "../types.ts";
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
 * reporting `running=false` is the step succeeding, not failing. A log read
 * checks nothing, so it succeeds by returning, whatever `running` says.
 */
function devServerStepSucceeded(action: string, running: boolean): boolean {
  if (action === "logs") return true;
  return action === "stop" ? !running : running;
}

/** What a dev server's row says of the supervisor's state: its step state and word. */
const SERVER_STATES: Readonly<
  Record<string, { readonly state: ZeropsOperationStep["state"]; readonly word: string }>
> = {
  running: { state: "done", word: "Running" },
  starting: { state: "running", word: "Starting" },
  crashed: { state: "failed", word: "Crashed" },
  stopped: { state: "queued", word: "Stopped" },
};

/** `21:04`, in the reader's own clock; nothing for a time it cannot read. */
function clockOf(iso: string): string | undefined {
  const at = DateTime.make(iso);
  if (Option.isNone(at)) return undefined;
  const { hour, minute } = DateTime.toParts(DateTime.setZone(at.value, DateTime.zoneMakeLocal()));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

type DevServer = NonNullable<Extract<ZeropsCardPayload, { kind: "devServer" }>["servers"]>[number];

/** `web :3000`, or `worker` for a server without a port. */
const serverLabel = (server: DevServer) =>
  server.port === undefined ? server.name : `${server.name} :${String(server.port)}`;

/**
 * One row per named server: its last known state, and when zcp read it — a server that falls
 * over between calls shows here only after the agent's next call (MODEL §6), so the time says how
 * old the word is.
 */
function serverStep(server: DevServer): ZeropsOperationStep {
  const known = SERVER_STATES[server.status];
  const exit = server.lastExit;
  const exitClock = exit === undefined ? undefined : clockOf(exit.at);
  const why =
    server.status === "running"
      ? server.verify?.httpStatus === undefined
        ? undefined
        : `HTTP ${String(server.verify.httpStatus)}`
      : exit === undefined
        ? undefined
        : [
            exit.code !== undefined
              ? `exit ${String(exit.code)}`
              : exit.signal !== undefined
                ? exit.signal
                : "exited",
            exitClock === undefined ? undefined : `at ${exitClock}`,
          ]
            .filter((word) => word !== undefined)
            .join(" ");
  const read = clockOf(server.readAt);
  const note = [why, read === undefined ? undefined : `read ${read}`]
    .filter((word) => word !== undefined)
    .join(" · ");
  return {
    id: `dev-server:${server.name}`,
    label: serverLabel(server),
    state: known?.state ?? "queued",
    stateLabel: known?.word ?? sentenceCase(server.status),
    ...(note.length > 0 ? { note } : {}),
  };
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
    card?.servers !== undefined
      ? card.servers.map(serverStep)
      : card !== undefined
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
    // The service's subdomain URL is not part of this result — it comes from the
    // client's own topology view as a prop the timeline supplies, never baked
    // into the operation here. Several named servers each bring their own
    // port's address, as zcp read it from Zerops in this call; a lease, in no
    // topology view, opens the address zcp read on its one server, as a
    // service's card opens the view's.
    links:
      card?.leaseUrl !== undefined
        ? [{ label: "Open", url: card.leaseUrl }]
        : (card?.servers ?? []).flatMap((server) =>
            server.url === undefined ? [] : [{ label: serverLabel(server), url: server.url }],
          ),
    target: { hostname: subject },
    ...(phase === "failed" && decoded.document?.code === "INVALID_PARAMETER"
      ? { refused: true as const }
      : {}),
    hasResult: decoded.document !== undefined,
  };
}
