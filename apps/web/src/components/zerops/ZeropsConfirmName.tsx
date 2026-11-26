/**
 * The one field that asks a name typed before something is deleted. The exact text to type stands
 * on a line of its own above the field (`CopyLine`): its edge shows where the name starts and ends,
 * spaces and dots included, and its Copy takes it whole. Under the field, one line says whether
 * what is typed matches, or what still holds Delete (`hold`).
 */
import { useId } from "react";

import { Badge } from "~/components/ui/badge";
import { CopyLine } from "~/components/ui/copy-line";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Text } from "~/components/ui/text";
import { confirmNameWords } from "./ZeropsDeleteMateDialog.logic";

export function ZeropsConfirmName({
  name,
  whose,
  typed,
  onTyped,
  pending,
  hold,
  autoFocus = false,
}: {
  readonly name: string;
  /** "the Mate's", "the project's", "the Production's". */
  readonly whose: string;
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly pending: boolean;
  /** What else holds Delete once the name matches ("Slide each Stage to confirm."); `null`: nothing. */
  readonly hold?: string | null;
  readonly autoFocus?: boolean;
}) {
  const id = useId();
  const words = confirmNameWords({ name, whose, typed });
  return (
    <div className="flex flex-col gap-1.5" data-zerops-surface="confirm-name">
      <Label htmlFor={`${id}-name`}>{words.ask}</Label>
      <div className="flex">
        <CopyLine label={words.copyLabel} value={name} />
      </div>
      <Input
        aria-describedby={`${id}-hint`}
        aria-label={words.label}
        autoComplete="off"
        autoFocus={autoFocus}
        id={`${id}-name`}
        onChange={(event) => {
          onTyped(event.target.value);
        }}
        readOnly={pending}
        spellCheck={false}
        value={typed}
      />
      <div aria-live="polite" className="flex min-h-5 items-center" id={`${id}-hint`}>
        {words.matches ? (
          hold === undefined || hold === null ? (
            <Text variant="note">
              <Badge dot tone="success">
                {words.match}
              </Badge>
            </Text>
          ) : (
            <Text variant="note">{hold}</Text>
          )
        ) : (
          <Text variant="note">{words.hint}</Text>
        )}
      </div>
    </div>
  );
}
