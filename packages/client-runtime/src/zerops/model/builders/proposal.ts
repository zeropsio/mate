import { readZeropsProposal } from "../proposal.ts";
import type { ZeropsCall } from "../types.ts";
import type { BuiltCardFields } from "./shared.ts";

/**
 * An organization tool's proposal: titled by its own summary. Nothing ran — the person approves
 * or declines it on its card, so its words say what was proposed, never that it happened.
 */
export function buildProposalFields(call: ZeropsCall): BuiltCardFields {
  const proposal = readZeropsProposal(call.toolName, call.resultText);
  const subject = proposal?.summary ?? "a change";
  return {
    subject,
    kicker: `Proposal · ${subject}`,
    voice: `Proposed: ${subject}`,
    voiceSource: "agent",
    statusWord: "Proposed",
    steps: [],
    links: [],
    hasResult: proposal !== undefined,
    ...(proposal === undefined ? {} : { proposal }),
  };
}
