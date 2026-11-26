import { defaultInstanceIdForAgent } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { mateMessageAgent } from "./mateMessageAgent.ts";

/** A Mate with no conversation, its stand-up's wait over, its owner signed in to Codex and Claude. */
const noConversation = {
  main: undefined,
  standUpSettled: true,
  mayRun: ["codex", "claude-code"],
  projectDefault: null,
  providers: [],
} as const;
const noAgent = { agent: null, activeRun: null, lastEnded: null, queued: [] } as const;
const onCodex = {
  kind: "given",
  agent: { instanceId: defaultInstanceIdForAgent("codex"), profile: { kind: "mate" } },
} as const;

// witness: apps/server/src/zerops/admission/mateMessageAgent.ts | if (!input.standUpSettled) return { kind: "wait-stand-up" }; → if (input.standUpSettled) return { kind: "wait-stand-up" };
it("TA12: A message to a Mate with no conversation, or whose main conversation has no agent, gives that conversation the first agent its owner signed in that admits the message, and waits while the stand-up may still open it or no agent of its owner's admits it; breaks: a new Mate never works another Mate's message, or opens a second conversation beside its stand-up's", () => {
  expect(mateMessageAgent(noConversation)).toMatchObject(onCodex);
  expect(mateMessageAgent({ ...noConversation, main: noAgent })).toMatchObject(onCodex);
  expect(mateMessageAgent({ ...noConversation, standUpSettled: false })).toEqual({
    kind: "wait-stand-up",
  });
  expect(mateMessageAgent({ ...noConversation, mayRun: [] })).toEqual({ kind: "wait-sign-in" });
});
