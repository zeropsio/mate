import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function Choices({ disabled = false }: { readonly disabled?: boolean }) {
  return (
    <RadioGroup aria-label="Who can open it" defaultValue="team" disabled={disabled}>
      <Label>
        <Radio value="team" />
        The team
      </Label>
      <Label>
        <Radio value="public" />
        Anyone with the address
      </Label>
      <Label>
        <Radio disabled value="nobody" />
        Nobody (disabled item)
      </Label>
    </RadioGroup>
  );
}

export default defineKitSection({
  id: "radio-group",
  title: "RadioGroup",
  purpose: "One choice from a short list, every option in view.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/radio-group.tsx",
  render: () => (
    <SpecimenGrid>
      <Specimen label='<RadioGroup defaultValue="team">'>
        <Choices />
      </Specimen>
      <Specimen label="<RadioGroup disabled>">
        <Choices disabled />
      </Specimen>
    </SpecimenGrid>
  ),
});
