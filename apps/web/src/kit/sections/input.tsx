import { Input } from "~/components/ui/input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES = ["sm", "compact", "default", "lg"] as const;

function InputSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Sizes">
        <SpecimenGrid>
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ size })}>
              <div className="w-56">
                <Input aria-label={`Name, ${size}`} placeholder="Project name" size={size} />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="States and types">
        <SpecimenGrid>
          {[
            { label: "defaultValue", props: { defaultValue: "storefront" } },
            { label: 'font="mono"', props: { defaultValue: "zcli push", font: "mono" as const } },
            { label: "disabled", props: { defaultValue: "storefront", disabled: true } },
            { label: "aria-invalid", props: { defaultValue: "store front", "aria-invalid": true } },
            { label: 'type="search"', props: { placeholder: "Search", type: "search" } },
            { label: 'type="number"', props: { defaultValue: "8080", type: "number" } },
            { label: 'type="password"', props: { defaultValue: "secret", type: "password" } },
            { label: 'type="file"', props: { type: "file" } },
            {
              label: "long value",
              props: { defaultValue: "storefront-preview-eu-central-2-with-a-very-long-name" },
            },
          ].map(({ label, props }) => (
            <Specimen key={label} label={label}>
              <div className="w-56">
                <Input aria-label={label} {...props} />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "input",
  title: "Input",
  purpose: "One line of text the person types.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/input.tsx",
  render: () => <InputSpecimens />,
});
