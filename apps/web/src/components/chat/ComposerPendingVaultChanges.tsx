import { vaultNote, type VaultChange } from "@t3tools/client-runtime/data";
import { KeyRound, X } from "lucide-react";

import { vaultChangeIdOf, vaultChipLabel } from "~/zerops/vaultTurnNotes.logic";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

interface ComposerPendingVaultChangesProps {
  readonly changes: ReadonlyArray<VaultChange>;
  readonly onRemove: (change: VaultChange) => void;
  readonly className?: string;
}

/** What the agent hears of one change: its line of the note. */
const heardOf = (change: VaultChange): string =>
  (vaultNote([change]) ?? "").split("\n").slice(1).join("\n");

/**
 * The vault changes the next message tells the Mate, one chip each: its key and what happened to
 * it, what the Mate will hear on hover, and × to leave it untold.
 */
export function ComposerPendingVaultChanges({
  changes,
  onRemove,
  className,
}: ComposerPendingVaultChangesProps) {
  if (changes.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {changes.map((change) => {
        const label = vaultChipLabel(change);
        return (
          <Tooltip key={vaultChangeIdOf(change)}>
            <TooltipTrigger
              render={
                <span className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
                  <KeyRound className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
                  <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{label}</span>
                  <button
                    type="button"
                    aria-label={`Don't tell about ${label}`}
                    className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onRemove(change);
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              }
            />
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap leading-tight">
              {heardOf(change)}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
