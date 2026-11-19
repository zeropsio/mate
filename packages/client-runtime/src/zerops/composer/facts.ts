/** What waits on the person in this conversation, as the composer is handed it. */
export interface ComposerWaits {
  /** An approval is the ask in front. */
  readonly approval: boolean;
  /** At least one question waits. */
  readonly questions: boolean;
  /** An answer to a question is being written. */
  readonly answering: boolean;
  /** The question open for that answer: none, one that takes the person's own words, or a listed choice only. */
  readonly openQuestion: "none" | "own-words" | "choice-only";
}

/** What the draft carries besides its words, as counts. */
export interface ComposerDraftLoad {
  readonly pictures: number;
  readonly files: number;
  readonly keptAttachments: number;
  readonly terminalContexts: number;
  readonly reviewComments: number;
}
