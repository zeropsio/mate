/**
 * An environment's vault beside its own page (stage, prod): no Mate there to tell, so the person
 * restarts what a change needs from the vault itself. It opens by default; closed, it stays closed
 * on every environment's page until the person opens it again.
 */
import { Vault } from "lucide-react";
import { create } from "zustand";

import { PreviewPanelShell } from "../../RightPanelShell";
import { Button } from "../../ui/button";
import { ProjectVaultPanel } from "./VaultPanelContainer";

const WIDTH_KEY = "mate:stop-vault-width";

/** Whether environment pages show their vault: open until the person closes it, this session. */
const useStopVaultStore = create<{ readonly open: boolean }>()(() => ({ open: true }));

const toggleStopVault = () => useStopVaultStore.setState((state) => ({ open: !state.open }));

/** Whether an environment's page shows its vault, and the toggle. */
export function useStopVaultOpen(): readonly [boolean, () => void] {
  return [useStopVaultStore((state) => state.open), toggleStopVault] as const;
}

/** The page's verb that shows or hides its vault. */
export function StopVaultToggle({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <Button aria-pressed={open} onClick={onToggle} size="sm" variant={open ? "secondary" : "ghost"}>
      <Vault aria-hidden="true" />
      Vault
    </Button>
  );
}

/** The environment's vault in a column beside its page, as wide as the person left it. */
export function StopVaultSide({
  orgId,
  projectId,
  name,
}: {
  readonly orgId: string;
  readonly projectId: string;
  /** The environment as the page names it (`prod`, `stage`). */
  readonly name: string;
}) {
  return (
    <PreviewPanelShell mode="inline" widthStorageKey={WIDTH_KEY}>
      <ProjectVaultPanel
        actor="environment"
        project={{ orgId, projectId }}
        who={{ kind: "environment", name }}
      />
    </PreviewPanelShell>
  );
}
