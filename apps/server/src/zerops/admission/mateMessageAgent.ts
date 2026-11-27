/**
 * The agent another Mate's message gives the Mate's main conversation where that conversation has
 * none, or where the Mate has no conversation at all: the one the stand-up gives it
 * (`mainConversationAgent`), for the message's owner, on an agent they signed in here that admits
 * the message — never one Mate signs nobody in to, which no message runs on. Only once the
 * stand-up's wait ended: a message never opens the conversation a stand-up is about to open, nor
 * takes its place. Pure, so it is judged on literals.
 *
 * @module mateMessageAgent
 */
import type { ConversationAgent, ModelSelection, ServerProvider } from "@t3tools/contracts";

import { type ConversationFacts, mainConversationAgent } from "../ZeropsBootstrapModel.ts";

export type MateMessageAgent =
  /** Given to the conversation, which the message then goes to. */
  | { readonly kind: "given"; readonly agent: ConversationAgent }
  /** The stand-up's wait has not ended: it may open the conversation yet. */
  | { readonly kind: "wait-stand-up" }
  /** No agent its owner signed in here admits it. */
  | { readonly kind: "wait-sign-in" }
  /** The admitted login's provider snapshot has not arrived yet. */
  | { readonly kind: "wait-provider" };

export const mateMessageAgent = (input: {
  /** The main conversation, where the Mate has one. */
  readonly main: ConversationFacts | undefined;
  /** Whether the setup's wait for the stand-up ended (`ZeropsStandUpReceipt`). */
  readonly standUpSettled: boolean;
  /** The instances its owner may run that admit the message, the one to choose first. */
  readonly mayRun: ReadonlyArray<string>;
  /** The project's default model, where a V1 project still holds one. */
  readonly projectDefault: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): MateMessageAgent => {
  if (!input.standUpSettled) return { kind: "wait-stand-up" };
  if (input.mayRun.length === 0) return { kind: "wait-sign-in" };
  const ready = input.providers.find((provider) => provider.instanceId === input.mayRun[0]);
  if (ready === undefined) return { kind: "wait-provider" };
  const agent = mainConversationAgent({
    conversation: input.main,
    agents: [],
    ready,
    projectDefault: input.projectDefault,
    automatedModel: undefined,
    providers: input.providers,
  });
  return agent === undefined ? { kind: "wait-sign-in" } : { kind: "given", agent };
};
