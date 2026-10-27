import type { ComponentProps } from "react";

import {
  Select,
  SelectButton,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { variantsOf } from "../specimenLabel";

type TriggerVariant = NonNullable<ComponentProps<typeof SelectTrigger>["variant"]>;
type TriggerSize = NonNullable<ComponentProps<typeof SelectTrigger>["size"]>;

const VARIANTS = variantsOf<TriggerVariant>({ default: true, ghost: true });
const SIZES = variantsOf<TriggerSize>({
  xs: true,
  sm: true,
  default: true,
  lg: true,
  compact: true,
});

const REGIONS = [
  { label: "Prague", value: "prg1" },
  { label: "Frankfurt", value: "fra1" },
  { label: "A region with a long name that does not fit", value: "long" },
];

function RegionSelect({
  variant,
  size,
  disabled = false,
  value = "prg1",
}: {
  readonly variant?: TriggerVariant;
  readonly size?: TriggerSize;
  readonly disabled?: boolean;
  readonly value?: string;
}) {
  return (
    <Select defaultValue={value} disabled={disabled} items={REGIONS}>
      <SelectTrigger aria-label="Region" size={size} variant={variant}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {REGIONS.map((region) => (
          <SelectItem key={region.value} value={region.value}>
            {region.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function SelectSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Trigger variants × sizes">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="size"
          columns={SIZES}
          render={(variant, size) => (
            <div className="w-40">
              <RegionSelect size={size} variant={variant} />
            </div>
          )}
        />
      </SpecimenBlock>
      <SpecimenBlock title="States">
        <SpecimenGrid>
          <Specimen label="disabled">
            <div className="w-40">
              <RegionSelect disabled />
            </div>
          </Specimen>
          <Specimen label="long value in a 160px trigger">
            <div className="w-40">
              <RegionSelect value="long" />
            </div>
          </Specimen>
          <Specimen label="placeholder (no value)">
            <div className="w-40">
              <Select items={REGIONS}>
                <SelectTrigger aria-label="Region">
                  <SelectValue placeholder="Pick a region" />
                </SelectTrigger>
                <SelectPopup>
                  <SelectGroup>
                    <SelectGroupLabel>Europe</SelectGroupLabel>
                    {REGIONS.map((region) => (
                      <SelectItem key={region.value} value={region.value}>
                        {region.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectPopup>
              </Select>
            </div>
          </Specimen>
          <Specimen label="<SelectButton> (the look, for a Menu or Combobox trigger)">
            <div className="w-40">
              <SelectButton>Prague</SelectButton>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "select",
  title: "Select",
  purpose: "One value from a fixed list, shown in its field.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/select.tsx",
  render: () => <SelectSpecimens />,
});
