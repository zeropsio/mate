/**
 * An environment's vault on its own page (stage, prod): no Mate there to tell, so the person
 * restarts what a change needs from the vault itself. It is a drawer the header's Vault opens over
 * the page, closed by default: open beside the page it took a third of the screen on every visit
 * (the owner, 2026-11-09).
 */
import { Vault } from "lucide-react";
import type { ReactNode } from "react";

import { PreviewPanelShell } from "../../RightPanelShell";
import { Button } from "../../ui/button";
import { Sheet, SheetPopup } from "../../ui/sheet";
import { ProjectVaultPanel } from "./VaultPanelContainer";

/** The page's verb that opens its vault drawer. */
export function StopVaultToggle({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Button
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => onOpenChange(!open)}
      size="sm"
      variant="secondary"
    >
      <Vault aria-hidden="true" />
      Vault
    </Button>
  );
}

/** The environment's vault in a drawer over its page, from the right edge. */
export function StopVaultDrawer({
  orgId,
  projectId,
  name,
  open,
  onOpenChange,
  body,
}: {
  readonly orgId: string;
  readonly projectId: string;
  /** The environment as the page names it (`Production`, `Stage`). */
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** What the drawer holds; the project's vault, read from the account, unless given. */
  readonly body?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup
        aria-label={`Vault · ${name}`}
        className="max-w-xl"
        data-zerops-surface="stop-vault"
        side="right"
      >
        <PreviewPanelShell mode="sheet">
          {/* Whose values these are: the drawer reads as the place's own, not the page's. */}
          <h2 className="flex h-12 flex-none items-center gap-1.5 px-4 pe-12 text-body font-medium text-foreground">
            Vault
            <span className="font-normal text-muted-foreground">· {name}</span>
          </h2>
          {body ?? (
            <ProjectVaultPanel
              actor="environment"
              project={{ orgId, projectId }}
              who={{ kind: "environment", name }}
            />
          )}
        </PreviewPanelShell>
      </SheetPopup>
    </Sheet>
  );
}
