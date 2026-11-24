import { Input } from "../ui/input";

/**
 * A Mate's name as the big line under its face (the New project page's Mate step, the add-Mate
 * dialog), editable where it stands: a press puts the caret in it and typing changes it, with no
 * field drawn around it — the caret is the only sign. *Shuffle* rolls it too.
 */
export function MateNameText({
  value,
  onValueChange,
  describedBy,
  invalid = false,
  readOnly = false,
}: {
  readonly value: string;
  readonly onValueChange: (typed: string) => void;
  /** The quiet line saying what is wrong with it, or what Add waits on. */
  readonly describedBy?: string | undefined;
  readonly invalid?: boolean;
  readonly readOnly?: boolean;
}) {
  return (
    <Input
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-label="Mate's name"
      autoComplete="off"
      maxLength={40}
      onChange={(event) => {
        onValueChange(event.target.value);
      }}
      readOnly={readOnly}
      size="inline"
      spellCheck={false}
      unstyled
      value={value}
    />
  );
}
