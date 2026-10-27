import { AtSignIcon, CopyIcon, SearchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Spinner } from "~/components/ui/spinner";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const ALIGNS = ["inline-start", "inline-end", "block-start", "block-end"] as const;

function InputGroupSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Addon alignments">
        <SpecimenGrid>
          {ALIGNS.map((align) => (
            <Specimen key={align} label={`<InputGroupAddon ${specimenLabel({ align })}>`}>
              <div className="w-64">
                <InputGroup>
                  <InputGroupAddon align={align}>
                    {align.startsWith("block") ? (
                      <span className="text-xs">Domain</span>
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
        <SpecimenGrid>
          <Specimen label='<InputGroup variant="ghost">'>
            <div className="w-64">
              <InputGroup variant="ghost">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput aria-label="Search, ghost" placeholder="Search" />
              </InputGroup>
            </div>
          </Specimen>
          <Specimen label="addon: <Spinner />">
            <div className="w-64">
              <InputGroup>
                <InputGroupAddon>
                  <Spinner />
                </InputGroupAddon>
                <InputGroupInput aria-label="Search, loading" defaultValue="medusa" />
              </InputGroup>
            </div>
          </Specimen>
          <Specimen label='addon: <Button size="icon-xs">'>
            <div className="w-64">
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
    </div>
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
