import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

const NONE: readonly never[] = [];

/** One segmented choice: exactly one value pressed at a time, never none. */
export function Segmented<Value extends string>({
  label,
  values,
  value,
  names,
  disabled = NONE,
  onChange,
}: {
  readonly label: string;
  readonly values: readonly Value[];
  readonly value: Value;
  readonly names: Readonly<Record<Value, string>>;
  readonly disabled?: readonly Value[];
  readonly onChange: (value: Value) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      onValueChange={(next) => {
        const chosen = values.find((candidate) => candidate !== value && next.includes(candidate));
        if (chosen !== undefined) onChange(chosen);
      }}
      value={[value]}
    >
      {values.map((candidate) => (
        <Toggle disabled={disabled.includes(candidate)} key={candidate} value={candidate}>
          {names[candidate]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
