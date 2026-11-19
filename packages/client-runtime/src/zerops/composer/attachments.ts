import type { ComposerWaits } from "./facts.ts";

/** What prevents adding this attachment to the draft? */
export function attachmentRefusal(
  kind: "picture" | "file",
  facts: { waits: ComposerWaits; uploads: { known: boolean; supported: boolean } },
): "question-waits" | "no-file-support" | null {
  if (facts.waits.questions) return "question-waits";
  if (kind === "file" && facts.uploads.known && !facts.uploads.supported) return "no-file-support";
  return null;
}

/** Which attachment holds the send while its picture or upload is preparing? */
export function attachmentSendBlock<R>(input: {
  picturesBlock: R | null;
  uploadsSupported: boolean;
  uploadBlock: R | null;
}): R | null {
  return input.picturesBlock ?? (input.uploadsSupported ? input.uploadBlock : null);
}

/** Where does a file picked or pasted into the composer go? */
export function attachmentDestination(waits: ComposerWaits): "answer" | "message" | "nowhere" {
  switch (waits.openQuestion) {
    case "own-words":
      return "answer";
    case "choice-only":
      return "nowhere";
    case "none":
      return "message";
  }
}
