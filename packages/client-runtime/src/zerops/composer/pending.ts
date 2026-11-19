import type { ComposerWaits } from "./facts.ts";

interface InputFacts {
  connecting: boolean;
  projectMissing: boolean;
  waits: ComposerWaits;
}

type Refusal = "blocked" | "compressing" | null;

/** Whose words should the editor hold while an ask waits? */
export function editorHolds(waits: ComposerWaits): "nothing" | "answer" | "draft" {
  if (waits.approval) return "nothing";
  return waits.answering ? "answer" : "draft";
}

/** Which waiting ask takes the place above the composer? */
export function composerAsk(input: {
  waits: ComposerWaits;
  vaultDocks: boolean;
  otherDocks: boolean;
}): "approval" | "question" | "vault" | "docked" | null {
  if (input.waits.approval) return "approval";
  if (input.waits.questions) return "question";
  if (input.vaultDocks) return "vault";
  return input.otherDocks ? "docked" : null;
}

/** Is this surface closed to input in the current conversation? */
export function composerInputClosed(surface: "editor" | "paperclip", facts: InputFacts): boolean {
  return (
    facts.connecting ||
    facts.projectMissing ||
    facts.waits.openQuestion === "choice-only" ||
    (surface === "editor" && facts.waits.approval)
  );
}

/** Can the requested insertion into the draft be refused? */
export function insertionRefused(facts: InputFacts): boolean {
  return facts.connecting || facts.waits.approval || facts.waits.questions || facts.projectMissing;
}

/** What prevents a send at the moment it is requested? */
export function sendRefusal(input: {
  providerPicked: boolean;
  sendBlocked: boolean;
  compressing: boolean;
}): Refusal {
  if (!input.providerPicked || input.sendBlocked) return "blocked";
  return input.compressing ? "compressing" : null;
}

/** What prevents compaction at the moment it is requested? */
export function compactRefusal(input: {
  compactDisabled: boolean;
  providerPicked: boolean;
  waits: ComposerWaits;
  running: boolean;
  sendBusy: boolean;
  connecting: boolean;
  threadOpen: boolean;
  compressing: boolean;
}): Refusal {
  if (
    input.compactDisabled ||
    !input.providerPicked ||
    input.waits.approval ||
    input.waits.questions ||
    input.running ||
    input.sendBusy ||
    input.connecting ||
    !input.threadOpen
  )
    return "blocked";
  if (input.compressing) return "compressing";
  return null;
}
