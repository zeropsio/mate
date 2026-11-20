import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  type ZeropsAgentAuthFacts,
  resolveZeropsAgentAvailability,
  zeropsAgentAuthReads,
} from "./agentAvailability.ts";
import type { Known } from "./knowledge/index.ts";

/** Every row read as signed out: an answer that read a row would be "needs sign-in". */
const signedOut = (): ZeropsAgentAuthFacts => ({
  state: "not-authorized",
  providerAuth: "unauthenticated",
  credPresent: false,
  flagToken: false,
});

// witness: packages/client-runtime/src/zerops/agentAvailability.ts | if (input.agent.state !== "known") return { kind: "unknown", read: input.agent }; → if (input.agent.state !== "known") return { kind: "needs-sign-in", signInKind: "not-authorized" };
it("ZV117: An agent's sign-in state that was not read never reads as needing sign-in", () => {
  const unread: Known<ZeropsAgentAuthSnapshot> = { state: "unread", waitingFor: null };
  const reading: Known<ZeropsAgentAuthSnapshot> = { state: "reading", sinceMs: 0, attempt: 1 };
  for (const snapshot of [unread, reading]) {
    const read = zeropsAgentAuthReads(snapshot, signedOut)?.("claude-code");
    expect(read).toEqual(snapshot);
    expect(resolveZeropsAgentAvailability({ agent: read!, viewerSubject: undefined })).toEqual({
      kind: "unknown",
      read: snapshot,
    });
  }
});
