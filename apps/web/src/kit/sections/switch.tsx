import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

export default defineKitSection({
  id: "switch",
  title: "Switch",
  purpose: "A setting that takes effect the moment it flips.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/switch.tsx",
  render: () => (
    <SpecimenGrid>
      {[
        { label: "(defaults)", props: {} },
        { label: "defaultChecked", props: { defaultChecked: true } },
        { label: "disabled", props: { disabled: true } },
        { label: "defaultChecked disabled", props: { defaultChecked: true, disabled: true } },
      ].map(({ label, props }) => (
        <Specimen key={label} label={label}>
          <Label>
            <Switch {...props} />
            Sleep when idle
          </Label>
        </Specimen>
      ))}
    </SpecimenGrid>
  ),
});
