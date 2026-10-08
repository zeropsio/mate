/**
 * Test helpers for the pump: one line per thing `toCore` gave the engine, so a test pins what the
 * engine takes from a driver as sentences.
 */
import type { ProviderSignal } from "../../domain/command.ts";
import type { CoreStep } from "../../pump/toCore.ts";

const bodyLine = (body: Extract<ProviderSignal, { kind: "item-opened" }>["body"]): string => {
  switch (body.kind) {
    case "note":
      return body.text === "" ? "note" : `note "${body.text.slice(0, 40)}"`;
    case "thought":
      return `thought of ${body.length}`;
    case "call":
      return `call ${body.step} ${body.tool.name} ${body.state}`;
    case "marker":
      return `marker ${body.marker.kind}`;
    default:
      return body.kind;
  }
};

export function coreLine(signal: ProviderSignal): string {
  switch (signal.kind) {
    case "turn-started":
      return `${signal.turn} started by ${signal.origin}${signal.reportsOn ? `, reports on ${signal.reportsOn}` : ""}`;
    case "turn-ended":
      return `${signal.turn} ended ${signal.outcome.kind} — ${signal.source}`;
    case "item-opened":
    case "item-updated":
    case "item-closed":
      return `${signal.key} ${signal.kind.slice(5)}: ${bodyLine(signal.body)}${signal.afterEnd ? ", after end" : ""}`;
    case "request-opened":
      return `${signal.key} asks ${signal.ask.kind}${signal.turn === undefined ? "" : ` in ${signal.turn}`}${signal.item === undefined ? "" : `, by ${signal.item}`}`;
    case "request-closed":
      return `${signal.key} ${signal.state}`;
    case "work-upserted":
      return `${signal.work} ${signal.workKind} ${signal.status}`;
    case "usage-limit":
      return `usage limit${signal.turn === undefined ? "" : ` on ${signal.turn}`} until ${signal.resetsAt ?? "unknown"}${signal.parks ? ", parked" : ""}`;
    case "usage-reset-known":
      return `usage resets at ${signal.resetsAt}`;
    case "session-exited":
      return `session exited: ${signal.reason}`;
    case "activity":
      return `${signal.turn} alive`;
  }
}

/** Every line one step gave: its boundaries, then the evidence a send waits on. */
export function stepLines(step: CoreStep): ReadonlyArray<string> {
  return [
    ...step.signals.map(coreLine),
    ...step.evidence.map(({ turn, evidence }) =>
      evidence._tag === "Accepted"
        ? `${turn} taken: ${evidence.as}`
        : evidence._tag === "Refused"
          ? `${turn} refused, undelivered: ${String(evidence.undelivered)}`
          : `${turn} closed`,
    ),
  ];
}
