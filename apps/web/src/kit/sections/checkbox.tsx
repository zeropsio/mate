import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

export default defineKitSection({
  id: "checkbox",
  title: "Checkbox",
  purpose: "One choice on or off, or several from a list.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/checkbox.tsx",
  render: () => (
    <SpecimenGrid>
      {[
        { label: "(defaults)", props: {} },
        { label: "defaultChecked", props: { defaultChecked: true } },
        { label: "indeterminate", props: { indeterminate: true } },
        { label: "disabled", props: { disabled: true } },
        { label: "defaultChecked disabled", props: { defaultChecked: true, disabled: true } },
      ].map(({ label, props }) => (
        <Specimen key={label} label={label}>
          <Label>
            <Checkbox {...props} />
            Deploy on push
          </Label>
        </Specimen>
      ))}
    </SpecimenGrid>
  ),
});
