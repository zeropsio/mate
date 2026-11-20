import { expect, it } from "vite-plus/test";
import { answerHeld, footerPrimary, sendHeld, sendSays } from "./footerActions.ts";

const IDLE = {
  answering: false,
  planFollowUp: false,
  draftHasWords: false,
  running: false,
  sendable: false,
};
const READY = {
  unavailable: false,
  responding: false,
  lastQuestion: true,
  complete: true,
  canAdvance: true,
};
const OPEN = { busy: false, blocked: false, connecting: false, unavailable: false };
const PLAIN = {
  unavailable: false,
  connecting: false,
  preparing: false,
  busy: false,
  running: false,
};

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | if (input.answering) return "answer"; → if (input.answering && !input.running) return "answer";
it("CP38: A waiting question's answer is the footer's action even while the Mate's turn runs", () => {
  expect(footerPrimary({ ...IDLE, answering: true, running: true })).toBe("answer");
});

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | input.draftHasWords ? "refine" : "implement" → input.draftHasWords ? "implement" : "refine"
it("CP39: A settled plan is refined when the person wrote words and implemented when they wrote none", () => {
  expect(footerPrimary({ ...IDLE, planFollowUp: true, draftHasWords: true })).toBe("refine");
  expect(footerPrimary({ ...IDLE, planFollowUp: true })).toBe("implement");
});

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | input.sendable ? "stop-and-send" : "stop" → input.sendable ? "stop" : "stop-and-send"
it("CP40: While the Mate's turn runs Stop stands in the footer, and Send beside it only when the draft has something to send", () => {
  expect(footerPrimary({ ...IDLE, running: true })).toBe("stop");
  expect(footerPrimary({ ...IDLE, running: true, sendable: true })).toBe("stop-and-send");
  expect(footerPrimary(IDLE)).toBe("send");
});

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | input.lastQuestion ? !input.complete : !input.canAdvance → input.lastQuestion ? !input.canAdvance : !input.complete
it("CP41: The last question's answer is held until every question is answered, an earlier one's until it can advance", () => {
  expect(answerHeld({ ...READY, lastQuestion: true, complete: false, canAdvance: true })).toBe(
    true,
  );
  expect(answerHeld({ ...READY, lastQuestion: true, complete: true, canAdvance: false })).toBe(
    false,
  );
  expect(answerHeld({ ...READY, lastQuestion: false, complete: true, canAdvance: false })).toBe(
    true,
  );
  expect(answerHeld({ ...READY, lastQuestion: false, complete: false, canAdvance: true })).toBe(
    false,
  );
});

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | input.unavailable || input.responding || unanswered → input.unavailable || unanswered
it("CP42: An answer that is being submitted cannot be submitted a second time", () => {
  expect(answerHeld({ ...READY, responding: true })).toBe(true);
  expect(answerHeld(READY)).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | input.busy || input.blocked || input.connecting → input.blocked || input.connecting
it("CP43: A send is held while another is on its way, while a reason blocks it, while the Mate connects and while the environment is away", () => {
  expect(sendHeld({ ...OPEN, busy: true })).toBe(true);
  expect(sendHeld({ ...OPEN, blocked: true })).toBe(true);
  expect(sendHeld({ ...OPEN, connecting: true })).toBe(true);
  expect(sendHeld({ ...OPEN, unavailable: true })).toBe(true);
  expect(sendHeld(OPEN)).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/footerActions.ts | input.running ? "queue" : "send" → input.running ? "send" : "queue"
it("CP44: While the Mate's turn runs Send says it queues the message, and a send already on its way says so first", () => {
  expect(sendSays({ ...PLAIN, running: true })).toBe("queue");
  expect(sendSays({ ...PLAIN, busy: true, running: true })).toBe("sending");
  expect(sendSays(PLAIN)).toBe("send");
});
