import { describe, expect, it } from "vite-plus/test";

import {
  resolveZeropsAgentPickerPanelView,
  zeropsAgentPickerSomeoneElseStatus,
  type ZeropsAgentPickerPanelView,
} from "./ZeropsAgentPickerPanel.logic";
import type { ZeropsAgentAvailability } from "@t3tools/client-runtime/zerops/agentAvailability";

describe("resolveZeropsAgentPickerPanelView", () => {
  it.each([
    {
      name: "registering shows a disabled control, not a sign-in prompt",
      agentId: "codex",
      availability: { kind: "registering" },
      expected: {
        agentName: "Codex",
        statusLine: "Signed in — registering with Zerops…",
        primaryAction: { kind: "continue", label: "Registering…", disabled: true },
        showCancel: false,
      },
    },
    {
      name: "signing-in offers to continue or cancel",
      agentId: "claude-code",
      availability: { kind: "signing-in" },
      expected: {
        agentName: "Claude Code",
        statusLine: "Signing in…",
        primaryAction: { kind: "continue", label: "Continue authorization", disabled: false },
        showCancel: true,
      },
    },
    {
      name: "needs-sign-in: not-authorized names the agent in the button",
      agentId: "claude-code",
      availability: { kind: "needs-sign-in", signInKind: "not-authorized" },
      expected: {
        agentName: "Claude Code",
        statusLine: "Not signed in.",
        primaryAction: { kind: "sign-in", label: "Sign in to Claude", disabled: false },
        showCancel: false,
      },
    },
    {
      name: "needs-sign-in: reconnect says 'Sign in again'",
      agentId: "codex",
      availability: { kind: "needs-sign-in", signInKind: "reconnect" },
      expected: {
        agentName: "Codex",
        statusLine: "Codex needs to reconnect.",
        primaryAction: { kind: "sign-in", label: "Sign in again", disabled: false },
        showCancel: false,
      },
    },
    {
      name: "needs-sign-in: needs-reauth says 'Sign in again'",
      agentId: "codex",
      availability: { kind: "needs-sign-in", signInKind: "needs-reauth" },
      expected: {
        agentName: "Codex",
        statusLine: "Codex no longer accepts this sign-in.",
        primaryAction: { kind: "sign-in", label: "Sign in again", disabled: false },
        showCancel: false,
      },
    },
    {
      name: "someone-else with a known signer name",
      agentId: "claude-code",
      availability: { kind: "someone-else", signerId: "user-b" },
      signerName: "Jan",
      expected: {
        agentName: "Claude Code",
        statusLine: "Signed in by Jan — only they can run it.",
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
      },
    },
    {
      name: "someone-else without a known signer name",
      agentId: "claude-code",
      availability: { kind: "someone-else", signerId: undefined },
      expected: {
        agentName: "Claude Code",
        statusLine: "Signed in by another project member — only they can run it.",
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
      },
    },
    {
      name: "unrecorded explains and offers the viewer's own account",
      agentId: "codex",
      availability: { kind: "unrecorded" },
      expected: {
        agentName: "Codex",
        statusLine: "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.",
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    agentId: "claude-code" | "codex";
    availability: Exclude<ZeropsAgentAvailability, { readonly kind: "ready" }>;
    signerName?: string;
    expected: ZeropsAgentPickerPanelView;
  }>)("$name", ({ agentId, availability, signerName, expected }) => {
    expect(resolveZeropsAgentPickerPanelView({ agentId, availability, signerName })).toEqual(
      expected,
    );
  });
});

describe("zeropsAgentPickerSomeoneElseStatus", () => {
  it.each([undefined, "", "   "])("falls back without a usable name (%j)", (name) => {
    expect(zeropsAgentPickerSomeoneElseStatus(name)).toBe(
      "Signed in by another project member — only they can run it.",
    );
  });

  it("names the signer when known", () => {
    expect(zeropsAgentPickerSomeoneElseStatus("Jan")).toBe(
      "Signed in by Jan — only they can run it.",
    );
  });
});
