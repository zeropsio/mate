import { describe, expect, it } from "vite-plus/test";

import {
  invokeZeropsAgentPickerPrimaryAction,
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

describe("resolveZeropsAgentPickerPanelView — session lock notice", () => {
  it("says nothing when the thread is unstarted, or this IS the locked agent", () => {
    expect(
      resolveZeropsAgentPickerPanelView({
        agentId: "codex",
        availability: { kind: "needs-sign-in", signInKind: "not-authorized" },
      }).sessionLockNotice,
    ).toBeUndefined();
  });

  // The live bug: signing in is project-wide, not per session, so the panel
  // still offers it even while locked out — but says where it will run.
  it("names the locked agent and 'New session' (the header button's own name)", () => {
    expect(
      resolveZeropsAgentPickerPanelView({
        agentId: "codex",
        availability: { kind: "needs-sign-in", signInKind: "not-authorized" },
        lockedToAgentName: "Claude Code",
      }).sessionLockNotice,
    ).toBe("This session runs on Claude Code. Codex is used in a New session.");
  });

  it("applies to every non-ready kind, not just needs-sign-in", () => {
    expect(
      resolveZeropsAgentPickerPanelView({
        agentId: "claude-code",
        availability: { kind: "someone-else", signerId: "user-b" },
        lockedToAgentName: "Codex",
      }).sessionLockNotice,
    ).toBe("This session runs on Codex. Claude Code is used in a New session.");
  });
});

describe("invokeZeropsAgentPickerPrimaryAction", () => {
  // The live bug: the dialog opened on top of the still-mounted picker
  // popover, covering its own footer. The picker must close FIRST.
  it("closes the picker before opening the dialog", () => {
    const calls: string[] = [];
    invokeZeropsAgentPickerPrimaryAction({
      agentId: "codex",
      requestClosePicker: () => calls.push("close"),
      onOpenDialog: () => calls.push("open"),
    });
    expect(calls).toEqual(["close", "open"]);
  });

  it("opens the dialog for the given agent", () => {
    let openedFor: string | null = null;
    invokeZeropsAgentPickerPrimaryAction({
      agentId: "claude-code",
      requestClosePicker: () => {},
      onOpenDialog: (agentId) => {
        openedFor = agentId;
      },
    });
    expect(openedFor).toBe("claude-code");
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
