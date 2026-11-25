import { CommandIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";

function KbdSpecimens() {
  return (
    <SpecimenGrid>
      <Specimen label="<Kbd>">
        <Kbd>Esc</Kbd>
      </Specimen>
      <Specimen label="<Kbd> + icon">
        <Kbd>
          <CommandIcon />
        </Kbd>
      </Specimen>
      <Specimen label="<KbdGroup>">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Specimen>
      <Specimen label='<Kbd tone="ink"> on a press'>
        <Button>
          Merge <Kbd tone="ink">⌘↵</Kbd>
        </Button>
      </Specimen>
      <Specimen label="inside a sentence">
        <span className="text-body">
          Press <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to send.
        </span>
      </Specimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "kbd",
  title: "Kbd",
  purpose: "A key or a chord the person can press.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/kbd.tsx",
  render: () => <KbdSpecimens />,
});
