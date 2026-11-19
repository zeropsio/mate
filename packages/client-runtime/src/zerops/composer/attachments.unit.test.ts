import { expect, it } from "vite-plus/test";
import { attachmentDestination, attachmentRefusal, attachmentSendBlock } from "./attachments.ts";
import type { ComposerWaits } from "./facts.ts";

const noWaits: ComposerWaits = {
  approval: false,
  questions: false,
  answering: false,
  openQuestion: "none",
};

// witness: packages/client-runtime/src/zerops/composer/attachments.ts | facts.waits.questions → facts.waits.answering
it("CP22: While a question waits, a picture is not added to the draft message", () => {
  expect(
    attachmentRefusal("picture", {
      waits: { ...noWaits, questions: true },
      uploads: { known: true, supported: true },
    }),
  ).toBe("question-waits");
});

// witness: packages/client-runtime/src/zerops/composer/attachments.ts | kind === "file" && facts.uploads.known → facts.uploads.known
it("CP23: A Mate that takes no files still takes a picture", () => {
  expect(
    attachmentRefusal("picture", { waits: noWaits, uploads: { known: true, supported: false } }),
  ).toBeNull();
});

// witness: packages/client-runtime/src/zerops/composer/attachments.ts | facts.uploads.known && !facts.uploads.supported → !facts.uploads.supported
it("CP24: A file is refused on a Mate known to take no files, and not before the Mate has said whether it takes them", () => {
  expect(
    attachmentRefusal("file", { waits: noWaits, uploads: { known: true, supported: false } }),
  ).toBe("no-file-support");
  expect(
    attachmentRefusal("file", { waits: noWaits, uploads: { known: false, supported: false } }),
  ).toBeNull();
});

// witness: packages/client-runtime/src/zerops/composer/attachments.ts | (input.uploadsSupported ? input.uploadBlock : null) → input.uploadBlock
it("CP25: On a Mate that takes no uploads an upload's state never holds the send, while a picture still preparing does", () => {
  const upload = { picturesBlock: null, uploadsSupported: false, uploadBlock: "upload" };
  expect(attachmentSendBlock(upload)).toBeNull();
  expect(attachmentSendBlock({ ...upload, picturesBlock: "preparing" })).toBe("preparing");
  expect(attachmentSendBlock({ ...upload, uploadsSupported: true })).toBe("upload");
});

// witness: packages/client-runtime/src/zerops/composer/attachments.ts | return "answer"; → return "message";
it("CP26: A file attached while a question takes an answer in the person's own words goes with the answer, not into the draft message", () => {
  expect(
    attachmentDestination({
      ...noWaits,
      questions: true,
      answering: true,
      openQuestion: "own-words",
    }),
  ).toBe("answer");
  expect(attachmentDestination(noWaits)).toBe("message");
});

// witness: packages/client-runtime/src/zerops/composer/attachments.ts | return "nowhere"; → return "answer";
it("CP27: A file attached while a question takes only a listed choice goes nowhere", () => {
  expect(
    attachmentDestination({
      ...noWaits,
      questions: true,
      answering: true,
      openQuestion: "choice-only",
    }),
  ).toBe("nowhere");
});
