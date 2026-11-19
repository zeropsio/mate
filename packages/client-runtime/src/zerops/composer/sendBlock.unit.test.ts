import { expect, it } from "vite-plus/test";
import { agentTakesTurn, providerChrome, sendBlock } from "./sendBlock.ts";

// witness: packages/client-runtime/src/zerops/composer/sendBlock.ts | return input.catalogKnown ? → return !input.catalogKnown ?
it("CP28: Before the provider catalog has arrived the composer waits for it, and says no provider is available only once it is known", () => {
  expect(providerChrome({ picked: false, catalogKnown: false })).toBe("pending");
  expect(providerChrome({ picked: false, catalogKnown: true })).toBe("unavailable");
  expect(providerChrome({ picked: true, catalogKnown: false })).toBe("picked");
});

// witness: packages/client-runtime/src/zerops/composer/sendBlock.ts | input.providerBlock === null && input.zeropsBlock === null → input.providerBlock === null
it("CP29: An agent whose provider is picked but blocked, by the provider or by Zerops, does not take the turn", () => {
  expect(agentTakesTurn({ providerPicked: true, providerBlock: null, zeropsBlock: "zerops" })).toBe(
    false,
  );
  expect(
    agentTakesTurn({ providerPicked: true, providerBlock: "provider", zeropsBlock: null }),
  ).toBe(false);
  expect(agentTakesTurn({ providerPicked: true, providerBlock: null, zeropsBlock: null })).toBe(
    true,
  );
});

// witness: packages/client-runtime/src/zerops/composer/sendBlock.ts | (answering ? null : (attachmentBlock ?? agentBlock)) → (attachmentBlock ?? (answering ? null : agentBlock))
it("CP30: While an answer to a question is being written, neither an attachment nor the agent's block holds its send", () => {
  expect(
    sendBlock({
      conversationBlock: null,
      answering: true,
      attachmentBlock: "attachment",
      providerBlock: "provider",
      zeropsBlock: "zerops",
    }),
  ).toBeNull();
});

// witness: packages/client-runtime/src/zerops/composer/sendBlock.ts | conversationBlock ?? (answering ? null : (attachmentBlock ?? agentBlock)) → answering ? null : (conversationBlock ?? attachmentBlock ?? agentBlock)
it("CP31: The conversation's own reason for holding a send is said even while an answer is being written", () => {
  expect(
    sendBlock({
      conversationBlock: "conversation",
      answering: true,
      attachmentBlock: null,
      providerBlock: null,
      zeropsBlock: null,
    }),
  ).toBe("conversation");
});

// witness: packages/client-runtime/src/zerops/composer/sendBlock.ts | providerBlock ?? zeropsBlock; → providerBlock;
it("CP32: A Zerops block alone holds a send that nothing else holds", () => {
  expect(
    sendBlock({
      conversationBlock: null,
      answering: false,
      attachmentBlock: null,
      providerBlock: null,
      zeropsBlock: "zerops",
    }),
  ).toBe("zerops");
});
