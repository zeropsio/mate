import { Input } from "~/components/ui/input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES = ["sm", "compact", "default", "lg", "xl", "hero"] as const;

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
      <SpecimenBlock title="Inline">
        <SpecimenGrid>
          <Specimen label='size="inline"'>
            <div className="flex h-5 w-72 min-w-0 items-center font-mono text-body text-foreground">
              <span className="shrink-0 text-muted-foreground">octo-dev/</span>
              <Input
                aria-label="New repository's name"
                className="-ms-0.5 flex-1"
                defaultValue="tea-shop"
                size="inline"
              />
            </div>
          </Specimen>
          <Specimen label='size="inline" aria-invalid'>
            <div className="flex h-5 w-72 min-w-0 items-center font-mono text-body text-foreground">
              <span className="shrink-0 text-muted-foreground">octo-dev/</span>
              <Input
                aria-invalid
                aria-label="New repository's name, invalid"
                className="-ms-0.5 flex-1"
                defaultValue="tea shop"
                size="inline"
              />
            </div>
          </Specimen>
          <Specimen label='size="inline" unstyled'>
            <div className="w-72 text-center font-semibold text-display text-foreground">
              <Input aria-label="Mate's name" defaultValue="Quinn" size="inline" unstyled />
            </div>
          </Specimen>
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
