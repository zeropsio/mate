import { ChatLinkView } from "~/components/zerops/ChatLinkPage";

import states from "./chat-link.states";
import { defineFlow } from "./mount";

const ignoreRetry = () => {};
const refusal = {
  kind: "refused",
  words: "This link is incomplete. Open the whole link Mate sent you.",
} as const;

export default defineFlow(states, {
  view: ChatLinkView,
  frame: "page",
  states: {
    "no-code": {
      taking: { kind: "waiting" },
      hasCode: false,
      organizationName: undefined,
      onRetry: ignoreRetry,
    },
    waiting: {
      taking: { kind: "waiting" },
      hasCode: true,
      organizationName: "Acme",
      onRetry: ignoreRetry,
    },
    linked: {
      taking: { kind: "linked", provider: "slack" },
      hasCode: false,
      organizationName: "Acme",
      onRetry: ignoreRetry,
    },
    uncertain: {
      taking: { kind: "uncertain" },
      hasCode: true,
      organizationName: "Acme",
      onRetry: ignoreRetry,
    },
    refused: { taking: refusal, hasCode: true, organizationName: "Acme", onRetry: ignoreRetry },
    "refused-no-code": {
      taking: refusal,
      hasCode: false,
      organizationName: "Acme",
      onRetry: ignoreRetry,
    },
  },
});
