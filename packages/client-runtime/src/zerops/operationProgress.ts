/** Where one operation stands, as the person sees it: the stages `data/projections/operation.ts`
 * derives from an operation's record and its owner's receipt. */
import type { HqProblem } from "@t3tools/shared/hqProblems";

export type OperationProgress =
  | { readonly stage: "unknown" }
  | { readonly stage: "submitting" }
  | {
      readonly stage: "unsent";
      readonly next: "send-again";
      /** What its owner, or the door before it, said of why it was not taken. */
      readonly reason?: string;
    }
  | { readonly stage: "uncertain"; readonly next: "asking-owner" | "ask-owner-again" }
  | {
      readonly stage: "refused";
      readonly problems?: ReadonlyArray<HqProblem>;
      readonly reason: string;
      /** The owner's own code for it (`userDataDuplicateKey`), where it named one. */
      readonly code?: string;
    }
  | { readonly stage: "accepted" | "reflected"; readonly operationId: string }
  | {
      readonly stage: "done";
      readonly operationId: string;
      readonly outcome: "succeeded" | "failed" | "cancelled";
      /** Why, where the owner's facts said it failed. */
      readonly reason?: string;
    }
  | {
      readonly stage: "unresolved";
      readonly operationId: string | null;
      readonly nextActor: string;
      /** What the owner named as the next step, where it named one. */
      readonly nextAction?: string;
      /** Why the owner stopped there, where it said. */
      readonly reason?: string;
    };
