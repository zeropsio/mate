/** Which primary action stands in the composer's footer? */
export function footerPrimary(input: {
  answering: boolean;
  planFollowUp: boolean;
  draftHasWords: boolean;
  running: boolean;
  sendable: boolean;
}): "answer" | "refine" | "implement" | "send" | "stop" | "stop-and-send" {
  if (input.answering) return "answer";
  if (input.planFollowUp) return input.draftHasWords ? "refine" : "implement";
  if (!input.running) return "send";
  return input.sendable ? "stop-and-send" : "stop";
}

/** Is the answer's submit held? */
export function answerHeld(input: {
  unavailable: boolean;
  responding: boolean;
  lastQuestion: boolean;
  complete: boolean;
  canAdvance: boolean;
}): boolean {
  const unanswered = input.lastQuestion ? !input.complete : !input.canAdvance;
  return input.unavailable || input.responding || unanswered;
}

/** Is a send, or a plan's refine or implement, held whatever the draft holds? */
export function sendHeld(input: {
  busy: boolean;
  blocked: boolean;
  connecting: boolean;
  unavailable: boolean;
}): boolean {
  return input.busy || input.blocked || input.connecting || input.unavailable;
}

/** What does Send say of itself where no reason blocks it? */
export function sendSays(input: {
  unavailable: boolean;
  connecting: boolean;
  preparing: boolean;
  busy: boolean;
  running: boolean;
}): "unavailable" | "connecting" | "preparing" | "sending" | "queue" | "send" {
  if (input.unavailable) return "unavailable";
  if (input.connecting) return "connecting";
  if (input.preparing) return "preparing";
  if (input.busy) return "sending";
  return input.running ? "queue" : "send";
}
