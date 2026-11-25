import { Slider } from "~/components/ui/slider";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "slider",
  title: "Slider",
  purpose: "A number picked along a range, judged by its effect rather than typed.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/slider.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock title="Values and states">
        <SpecimenGrid size="md">
          {[
            { label: "defaultValue={0}", props: { defaultValue: 0 } },
            { label: "defaultValue={60} step={5}", props: { defaultValue: 60, step: 5 } },
            { label: "defaultValue={100}", props: { defaultValue: 100 } },
            { label: "defaultValue={40} disabled", props: { defaultValue: 40, disabled: true } },
          ].map(({ label, props }) => (
            <Specimen key={label} label={label}>
              <Slider aria-label="Glass opacity" className="w-full max-w-52" {...props} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
