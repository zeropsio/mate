import type { ComponentProps } from "react";
import { BoldIcon } from "lucide-react";

import { Toggle } from "~/components/ui/toggle";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix } from "../Specimen";
import { variantsOf } from "../specimenLabel";

type ToggleVariant = NonNullable<ComponentProps<typeof Toggle>["variant"]>;
type ToggleSize = NonNullable<ComponentProps<typeof Toggle>["size"]>;

const VARIANTS = variantsOf<ToggleVariant>({
  default: true,
  ghost: true,
  outline: true,
  segmented: true,
});
const SIZES = variantsOf<ToggleSize>({
  xs: true,
  sm: true,
  default: true,
  lg: true,
  compact: true,
  segmented: true,
});

function ToggleSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Variants × sizes">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="size"
          columns={SIZES}
          render={(variant, size) => (
            <Toggle size={size} variant={variant}>
              Wrap
            </Toggle>
          )}
        />
      </SpecimenBlock>
      <SpecimenBlock title="States, per variant">
        <SpecimenMatrix
          rowProp="variant"
          rows={VARIANTS}
          columnProp="state"
          columns={["off", "defaultPressed", "disabled", "icon only"] as const}
          render={(variant, state) =>
            state === "icon only" ? (
              <Toggle aria-label="Bold" variant={variant}>
                <BoldIcon />
              </Toggle>
            ) : (
              <Toggle
                defaultPressed={state === "defaultPressed"}
                disabled={state === "disabled"}
                variant={variant}
              >
                Wrap
              </Toggle>
            )
          }
        />
      </SpecimenBlock>
      <SpecimenBlock title="With icon">
        <SpecimenGrid>
          <Specimen label='variant="outline" defaultPressed'>
            <Toggle defaultPressed variant="outline">
              <BoldIcon />
              Bold
            </Toggle>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "toggle",
  title: "Toggle",
  purpose: "A press that stays pressed: one setting, on or off.",
  group: "Kit",
  kind: "Actions",
  source: "apps/web/src/components/ui/toggle.tsx",
  render: () => <ToggleSpecimens />,
});
