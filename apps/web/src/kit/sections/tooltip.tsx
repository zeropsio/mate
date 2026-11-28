import { InfoIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const VARIANTS = ["default", "rich", "glass", "code"] as const;
const SIDES = ["top", "right", "bottom", "left"] as const;

const VARIANT_WORDS: Record<(typeof VARIANTS)[number], string> = {
  default: "Deploy main",
  rich: "The preview sleeps after an hour without visits and wakes on the next one, which takes a few seconds.",
  glass: "Deploy main",
  code: "zcli push --service-id storefront",
};

function TooltipSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="Hover each press to see its tooltip." title="Variants">
        <SpecimenGrid>
          {VARIANTS.map((variant) => (
            <Specimen key={variant} label={specimenLabel({ variant })}>
              <Tooltip>
                <TooltipTrigger render={<Button variant="secondary" />}>{variant}</TooltipTrigger>
                <TooltipPopup variant={variant}>{VARIANT_WORDS[variant]}</TooltipPopup>
              </Tooltip>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="A label names the press; its key follows. Past 18 rem a label wraps."
        title="Keys, sides and long labels"
      >
        <SpecimenGrid>
          <Specimen label={specimenLabel({ shortcut: "⌘K" })}>
            <Tooltip>
              <TooltipTrigger
                render={<Button aria-label="Search" size="icon-md" variant="ghost" />}
              >
                <SearchIcon />
              </TooltipTrigger>
              <TooltipPopup shortcut="⌘K">Search</TooltipPopup>
            </Tooltip>
          </Specimen>
          {SIDES.map((side) => (
            <Specimen key={side} label={specimenLabel({ side })}>
              <Tooltip>
                <TooltipTrigger
                  render={<Button aria-label={`Tooltip ${side}`} size="icon-md" variant="ghost" />}
                >
                  <InfoIcon />
                </TooltipTrigger>
                <TooltipPopup side={side}>Opens on the {side}</TooltipPopup>
              </Tooltip>
            </Specimen>
          ))}
          <Specimen label="<TooltipPopup>" note="Long label">
            <Tooltip>
              <TooltipTrigger render={<Button variant="secondary" />}>Hover</TooltipTrigger>
              <TooltipPopup>Sends when the limit resets at 14:00 tomorrow afternoon</TooltipPopup>
            </Tooltip>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "tooltip",
  title: "Tooltip",
  purpose: "A control's name, and its key, on hover or focus; a paragraph only as `rich`.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/tooltip.tsx",
  render: () => <TooltipSpecimens />,
});
