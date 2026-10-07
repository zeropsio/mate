import type { ProviderApprovalDecision, ProviderUserInputAnswers } from "@t3tools/contracts";

/** Which of this area's asks a response answers. */
export type ChatAsk = "approval" | "question" | "other";

/** What the person did, as the Mate received it — never how a wire spells it. */
export type ChatIntent =
  | { readonly kind: "turn"; readonly text: string }
  | {
      readonly kind: "decision";
      readonly ask: ChatAsk;
      readonly decision: ProviderApprovalDecision;
    }
  | { readonly kind: "answer"; readonly ask: ChatAsk; readonly answers: ProviderUserInputAnswers };

/** The reply the Mate gives once the person answers an ask. */
export const RESPONSE_RECEIVED = "Agent received your response";

/** The agent's question: which environment to inspect. */
export const TARGET_QUESTION = {
  id: "target",
  header: "Target",
  question: "Which environment should I inspect?",
  options: [
    { label: "Staging", value: "stage", description: "Inspect the staging environment" },
    {
      label: "Production",
      value: "production",
      description: "Inspect the live environment",
    },
  ],
  multiSelect: false,
  allowCustomAnswer: true,
} as const;

/** One Mate's conversation on one wire: what a journey arranges, what the Mate applied. */
export interface ChatWire {
  readonly name: "v1" | "engine";
  /** The person said `text`; that exchange is over. */
  history(text: string): void;
  /** The agent waits on approval to run `vp run build`; a response gets RESPONSE_RECEIVED. */
  approval(): void;
  /** The agent asks TARGET_QUESTION; a response gets RESPONSE_RECEIVED. */
  question(): void;
  /** Every intent the Mate applied, in order. */
  intents(): ReadonlyArray<ChatIntent>;
  /** Settles once the conversation durably holds a person message reading exactly `text`. */
  waitForMessage(text: string): Promise<void>;
}
