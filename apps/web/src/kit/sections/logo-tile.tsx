import { BoxIcon, PaletteIcon } from "lucide-react";

import { ClaudeAI, OpenAI, OpenCodeIcon } from "~/components/Icons";
import { LogoTile } from "~/components/ui/logo-tile";
import { ZeropsMark } from "~/components/ZeropsMark";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function LogoTileSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="Sizes">
        <SpecimenGrid>
          <Specimen label='size="lg"' note="An lg row's or a picker's start">
            <LogoTile size="lg">
              <ClaudeAI />
            </LogoTile>
          </Specimen>
          <Specimen label='size="md"' note="An md row's or a card's start">
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
      <SpecimenBlock note="Whatever says what the thing is, in the tile's own size." title="Marks">
        <SpecimenGrid>
          <Specimen label="<LogoTile>A</LogoTile>" note="An organization's letter">
            <LogoTile>A</LogoTile>
          </Specimen>
          <Specimen label="<LogoTile>GH</LogoTile>" note="A tool's letters">
            <LogoTile>GH</LogoTile>
          </Specimen>
          <Specimen label="<LogoTile><PaletteIcon /></LogoTile>" note="A kind of thing">
            <LogoTile>
              <PaletteIcon />
            </LogoTile>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="Flat, in the menu's tint and muted ink." title="On the menu">
        <SpecimenGrid>
          <Specimen label='ground="menu"' note="A project only Platform holds">
            <LogoTile ground="menu">
              <ZeropsMark tone="current" />
            </LogoTile>
          </Specimen>
          <Specimen label='ground="menu"' note="A project with no Mate yet">
            <LogoTile ground="menu">
              <BoxIcon />
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
  purpose:
    "What a thing is, on a tile of its own before its name: a logo, an organization's letter, a kind of thing's icon.",
  group: "Kit",
  kind: "Identity",
  source: "apps/web/src/components/ui/logo-tile.tsx",
  render: () => <LogoTileSpecimens />,
});
