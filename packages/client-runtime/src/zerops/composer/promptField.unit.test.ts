import { expect, it } from "vite-plus/test";
import type { ComposerWaits } from "./facts.ts";
import { promptFieldCarriesDraft, promptFieldSays } from "./promptField.ts";

const W0: ComposerWaits = {
  approval: false,
  questions: false,
  answering: false,
  openQuestion: "none",
};
const CLEAR = {
  waits: W0,
  planFollowUp: false,
  projectMissing: false,
  signInRequired: false,
  providerUnavailable: false,
  disconnected: false,
};

// witness: packages/client-runtime/src/zerops/composer/promptField.ts | return !waits.approval && !waits.questions; → return !waits.approval;
it("CP33: While an approval or a question waits, the prompt field shows none of the draft's pictures, files or terminal contexts", () => {
  expect(promptFieldCarriesDraft(W0)).toBe(true);
  expect(promptFieldCarriesDraft({ ...W0, approval: true })).toBe(false);
  expect(promptFieldCarriesDraft({ ...W0, questions: true })).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/promptField.ts | if (waits.approval) return "approval"; → if (waits.approval && !waits.answering) return "approval";
it("CP34: An approval is what the empty prompt field speaks of, even where a question's answer is also being written", () => {
  expect(
    promptFieldSays({
      ...CLEAR,
      waits: { approval: true, questions: true, answering: true, openQuestion: "own-words" },
    }),
  ).toBe("approval");
});

// witness: packages/client-runtime/src/zerops/composer/promptField.ts | waits.openQuestion === "choice-only" ? → waits.openQuestion === "own-words" ?
it("CP35: A question that takes only a listed choice has the empty prompt field point at the choices; any other asks for the person's own answer", () => {
  expect(
    promptFieldSays({
      ...CLEAR,
      waits: { ...W0, questions: true, answering: true, openQuestion: "choice-only" },
    }),
  ).toBe("choose-option");
  expect(
    promptFieldSays({
      ...CLEAR,
      waits: { ...W0, questions: true, answering: true, openQuestion: "own-words" },
    }),
  ).toBe("own-answer");
});

// witness: packages/client-runtime/src/zerops/composer/promptField.ts | if (input.signInRequired) return → if (input.signInRequired && !input.providerUnavailable) return
it("CP36: A Mate that must be signed in is what the empty prompt field says before a missing provider", () => {
  expect(promptFieldSays({ ...CLEAR, signInRequired: true, providerUnavailable: true })).toBe(
    "sign-in",
  );
  expect(promptFieldSays({ ...CLEAR, providerUnavailable: true })).toBe("enable-provider");
});

// witness: packages/client-runtime/src/zerops/composer/promptField.ts | input.disconnected ? "idle" : "connected" → input.disconnected ? "connected" : "idle"
it("CP37: With nothing in the way the empty prompt field invites a message, in the disconnected words only while the Mate is disconnected", () => {
  expect(promptFieldSays({ ...CLEAR, disconnected: true })).toBe("idle");
  expect(promptFieldSays(CLEAR)).toBe("connected");
});
