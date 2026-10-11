import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  UserInputAttachments,
} from "@t3tools/contracts";

/** Which of this area's asks a response answers. */
export type ChatAsk = "approval" | "question" | "other";

/** What the person did, as the Mate received it — never how the wire spells it. */
export type ChatIntent =
  /** A message, with the effort it ran at and whether it asked for a plan, when it did. */
  | {
      readonly kind: "turn";
      readonly text: string;
      readonly effort?: string;
      readonly plan?: true;
    }
  /** How freely the agent works, as the person set it. */
  | { readonly kind: "access"; readonly runtimeMode: string }
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

/** The effort a model selection's options name (`reasoningEffort` or `effort`), if any. */
export const effortOf = (
  options: ReadonlyArray<{ readonly id: string; readonly value: unknown }> | undefined,
): string | undefined => {
  const effort = options?.find(
    (option) => option.id === "reasoningEffort" || option.id === "effort",
  );
  return typeof effort?.value === "string" ? effort.value : undefined;
};
