import { AtSignIcon, CopyIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Spinner } from "~/components/ui/spinner";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const ALIGNS = ["inline-start", "inline-end", "block-start", "block-end"] as const;

function InputGroupSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="An addon at either end of the line, or above or below it."
        title="Addon alignments"
      >
        <SpecimenGrid size="md">
          {ALIGNS.map((align) => (
            <Specimen key={align} label={`<InputGroupAddon ${specimenLabel({ align })}>`}>
              <div className="w-full max-w-64">
                <InputGroup>
                  <InputGroupAddon align={align}>
                    {align.startsWith("block") ? (
                      <span className="text-caption">Domain</span>
                    ) : (
                      <AtSignIcon />
                    )}
                  </InputGroupAddon>
                  <InputGroupInput aria-label={`Domain, ${align}`} placeholder="shop.example.com" />
                </InputGroup>
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Variants and content">
        <SpecimenGrid size="md">
          <Specimen label='<InputGroup variant="ghost">' note="No frame until it is used">
            <div className="w-full max-w-64">
              <InputGroup variant="ghost">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput aria-label="Search, ghost" placeholder="Search" />
              </InputGroup>
            </div>
          </Specimen>
          <Specimen label="<InputGroupAddon> · <Spinner />" note="Searching">
            <div className="w-full max-w-64">
              <InputGroup>
                <InputGroupAddon>
                  <Spinner />
                </InputGroupAddon>
                <InputGroupInput aria-label="Search, loading" defaultValue="medusa" />
              </InputGroup>
            </div>
          </Specimen>
          <Specimen
            label='<InputGroupAddon align="inline-end"> · <Button size="icon-sm">'
            note="A press inside the frame"
          >
            <div className="w-full max-w-64">
              <InputGroup>
                <InputGroupInput
                  aria-label="Address"
                  defaultValue="storefront-1a2b.zerops.app"
                  readOnly
                />
                <InputGroupAddon align="inline-end">
                  <Button aria-label="Copy" size="icon-sm" variant="ghost">
                    <CopyIcon />
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "input-group",
  title: "InputGroup",
  purpose: "An input with an icon, a word or a button inside its frame.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/input-group.tsx",
  render: () => <InputGroupSpecimens />,
});
