/**
 * The model picker's list area for an agent that is not `ready`: no models
 * to choose from, just what is going on and the one action that moves it
 * forward. Rendered through `ProviderModelPicker`'s `renderInstancePanel`
 * (`ChatComposer` supplies the callback), which also makes that agent's rail
 * icon selectable even though it has nothing ready to pick.
 *
 * View logic lives in `ZeropsAgentPickerPanel.logic.ts`; this component only
 * renders what that resolves and wires the one action button to the caller's
 * callbacks — the same sign-in dialog flow `ZeropsMateEmptyState` and the
 * chat header's lifecycle band already open (`useZeropsAgentSignInDialog`).
 */
import type { ZeropsAgentAvailability } from "@t3tools/client-runtime/zerops/agentAvailability";
import type { ZeropsAgentId } from "@t3tools/contracts";

import { ClaudeAI, OpenAI } from "~/components/Icons";
import { Button } from "~/components/ui/button";
import { resolveZeropsAgentPickerPanelView } from "./ZeropsAgentPickerPanel.logic";

function ZeropsAgentPickerLogo({ agentId }: { readonly agentId: ZeropsAgentId }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background shadow-xs"
      data-zerops-agent-logo={agentId}
    >
      {agentId === "claude-code" ? (
        <ClaudeAI className="size-4.5" />
      ) : (
        <OpenAI className="size-4.5" />
      )}
    </span>
  );
}

export function ZeropsAgentPickerPanel({
  agentId,
  availability,
  signerName,
  onOpenDialog,
  onCancel,
}: {
  readonly agentId: ZeropsAgentId;
  readonly availability: Exclude<ZeropsAgentAvailability, { readonly kind: "ready" }>;
  /** The recorded signer's display name, for `someone-else`. `undefined` when unknown. */
  readonly signerName?: string | undefined;
  /** "Sign in to X" / "Sign in again" / "Continue authorization" / "Use my account" — all open the same dialog. */
  readonly onOpenDialog: (agentId: ZeropsAgentId) => void;
  /** `signing-in`'s "Cancel" — stops the in-progress server-driven login session. */
  readonly onCancel: (agentId: ZeropsAgentId) => void;
}) {
  const view = resolveZeropsAgentPickerPanelView({ agentId, availability, signerName });

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center"
      data-zerops-surface="agent-picker-panel"
      data-zerops-agent-availability={availability.kind}
    >
      <ZeropsAgentPickerLogo agentId={agentId} />
      <p className="text-sm font-medium leading-snug text-foreground">{view.agentName}</p>
      <p className="text-xs leading-snug text-muted-foreground">{view.statusLine}</p>
      <Button
        disabled={view.primaryAction.disabled}
        onClick={() => onOpenDialog(agentId)}
        size="sm"
      >
        {view.primaryAction.label}
      </Button>
      {view.showCancel ? (
        <Button onClick={() => onCancel(agentId)} size="sm" variant="outline">
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
