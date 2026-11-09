/**
 * An environment's vault on its own page (stage, prod): no Mate there to tell, so the person
 * restarts what a change needs from the vault itself. It is a drawer the header's Vault opens over
 * the page, closed by default: open beside the page it took a third of the screen on every visit
 * (the owner, 2026-11-09).
 */
import { Vault } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { PreviewPanelShell } from "../../RightPanelShell";
import { Button } from "../../ui/button";
import { Sheet, SheetPopup } from "../../ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import type { PlaceVault } from "./placeVault.logic";
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

/**
 * A place's vault from its line on another page (an overview card, the project page): a quiet icon
 * at the line's end, shown while the line is hovered or holds focus (and always where nothing
 * hovers). It is always there and keeps its room, so nothing moves as it shows. The line's parent
 * names the hover with `group/place`.
 */
export function PlaceVaultButton({
  name,
  onOpen,
}: {
  /** The place as its line names it (`Production`). */
  readonly name: string;
  readonly onOpen: () => void;
}) {
  return (
    // Its row's height is the line's: the icon's extra height overhangs it.
    <span className="-my-1 flex shrink-0 opacity-0 transition-opacity duration-150 ease-out group-focus-within/place:opacity-100 group-hover/place:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-haspopup="dialog"
              aria-label={`Vault · ${name}`}
              onClick={onOpen}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <Vault aria-hidden="true" />
        </TooltipTrigger>
        <TooltipPopup side="top">Vault</TooltipPopup>
      </Tooltip>
    </span>
  );
}

/**
 * One vault drawer for every place line on a page: which place it holds, opened by `open`, which
 * is `undefined` where the account reads no organization. `body` draws a harness's fixture.
 */
export function usePlaceVaultDrawer(
  orgId: string | null,
  body?: (place: PlaceVault) => ReactNode,
): { readonly open: ((place: PlaceVault) => void) | undefined; readonly drawer: ReactNode } {
  // The place stays while the drawer closes, so it slides out with its values.
  const [shown, setShown] = useState<{ readonly place: PlaceVault; readonly open: boolean } | null>(
    null,
  );
  const open = useCallback((place: PlaceVault) => {
    setShown({ place, open: true });
  }, []);
  const onOpenChange = useCallback((next: boolean) => {
    setShown((current) => (current === null ? null : { ...current, open: next }));
  }, []);
  if (orgId === null) return { open: undefined, drawer: null };
  return {
    open,
    drawer:
      shown === null ? null : (
        <StopVaultDrawer
          // Another place's vault is its own: nothing searched or opened in the last carries over.
          key={shown.place.projectId}
          name={shown.place.name}
          onOpenChange={onOpenChange}
          open={shown.open}
          orgId={orgId}
          projectId={shown.place.projectId}
          {...(body === undefined ? {} : { body: body(shown.place) })}
        />
      ),
  };
}
