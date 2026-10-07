import type { OperationKind } from "./kind.ts";

export interface SentAsk {
  readonly messageId: string;
  readonly threadId: string;
  readonly text: string;
  readonly at: string;
}
declare module "../model.ts" {
  interface OperationIntents {
    readonly "mate-send-turn": SentAsk & { readonly environmentId: string };
  }
}
export const mateSendTurn: OperationKind<"mate-send-turn"> = {
  kind: "mate-send-turn",
  executor: "mate",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
