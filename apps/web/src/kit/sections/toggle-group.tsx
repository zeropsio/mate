import type { ComponentProps } from "react";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "lucide-react";

import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel, variantsOf } from "../specimenLabel";

type ToggleVariant = NonNullable<ComponentProps<typeof ToggleGroup>["variant"]>;

const VARIANTS = variantsOf<ToggleVariant>({
  segmented: true,
  default: true,
  ghost: true,
  outline: true,
});

function Choices({ disabled = false }: { readonly disabled?: boolean }) {
  return (
    <>
      <Toggle value="list">List</Toggle>
      <Toggle value="board">Board</Toggle>
      <Toggle disabled={disabled} value="map">
        Map
      </Toggle>
    </>
  );
}

function ToggleGroupSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Variants, horizontal and vertical">
        <SpecimenGrid>
          {VARIANTS.flatMap((variant) =>
            (["horizontal", "vertical"] as const).map((orientation) => (
              <Specimen
                key={`${variant}-${orientation}`}
                label={specimenLabel({
                  variant,
                  orientation: orientation === "horizontal" ? undefined : orientation,
                })}
              >
                <ToggleGroup defaultValue={["board"]} orientation={orientation} variant={variant}>
                  <Choices />
                </ToggleGroup>
              </Specimen>
            )),
          )}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="States">
        <SpecimenGrid>
          <Specimen label="multiple, icons">
            <ToggleGroup defaultValue={["left", "center"]} multiple variant="outline">
              <Toggle aria-label="Left" value="left">
                <AlignLeftIcon />
              </Toggle>
              <Toggle aria-label="Center" value="center">
                <AlignCenterIcon />
              </Toggle>
              <Toggle aria-label="Right" value="right">
                <AlignRightIcon />
              </Toggle>
            </ToggleGroup>
          </Specimen>
          <Specimen label="disabled">
            <ToggleGroup defaultValue={["board"]} disabled>
              <Choices />
            </ToggleGroup>
          </Specimen>
          <Specimen label="one item disabled">
            <ToggleGroup defaultValue={["board"]}>
              <Choices disabled />
            </ToggleGroup>
          </Specimen>
          <Specimen label='size="sm" variant="outline"'>
            <ToggleGroup defaultValue={["list"]} size="sm" variant="outline">
              <Choices />
            </ToggleGroup>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "toggle-group",
  title: "ToggleGroup",
  purpose: "One choice among a few, all in view; segmented by default.",
  group: "Kit",
  kind: "Actions",
  source: "apps/web/src/components/ui/toggle-group.tsx",
  render: () => <ToggleGroupSpecimens />,
});
