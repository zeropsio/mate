import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  UserInputAttachments,
} from "@t3tools/contracts";

/** Which of this area's asks a response answers. */
export type ChatAsk = "approval" | "question" | "other";

/** What the person did, as the Mate received it — never how a wire spells it. */
export type ChatIntent =
  /** A message, with the effort it ran at and whether it asked for a plan, when it did. */
  | {
      readonly kind: "turn";
      readonly text: string;
      readonly effort?: string;
      readonly plan?: true;
    }
  | {
      readonly kind: "decision";
      readonly ask: ChatAsk;
      readonly decision: ProviderApprovalDecision;
    }
  | {
      readonly kind: "answer";
      readonly ask: ChatAsk;
      readonly requestId: string;
      readonly answers: ProviderUserInputAnswers;
      readonly attachmentsByQuestionId?: UserInputAttachments;
    };

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
  /** The person said `text`, in run `turnId` when given; that exchange is over. */
  history(text: string, turnId?: string | null): void;
  /** The agent waits on approval to run `vp run build`; a response gets RESPONSE_RECEIVED. */
  approval(): void;
  /** The agent asks TARGET_QUESTION as `requestId`, in run `turnId` when given; same reply. */
  question(requestId?: string, turnId?: string | null): void;
  /** The agent works in run `turnId`, or that run ends as `state` says. */
  run(turnId: string, state: "running" | "completed" | "error" | "interrupted"): void;
  /** Every intent the Mate applied, in order. */
  intents(): ReadonlyArray<ChatIntent>;
  /** Settles once the conversation durably holds a person message reading exactly `text`. */
  waitForMessage(text: string): Promise<void>;
}

/** The effort a model selection's options name (`reasoningEffort` or `effort`), if any. */
export const effortOf = (
  options: ReadonlyArray<{ readonly id: string; readonly value: unknown }> | undefined,
): string | undefined => {
  const effort = options?.find(
    (option) => option.id === "reasoningEffort" || option.id === "effort",
  );
  return typeof effort?.value === "string" ? effort.value : undefined;
};
