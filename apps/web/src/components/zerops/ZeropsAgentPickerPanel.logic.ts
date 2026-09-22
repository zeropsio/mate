/**
 * What the model picker's per-agent panel says and offers, for every
 * `ZeropsAgentAvailability` kind except `ready` (a ready agent renders its
 * models, never this panel — see `ChatComposer`'s `renderInstancePanel`).
 *
 * Pure view logic, mirroring the split every other Zerops dialog/card uses
 * (`ZeropsAgentAuthorizationDialog.logic.ts`, `ZeropsGroupTree.logic.ts`):
 * the component renders exactly what this resolves, nothing more.
 */
import { ZEROPS_AGENT_NAMES } from "./ZeropsAgentAuthorizationDialog.logic";
import type {
  ZeropsAgentAvailability,
  ZeropsAgentSignInKind,
} from "@t3tools/client-runtime/zerops/agentAvailability";
import type { ZeropsAgentId } from "@t3tools/contracts";

export type ZeropsAgentPickerPanelPrimaryActionKind = "sign-in" | "continue" | "use-my-account";

export interface ZeropsAgentPickerPanelPrimaryAction {
  readonly kind: ZeropsAgentPickerPanelPrimaryActionKind;
  readonly label: string;
  readonly disabled: boolean;
}

export interface ZeropsAgentPickerPanelView {
  readonly agentName: string;
  readonly statusLine: string;
  /** Every non-`ready` kind has one action — disabled for `registering`, which can only wait. */
  readonly primaryAction: ZeropsAgentPickerPanelPrimaryAction;
  readonly showCancel: boolean;
}

/**
 * "Sign in to Claude" / "Sign in to Codex" — the short vendor name, matching
 * the label `ZeropsAgentAuthCard` already uses, not the CLI's own
 * "Claude Code" product name.
 */
const AGENT_SIGN_IN_LABEL: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "Sign in to Claude",
  codex: "Sign in to Codex",
};

const SIGN_IN_LABEL: Readonly<Record<ZeropsAgentSignInKind, (agentId: ZeropsAgentId) => string>> = {
  "not-authorized": (agentId) => AGENT_SIGN_IN_LABEL[agentId],
  reconnect: () => "Sign in again",
  "needs-reauth": () => "Sign in again",
};

const SIGN_IN_STATUS: Readonly<Record<ZeropsAgentSignInKind, (agentName: string) => string>> = {
  "not-authorized": () => "Not signed in.",
  reconnect: (agentName) => `${agentName} needs to reconnect.`,
  "needs-reauth": (agentName) => `${agentName} no longer accepts this sign-in.`,
};

/** The line shown when nobody but the signer can run this agent (D6). */
export function zeropsAgentPickerSomeoneElseStatus(signerName: string | undefined): string {
  const name = signerName?.trim() ?? "";
  return name.length === 0
    ? "Signed in by another project member — only they can run it."
    : `Signed in by ${name} — only they can run it.`;
}

export function resolveZeropsAgentPickerPanelView(input: {
  readonly agentId: ZeropsAgentId;
  readonly availability: Exclude<ZeropsAgentAvailability, { readonly kind: "ready" }>;
  /** The recorded signer's display name, for `someone-else`. `undefined` when unknown. */
  readonly signerName?: string | undefined;
}): ZeropsAgentPickerPanelView {
  const agentName = ZEROPS_AGENT_NAMES[input.agentId];
  const { availability } = input;

  switch (availability.kind) {
    case "registering":
      return {
        agentName,
        statusLine: "Signed in — registering with Zerops…",
        primaryAction: { kind: "continue", label: "Registering…", disabled: true },
        showCancel: false,
      };
    case "signing-in":
      return {
        agentName,
        statusLine: "Signing in…",
        primaryAction: { kind: "continue", label: "Continue authorization", disabled: false },
        showCancel: true,
      };
    case "needs-sign-in":
      return {
        agentName,
        statusLine: SIGN_IN_STATUS[availability.signInKind](agentName),
        primaryAction: {
          kind: "sign-in",
          label: SIGN_IN_LABEL[availability.signInKind](input.agentId),
          disabled: false,
        },
        showCancel: false,
      };
    case "someone-else":
      return {
        agentName,
        statusLine: zeropsAgentPickerSomeoneElseStatus(input.signerName),
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
      };
    case "unrecorded":
      return {
        agentName,
        statusLine: "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.",
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
      };
  }
}
