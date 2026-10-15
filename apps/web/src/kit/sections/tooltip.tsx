import { InfoIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const VARIANTS = ["default", "glass", "code"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;

function TooltipSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="On hover: variants">
        <SpecimenGrid>
          {VARIANTS.map((variant) => (
            <Specimen key={variant} label={specimenLabel({ variant })}>
              <Tooltip>
                <TooltipTrigger render={<Button variant="outline" />}>{variant}</TooltipTrigger>
                <TooltipPopup variant={variant}>
                  {variant === "code" ? "zcli push --service-id storefront" : "Deploys main"}
                </TooltipPopup>
              </Tooltip>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="On hover: sides, long text">
        <SpecimenGrid>
          {SIDES.map((side) => (
            <Specimen key={side} label={specimenLabel({ side })}>
              <Tooltip>
                <TooltipTrigger
                  render={<Button aria-label={`Tooltip ${side}`} size="icon" variant="ghost" />}
                >
                  <InfoIcon />
                </TooltipTrigger>
                <TooltipPopup side={side}>Opens on the {side}</TooltipPopup>
              </Tooltip>
            </Specimen>
          ))}
          <Specimen label="long text">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" />}>Hover</TooltipTrigger>
              <TooltipPopup>
                The preview sleeps after an hour without visits and wakes on the next one, which
                takes a few seconds.
              </TooltipPopup>
            </Tooltip>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "tooltip",
  title: "Tooltip",
  purpose: "A name or a short hint for a control, on hover or focus.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/tooltip.tsx",
  render: () => <TooltipSpecimens />,
});
