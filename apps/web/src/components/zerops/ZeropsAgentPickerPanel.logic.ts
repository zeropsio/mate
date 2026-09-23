/**
 * What the model picker's per-agent panel says and offers, for every
 * `ZeropsAgentAvailability` kind except `ready` (a ready agent renders its
 * models, never this panel — see `ChatComposer`'s `renderInstancePanel`).
 * An agent whose sign-in is `unknown` says so through `knownPresentation`:
 * "Checking…" while it is read, the cause once a read failed.
 *
 * Pure view logic, mirroring the split every other Zerops dialog/card uses
 * (`ZeropsAgentAuthorizationDialog.logic.ts`, `ZeropsGroupTree.logic.ts`):
 * the component renders exactly what this resolves, nothing more.
 */
import { ZEROPS_AGENT_NAMES } from "./ZeropsAgentAuthorizationDialog.logic";
import type {
  ZeropsAgentAuthUnknown,
  ZeropsAgentAvailability,
  ZeropsAgentSignInKind,
} from "@t3tools/client-runtime/zerops/agentAvailability";
import { knownPresentation } from "@t3tools/client-runtime/zerops/knowledge";
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
  /**
   * One action for every known non-`ready` kind — disabled for `registering`,
   * which can only wait. `null` while the sign-in is `unknown`: nothing here
   * moves it, the feed answers on its own.
   */
  readonly primaryAction: ZeropsAgentPickerPanelPrimaryAction | null;
  readonly showCancel: boolean;
  /**
   * Shown when this instance is ALSO locked out of the current session (a
   * started thread locked to a different agent): signing in here is
   * project-wide, not per session, so the panel still offers it, but says
   * where it will actually run. `undefined` otherwise.
   */
  readonly sessionLockNotice?: string | undefined;
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

/**
 * What the panel says while the agent's sign-in is not known. Only the
 * message is used, and each state it renders (unread, reading, failed)
 * carries one; none of them reads the clock, and the Mate's update offer is
 * not known here, so none is made.
 */
function unknownStatus(agentName: string, read: ZeropsAgentAuthUnknown): string {
  const presentation = knownPresentation(
    read,
    {
      subject: `${agentName}'s sign-in`,
      entity: "agent",
      source: "mate",
      checking: `Checking whether ${agentName} is signed in…`,
      negative: null,
    },
    { nowMs: 0, updateOffered: false },
  );
  return presentation.message?.text ?? "";
}

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
  /**
   * When this instance is ALSO locked out of the current session (a started
   * thread locked to a different agent), that agent's display name.
   * `undefined` on an unstarted thread, or when this IS the locked agent.
   */
  readonly lockedToAgentName?: string | undefined;
}): ZeropsAgentPickerPanelView {
  const agentName = ZEROPS_AGENT_NAMES[input.agentId];
  const { availability } = input;
  const sessionLockNotice =
    input.lockedToAgentName === undefined
      ? undefined
      : `This session runs on ${input.lockedToAgentName}. ${agentName} is used in a New session.`;

  switch (availability.kind) {
    case "unknown":
      return {
        agentName,
        statusLine: unknownStatus(agentName, availability.read),
        primaryAction: null,
        showCancel: false,
        sessionLockNotice,
      };
    case "registering":
      return {
        agentName,
        statusLine: "Signed in — registering with Zerops…",
        primaryAction: { kind: "continue", label: "Registering…", disabled: true },
        showCancel: false,
        sessionLockNotice,
      };
    case "signing-in":
      return {
        agentName,
        statusLine: "Signing in…",
        primaryAction: { kind: "continue", label: "Continue authorization", disabled: false },
        showCancel: true,
        sessionLockNotice,
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
        sessionLockNotice,
      };
    case "someone-else":
      return {
        agentName,
        statusLine: zeropsAgentPickerSomeoneElseStatus(input.signerName),
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
        sessionLockNotice,
      };
    case "unrecorded":
      return {
        agentName,
        statusLine: "This agent's sign-in was not recorded by Zerops Mate, so nobody can run it.",
        primaryAction: { kind: "use-my-account", label: "Use my account", disabled: false },
        showCancel: false,
        sessionLockNotice,
      };
  }
}

/**
 * The panel's primary-action click: close the picker popover before opening
 * the sign-in dialog, so the dialog never renders underneath it (the
 * popover otherwise stays mounted on top, covering the dialog's own
 * footer). Mirrors the upstream provider-setup link's
 * `props.onRequestClose?.()` before `onOpenProviderSetup`.
 */
export function invokeZeropsAgentPickerPrimaryAction(input: {
  readonly agentId: ZeropsAgentId;
  readonly requestClosePicker: () => void;
  readonly onOpenDialog: (agentId: ZeropsAgentId) => void;
}): void {
  input.requestClosePicker();
  input.onOpenDialog(input.agentId);
}
