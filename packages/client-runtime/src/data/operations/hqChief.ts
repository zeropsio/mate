/**
 * The organisation's Chief mark and the decisions on its proposals, as HQ records them
 * (`zerops/hq/chief.ts`): the mark set on a project, and one decision on a proposal. HQ answers
 * each at once and keeps no request id for it, so a lost answer stays uncertain and is never sent
 * again blindly — the mark is asked for again by the person (a second sets the same mark), and a
 * decision is written once: a second is HQ's conflict.
 *
 * @module data/operations/hqChief
 */
import type {
  HqChief,
  HqProposalDecision,
  HqProposalDecisionWrite,
} from "../../zerops/hq/chief.ts";
import type { OperationIntent, OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-chief": { readonly orgId: string; readonly projectId: string };
    readonly "decide-proposal": {
      readonly orgId: string;
      readonly proposalId: string;
      readonly write: HqProposalDecisionWrite;
    };
  }
  interface OperationResults {
    readonly "set-chief": { readonly chief: HqChief };
    readonly "decide-proposal": { readonly decision: HqProposalDecision };
  }
}

/** HQ's answer is the write's end: nothing in the account's facts shows it. */
const answered = (_read: unknown, _intent: unknown, receipt: OperationReceipt) =>
  receipt.outcome.kind === "succeeded";

export const setChief: OperationKind<"set-chief"> = {
  kind: "set-chief",
  executor: "hq",
  reflected: answered,
};

export const decideProposal: OperationKind<"decide-proposal"> = {
  kind: "decide-proposal",
  executor: "hq",
  reflected: answered,
};

export const HQ_CHIEF_KINDS = [setChief, decideProposal] as const;

export type HqChiefIntent = Extract<
  OperationIntent,
  { readonly kind: (typeof HQ_CHIEF_KINDS)[number]["kind"] }
>;

/** The code a decision's refusal carries where HQ holds another decision of the proposal. */
export const PROPOSAL_DECIDED_ELSEWHERE = "conflict";
