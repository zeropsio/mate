import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
  type ZeropsAgentAuth,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { overlayZeropsAgentAuth } from "./zeropsAgentProviderOverlay.ts";

const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");
const OPENCODE = ProviderDriverKind.make("opencode");

const provider = (
  driver: ProviderDriverKind,
  overrides?: Partial<ServerProvider>,
): ServerProvider => ({
  instanceId: defaultInstanceIdForDriver(driver),
  driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-22T18:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

// What the Codex driver reported on birth-progress-1 for 7 minutes after the
// sign-in, while the project's flag already said signed in.
const STALE_CODEX = provider(CODEX, {
  status: "error",
  auth: { status: "unauthenticated" },
  message: "Codex CLI is not authenticated. Run `codex login` and try again.",
});

const agent = (
  agentId: ZeropsAgentAuth["agentId"],
  state: ZeropsAgentAuth["state"],
  providerAuth: ZeropsAgentAuth["providerAuth"] = "unknown",
): ZeropsAgentAuth => ({
  agentId,
  credPresent: state !== "not-authorized" && state !== "reconnect",
  flagOAuth: state === "authorized" || state === "reconnect",
  flagToken: state === "authorized-token",
  providerAuth,
  state,
});

const snapshot = (...agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents,
});

const codexOf = (providers: ReadonlyArray<ServerProvider>) =>
  providers.find((entry) => entry.driver === CODEX);

describe("overlayZeropsAgentAuth", () => {
  it("offers an agent the moment the project's flag says it is signed in", () => {
    const codex = codexOf(
      overlayZeropsAgentAuth([STALE_CODEX], snapshot(agent("codex", "authorized"))),
    );

    expect(codex?.status).toBe("ready");
    expect(codex?.auth.status).toBe("authenticated");
    expect(codex?.message).toBeUndefined();
  });

  it("keeps the driver's account details and its note about a working agent", () => {
    const withAccount = provider(CODEX, {
      auth: { status: "authenticated", email: "dev@example.com" },
      message: "A newer Codex is available.",
    });
    const codex = codexOf(
      overlayZeropsAgentAuth([withAccount], snapshot(agent("codex", "authorized"))),
    );

    expect(codex?.auth).toEqual({ status: "authenticated", email: "dev@example.com" });
    expect(codex?.message).toBe("A newer Codex is available.");
  });

  it.each([
    ["not-authorized", "unknown", "error", "is not signed in on this project"],
    ["reconnect", "unknown", "error", "this container has no login for it"],
    ["authorized", "unauthenticated", "error", "no longer works"],
    ["local-only", "authenticated", "warning", "being registered with Zerops"],
  ] as const)(
    "%s + check %s cannot be picked, and says why",
    (state, providerAuth, status, reason) => {
      const codex = codexOf(
        overlayZeropsAgentAuth([provider(CODEX)], snapshot(agent("codex", state, providerAuth))),
      );

      expect(codex?.status).toBe(status);
      expect(codex?.message).toContain(reason);
    },
  );

  it("leaves other drivers, and a driver that is not installed, to themselves", () => {
    const notInstalled = provider(CLAUDE, {
      installed: false,
      status: "error",
      message: "not found",
    });
    const opencode = provider(OPENCODE, { status: "warning" });
    const result = overlayZeropsAgentAuth(
      [notInstalled, opencode],
      snapshot(agent("claude-code", "authorized"), agent("codex", "authorized")),
    );

    expect(result).toEqual([notInstalled, opencode]);
  });

  it("changes nothing outside Zerops", () => {
    const providers = [STALE_CODEX];
    expect(overlayZeropsAgentAuth(providers, { available: false, agents: [] })).toBe(providers);
  });
});
