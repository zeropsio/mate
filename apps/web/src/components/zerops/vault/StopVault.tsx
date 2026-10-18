/**
 * An environment's vault beside its own page (stage, prod): no Mate there to tell, so the person
 * restarts what a change needs from the vault itself. It opens by default; closed, it stays closed
 * on every environment's page until the person opens it again.
 */
import { Vault } from "lucide-react";
import type { ReactNode } from "react";
import { create } from "zustand";

import { PreviewPanelShell } from "../../RightPanelShell";
import { Button } from "../../ui/button";
import type { SidePlacement } from "../landing/ZeropsHostedFrame";
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

/**
 * The environment's vault in a column beside its page, as wide as the person left it — or, where
 * the page has no room beside it, under the page at the page's width.
 */
export function StopVaultSide({
  orgId,
  projectId,
  name,
  placement = "beside",
  body,
}: {
  readonly orgId: string;
  readonly projectId: string;
  /** The environment as the page names it (`Production`, `Stage`). */
  readonly name: string;
  readonly placement?: SidePlacement;
  /** What the column holds; the project's vault, read from the account, unless given. */
  readonly body?: ReactNode;
}) {
  // Whose values these are: the column reads as the place's own, not the page's.
  const head = (
    <h2 className="flex h-10 flex-none items-end gap-1.5 px-3 text-body font-medium text-foreground">
      Vault
      <span className="font-normal text-muted-foreground">· {name}</span>
    </h2>
  );
  const panel = body ?? (
    <ProjectVaultPanel
      actor="environment"
      project={{ orgId, projectId }}
      who={{ kind: "environment", name }}
    />
  );
  if (placement === "under")
    return (
      <section
        className="flex flex-col overflow-hidden rounded-card border border-border"
        data-zerops-surface="stop-vault-under"
      >
        {head}
        {panel}
      </section>
    );
  return (
    <PreviewPanelShell mode="inline" widthStorageKey={WIDTH_KEY}>
      {head}
      {panel}
    </PreviewPanelShell>
  );
}
