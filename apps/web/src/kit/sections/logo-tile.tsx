import { ClaudeAI, OpenAI, OpenCodeIcon } from "~/components/Icons";
import { LogoTile } from "~/components/ui/logo-tile";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function LogoTileSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="Sizes">
        <SpecimenGrid>
          <Specimen label='size="lg"' note="A picker's start">
            <LogoTile size="lg">
              <ClaudeAI />
            </LogoTile>
          </Specimen>
          <Specimen label='size="md"' note="A card's start">
            <LogoTile>
              <OpenAI />
            </LogoTile>
          </Specimen>
          <Specimen label='size="sm"' note="A compact line">
            <LogoTile size="sm">
              <OpenCodeIcon />
            </LogoTile>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "logo-tile",
  title: "LogoTile",
  purpose: "A product's logo on a tile of its own, before the product's name.",
  group: "Kit",
  kind: "Identity",
  source: "apps/web/src/components/ui/logo-tile.tsx",
  render: () => <LogoTileSpecimens />,
});
