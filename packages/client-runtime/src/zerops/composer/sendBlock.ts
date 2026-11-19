/** Which provider state should the composer show as the catalog arrives? */
export function providerChrome(input: {
  picked: boolean;
  catalogKnown: boolean;
}): "picked" | "pending" | "unavailable" {
  if (input.picked) return "picked";
  return input.catalogKnown ? "unavailable" : "pending";
}

/** Can the picked agent take this turn given the provider and Zerops blocks? */
export function agentTakesTurn(input: {
  providerPicked: boolean;
  providerBlock: unknown | null;
  zeropsBlock: unknown | null;
}): boolean {
  return input.providerPicked && input.providerBlock === null && input.zeropsBlock === null;
}

/** Which reason holds this send, given whether the person is answering a question? */
export function sendBlock<R>(input: {
  conversationBlock: R | null;
  answering: boolean;
  attachmentBlock: R | null;
  providerBlock: R | null;
  zeropsBlock: R | null;
}): R | null {
  const { conversationBlock, answering, attachmentBlock, providerBlock, zeropsBlock } = input;
  const agentBlock = providerBlock ?? zeropsBlock;
  return conversationBlock ?? (answering ? null : (attachmentBlock ?? agentBlock));
}
