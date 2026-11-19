import { expect, it } from "vite-plus/test";
import {
  compactRefusal,
  composerAsk,
  composerInputClosed,
  editorHolds,
  insertionRefused,
  sendRefusal,
} from "./pending.ts";

const noWaits = {
  approval: false,
  questions: false,
  answering: false,
  openQuestion: "none",
} as const;

// witness: packages/client-runtime/src/zerops/composer/pending.ts | if (waits.approval) → if (!waits.approval)
it("CP16: Under an approval the editor holds nothing and under a question it holds the answer, never the draft's words", () => {
  expect(editorHolds({ ...noWaits, approval: true, answering: true })).toBe("nothing");
  expect(editorHolds({ ...noWaits, answering: true })).toBe("answer");
  expect(editorHolds(noWaits)).toBe("draft");
});

// witness: packages/client-runtime/src/zerops/composer/pending.ts | if (input.vaultDocks) → if (input.vaultDocks && !input.otherDocks)
it("CP17: One ask at a time: a value the Mate asked for does not dock while an approval or a question waits, and another docked ask stands only when no value does", () => {
  const input = { waits: noWaits, vaultDocks: true, otherDocks: true };
  expect(composerAsk(input)).toBe("vault");
  expect(composerAsk({ ...input, waits: { ...noWaits, questions: true } })).toBe("question");
  expect(composerAsk({ ...input, waits: { ...noWaits, approval: true, questions: true } })).toBe(
    "approval",
  );
  expect(composerAsk({ ...input, vaultDocks: false })).toBe("docked");
  expect(composerAsk({ ...input, vaultDocks: false, otherDocks: false })).toBeNull();
});

// witness: packages/client-runtime/src/zerops/composer/pending.ts | facts.waits.openQuestion === "choice-only" → facts.waits.openQuestion === "own-words"
it("CP18: A question that takes only a listed choice closes the editor and the paperclip; one that takes the person's own words closes neither", () => {
  const choice = {
    connecting: false,
    projectMissing: false,
    waits: { ...noWaits, openQuestion: "choice-only" },
  } as const;
  const words = { ...choice, waits: { ...noWaits, openQuestion: "own-words" } } as const;
  expect(composerInputClosed("editor", choice)).toBe(true);
  expect(composerInputClosed("paperclip", choice)).toBe(true);
  expect(composerInputClosed("editor", words)).toBe(false);
  expect(composerInputClosed("paperclip", words)).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/pending.ts | facts.waits.questions || facts.projectMissing → facts.projectMissing
it("CP19: Text is not inserted into the draft while an approval or a question waits", () => {
  const facts = { connecting: false, projectMissing: false, waits: noWaits };
  expect(insertionRefused({ ...facts, waits: { ...noWaits, questions: true } })).toBe(true);
  expect(insertionRefused({ ...facts, waits: { ...noWaits, approval: true } })).toBe(true);
  expect(insertionRefused(facts)).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/pending.ts | return input.compressing ? → return !input.compressing ?
it("CP20: A send while a pasted image is still compressing is refused and says so; a held send is refused without that word", () => {
  const input = { providerPicked: true, sendBlocked: false, compressing: true };
  expect(sendRefusal(input)).toBe("compressing");
  expect(sendRefusal({ ...input, sendBlocked: true })).toBe("blocked");
  expect(sendRefusal({ ...input, providerPicked: false, compressing: false })).toBe("blocked");
  expect(sendRefusal({ ...input, compressing: false })).toBeNull();
});

// witness: packages/client-runtime/src/zerops/composer/pending.ts | input.running || → false ||
it("CP21: Compaction is refused while a question or an approval waits or the Mate's turn runs", () => {
  const clear = {
    compactDisabled: false,
    providerPicked: true,
    waits: noWaits,
    running: false,
    sendBusy: false,
    connecting: false,
    threadOpen: true,
    compressing: false,
  };
  expect(compactRefusal(clear)).toBeNull();
  expect(compactRefusal({ ...clear, waits: { ...noWaits, questions: true } })).toBe("blocked");
  expect(compactRefusal({ ...clear, waits: { ...noWaits, approval: true } })).toBe("blocked");
  expect(compactRefusal({ ...clear, running: true })).toBe("blocked");
  expect(compactRefusal({ ...clear, compressing: true })).toBe("compressing");
});
