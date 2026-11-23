/**
 * The person's Chief and the decisions on its proposals, as HQ records them (`zerops/hq/chief.ts`):
 * a Chief registered for a project, and one decision on a proposal. HQ answers each at once and
 * keeps no request id for it, so a lost answer stays uncertain and is never sent again blindly — a
 * Chief is set again by the person, and a decision is written once: a second is HQ's conflict. An
 * approval whose effect HQ carries out is one start (`approve-proposal`), its operation's id the
 * client's, so the same start sent again is answered again; HQ records its end itself. A
 * reveal's record goes to the organization's activity, once per reveal: the value it names is shown
 * only once HQ kept the record.
 *
 * @module data/operations/hqChief
 */
import type { HqProposalApproval } from "../../zerops/hq/client.ts";
import type {
  HqChief,
  HqProposalDecision,
  HqProposalDecisionWrite,
  HqRevealRecord,
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
    readonly "approve-proposal": {
      readonly orgId: string;
      readonly proposalId: string;
      readonly approval: HqProposalApproval;
    };
    readonly "record-reveal": { readonly orgId: string; readonly reveal: HqRevealRecord };
  }
  interface OperationResults {
    readonly "set-chief": { readonly chief: HqChief };
    readonly "decide-proposal": { readonly decision: HqProposalDecision };
    readonly "record-reveal": Record<string, never>;
  }
}

/** HQ's answer is the write's end: nothing in the account's facts shows it. */
const answered = (_read: unknown, _intent: unknown, receipt: OperationReceipt) =>
  receipt.outcome.kind === "succeeded";

const setChief: OperationKind<"set-chief"> = {
  kind: "set-chief",
  executor: "hq",
  reflected: answered,
};

const decideProposal: OperationKind<"decide-proposal"> = {
  kind: "decide-proposal",
  executor: "hq",
  reflected: answered,
};

const approveProposal: OperationKind<"approve-proposal"> = {
  kind: "approve-proposal",
  executor: "hq",
  reflected: answered,
};

const recordReveal: OperationKind<"record-reveal"> = {
  kind: "record-reveal",
  executor: "hq",
  reflected: answered,
};

export const HQ_CHIEF_KINDS = [setChief, decideProposal, approveProposal, recordReveal] as const;

export type HqChiefIntent = Extract<
  OperationIntent,
  { readonly kind: (typeof HQ_CHIEF_KINDS)[number]["kind"] }
>;

/** The code a decision's refusal carries where HQ holds another decision of the proposal. */
export const PROPOSAL_DECIDED_ELSEWHERE = "conflict";

/**
 * The code a reveal's refusal carries where no retry records it: HQ refuses the person. Someone HQ
 * lets record it can.
 */
export const REVEAL_UNRECORDABLE = "reveal_unrecordable";
