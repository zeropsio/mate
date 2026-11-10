/**
 * An environment's vault on its own page (stage, prod): no Mate there to tell, so the person
 * restarts what a change needs from the vault itself. It is a drawer the place's Vault door opens
 * over the page (`PlaceDoors`), closed by default: open beside the page it took a third of the
 * screen on every visit (the owner, 2026-11-09).
 */
import { useCallback, useLayoutEffect, useState, type ReactNode } from "react";

import { PreviewPanelShell } from "../../RightPanelShell";
import { Sheet, SheetPopup } from "../../ui/sheet";
import type { PlaceVault } from "./placeVault.logic";
import { ProjectVaultPanel } from "./VaultPanelContainer";

/** The environment's vault in a drawer over its page, from the right edge. */
export function StopVaultDrawer({
  orgId,
  projectId,
  name,
  open,
  onOpenChange,
  part,
  body,
}: {
  readonly orgId: string;
  readonly projectId: string;
  /** The environment as the page names it (`Production`, `Stage`). */
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The part of the vault it opens at (a scope's id, `data-vault-part`); its top where absent. */
  readonly part?: string | undefined;
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
          {part === undefined ? null : <ShowsPart part={part} />}
        </PreviewPanelShell>
      </SheetPopup>
    </Sheet>
  );
}

/**
 * Brings a part of the vault to the drawer's top as it opens, where the list already holds it: a
 * press on that part's row of the page's Vault card lands on it.
 */
function ShowsPart({ part }: { readonly part: string }) {
  useLayoutEffect(() => {
    document
      .querySelector(`[data-zerops-surface="stop-vault"] [data-vault-part="${CSS.escape(part)}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [part]);
  return null;
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
