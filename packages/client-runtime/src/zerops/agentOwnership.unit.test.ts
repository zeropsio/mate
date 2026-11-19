import { ZeropsUserId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  agentOwnershipAllowsTurns,
  agentOwnershipNeedsAttention,
  resolveAgentAuthorizer,
  resolveAgentOwnership,
  resolveOwnedAgentId,
} from "./agentOwnership.ts";

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | return recorded === input.viewerSubject ? "mine" : "someone-else"; → return recorded !== input.viewerSubject ? "mine" : "someone-else";
it("ZV1: An agent's login is the viewer's only when the person on record as signing it in is the viewer; anybody else's sign-in makes it somebody else's", () => {
  const userA = ZeropsUserId.make("user-a");
  const authorizedBy = { subject: userA };

  expect(resolveAgentOwnership({ credPresent: true, authorizedBy, viewerSubject: userA })).toBe(
    "mine",
  );
  expect(
    resolveAgentOwnership({
      credPresent: true,
      authorizedBy,
      viewerSubject: ZeropsUserId.make("user-b"),
    }),
  ).toBe("someone-else");
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | if (input.viewerSubject === undefined || input.viewerSubject.length === 0) return "unrecorded"; → if (input.viewerSubject?.length === 0) return "unrecorded";
it("ZV2: A login with no sign-in on record, or read by a viewer nobody can name, is nobody's to run and never said to be somebody else's", () => {
  expect(
    resolveAgentOwnership({ credPresent: true, viewerSubject: ZeropsUserId.make("user-a") }),
  ).toBe("unrecorded");
  expect(
    resolveAgentOwnership({
      credPresent: true,
      authorizedBy: { subject: ZeropsUserId.make("user-b") },
      viewerSubject: undefined,
    }),
  ).toBe("unrecorded");
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | return ownership === "mine" || ownership === "none"; → return ownership === "mine";
it("ZV3: A login with no credential held is nobody's, and a turn on it is not held back", () => {
  const ownership = resolveAgentOwnership({
    credPresent: false,
    authorizedBy: { subject: ZeropsUserId.make("user-b") },
    viewerSubject: ZeropsUserId.make("user-a"),
  });

  expect(ownership).toBe("none");
  expect(agentOwnershipAllowsTurns(ownership)).toBe(true);
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | return ownership === "mine" || ownership === "none"; → return ownership !== "someone-else";
it("ZV4: A turn runs only on the viewer's own login or one with no credential: somebody else's login and an unrecorded one hold it", () => {
  expect(agentOwnershipAllowsTurns("mine")).toBe(true);
  expect(agentOwnershipAllowsTurns("someone-else")).toBe(false);
  expect(agentOwnershipAllowsTurns("unrecorded")).toBe(false);
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | return ownership === "someone-else"; → return ownership === "someone-else" || ownership === "unrecorded";
it("ZV5: Only a login somebody else signed in asks for the viewer's attention; an unrecorded one does not", () => {
  expect(agentOwnershipNeedsAttention("someone-else")).toBe(true);
  expect(agentOwnershipNeedsAttention("unrecorded")).toBe(false);
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | login.startedBy === viewer && → login.startedBy !== undefined &&
it("ZV6: A sign-in the viewer started and that is still under way counts as theirs before the Mate records it; a colleague's under way does not", () => {
  const viewer = ZeropsUserId.make("user-a");
  const colleague = ZeropsUserId.make("user-b");

  expect(
    resolveAgentAuthorizer({ login: { phase: "verifying-code", startedBy: viewer } }, viewer),
  ).toEqual({ subject: viewer });
  expect(
    resolveAgentAuthorizer({ login: { phase: "verifying-code", startedBy: colleague } }, viewer),
  ).toBeUndefined();
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | "succeeded", → "awaiting-code",
it("ZV7: A finished, failed or cancelled sign-in vouches for nobody by itself: only the Mate's record names its signer then", () => {
  const viewer = ZeropsUserId.make("user-a");
  const colleague = ZeropsUserId.make("user-b");
  const login = { phase: "succeeded", startedBy: viewer } as const;

  expect(resolveAgentAuthorizer({ login }, viewer)).toBeUndefined();
  expect(
    resolveAgentAuthorizer({ login: { phase: "failed", startedBy: viewer } }, viewer),
  ).toBeUndefined();
  expect(
    resolveAgentAuthorizer({ login: { phase: "cancelled", startedBy: viewer } }, viewer),
  ).toBeUndefined();
  expect(resolveAgentAuthorizer({ login, authorizedBy: { subject: colleague } }, viewer)).toEqual({
    subject: colleague,
  });
});

// witness: packages/client-runtime/src/zerops/agentOwnership.ts | return agentIdForDriverKind(driver) ?? agentIdForProviderInstance(instanceId); → return agentIdForProviderInstance(instanceId);
it("ZV8: A login's agent is read from its provider's driver, so a second Claude Code login spends Claude Code, and a provider Mate signs nobody in to spends none", () => {
  const providers = [
    { instanceId: "claudeAgent", driver: "claudeAgent" },
    { instanceId: "claudeAgent_work", driver: "claudeAgent" },
    { instanceId: "opencode", driver: "opencode" },
  ];

  expect(resolveOwnedAgentId("claudeAgent_work", providers)).toBe("claude-code");
  expect(resolveOwnedAgentId("opencode", providers)).toBeUndefined();
});
