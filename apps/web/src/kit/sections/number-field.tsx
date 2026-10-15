import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "~/components/ui/number-field";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES = ["sm", "default", "lg"] as const;

function Sample({
  size = "default",
  disabled = false,
}: {
  readonly size?: (typeof SIZES)[number];
  readonly disabled?: boolean;
}) {
  return (
    <NumberField
      className="w-36"
      defaultValue={30}
      disabled={disabled}
      min={0}
      size={size}
      step={5}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label="Decrease the interval" />
        <NumberFieldInput aria-label="Interval in seconds" />
        <NumberFieldIncrement aria-label="Increase the interval" />
      </NumberFieldGroup>
    </NumberField>
  );
}

export default defineKitSection({
  id: "number-field",
  title: "NumberField",
  purpose: "A number typed or stepped, within its bounds.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/number-field.tsx",
  render: () => (
    <SpecimenGrid>
      {SIZES.map((size) => (
        <Specimen key={size} label={specimenLabel({ size, min: 0, step: 5 })}>
          <Sample size={size} />
        </Specimen>
      ))}
      <Specimen label="disabled">
        <Sample disabled />
      </Specimen>
    </SpecimenGrid>
  ),
});
