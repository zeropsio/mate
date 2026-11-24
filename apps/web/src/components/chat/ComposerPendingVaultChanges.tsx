import { vaultNote, type VaultChange } from "@t3tools/client-runtime/data";
import { KeyRound, X } from "lucide-react";

import { vaultChangeIdOf, vaultChipLabel } from "~/zerops/vaultTurnNotes.logic";
import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
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

/** Whose value it is, as the person sees the vault: a service's, shared, or the Mate's own. */
const placeOf = (change: VaultChange): string =>
  change.impact.mateOnly === true ? "Mate's own" : (change.hostname ?? "Shared");

const ABOUT = "Your next message tells the Mate these names. It never sees the values.";

/** × on a chip: leaves what it holds untold. */
function DismissButton({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={COMPOSER_INLINE_CHIP_DISMISS_BUTTON_CLASS_NAME}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <X className="size-3" aria-hidden />
    </button>
  );
}

/**
 * The vault changes the next message tells the Mate. One change is one chip: its key and what
 * happened to it, what the Mate will hear on hover, and × to leave it untold. Several are one chip
 * that counts them, × leaving them all untold; pressed, it lists each with its place and its own ×.
 */
export function ComposerPendingVaultChanges({
  changes,
  onRemove,
  className,
}: ComposerPendingVaultChangesProps) {
  const [only] = changes;
  if (only === undefined) return null;
  if (changes.length === 1) {
    const label = vaultChipLabel(only);
    return (
      <div className={cn("flex", className)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
                <KeyRound className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
                <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{label}</span>
                <DismissButton label={`Don't tell about ${label}`} onClick={() => onRemove(only)} />
              </span>
            }
          />
          <TooltipPopup side="top" variant="code" className="max-w-96 whitespace-pre-wrap">
            {heardOf(only)}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  }
  const count = `${changes.length} vault changes`;
  return (
    <div className={cn("flex", className)}>
      <span className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-[0.33em] outline-none"
                aria-label={`${count}, told with your next message`}
              >
                <KeyRound className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
                <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{count}</span>
              </button>
            }
          />
          <PopoverPopup side="top" align="start" padding="compact" width="md">
            <p className="pb-2 text-muted-foreground text-xs">{ABOUT}</p>
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {changes.map((change) => {
                const label = vaultChipLabel(change);
                return (
                  <li
                    key={vaultChangeIdOf(change)}
                    className="flex min-w-0 items-center gap-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                    <span className="shrink-0 text-muted-foreground">{placeOf(change)}</span>
                    <DismissButton
                      label={`Don't tell about ${label}`}
                      onClick={() => onRemove(change)}
                    />
                  </li>
                );
              })}
            </ul>
          </PopoverPopup>
        </Popover>
        <DismissButton
          label={`Don't tell about these ${count}`}
          onClick={() => {
            for (const change of changes) onRemove(change);
          }}
        />
      </span>
    </div>
  );
}
