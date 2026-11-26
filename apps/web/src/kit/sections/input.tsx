import { Input } from "~/components/ui/input";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES = ["sm", "compact", "default", "lg", "xl", "hero"] as const;

function InputSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="Sizes">
        <SpecimenGrid size="md">
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ size })}>
              <div className="w-full max-w-56">
                <Input aria-label={`Name, ${size}`} placeholder="Project name" size={size} />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A field that is part of the text around it." title="Inline">
        <SpecimenGrid size="lg">
          <Specimen label='size="inline"' note="A repository's name after its owner">
            <div className="flex h-5 w-full max-w-72 min-w-0 items-center font-mono text-body text-foreground">
              <span className="shrink-0 text-muted-foreground">octo-dev/</span>
              <Input
                aria-label="New repository's name"
                className="-ms-0.5 flex-1"
                defaultValue="tea-shop"
                size="inline"
              />
            </div>
          </Specimen>
          <Specimen label='size="inline" aria-invalid' note="A name that cannot be used">
            <div className="flex h-5 w-full max-w-72 min-w-0 items-center font-mono text-body text-foreground">
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
          <Specimen label='size="inline" unstyled' note="A Mate's name, in the heading's type">
            <div className="w-full max-w-72 text-center font-semibold text-display text-foreground">
              <Input aria-label="Mate's name" defaultValue="Quinn" size="inline" unstyled />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="States and types">
        <SpecimenGrid size="md">
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
              label: "defaultValue (long)",
              props: { defaultValue: "storefront-preview-eu-central-2-with-a-very-long-name" },
            },
          ].map(({ label, props }) => (
            <Specimen key={label} label={label}>
              <div className="w-full max-w-56">
                <Input aria-label={label} {...props} />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
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
