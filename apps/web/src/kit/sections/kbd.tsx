import { CommandIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Kbd, KbdGroup } from "~/components/ui/kbd";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function KbdSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="Keys and chords">
        <SpecimenGrid>
          <Specimen label="<Kbd>" note="A key">
            <Kbd>Esc</Kbd>
          </Specimen>
          <Specimen label="<Kbd> · <CommandIcon />" note="A key drawn as its icon">
            <Kbd>
              <CommandIcon />
            </Kbd>
          </Specimen>
          <Specimen label="<KbdGroup>" note="A chord">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="In place">
        <SpecimenGrid size="md">
          <Specimen label='<Kbd tone="ink">' note="On a press, in its ink">
            <Button>
              Merge <Kbd tone="ink">⌘↵</Kbd>
            </Button>
          </Specimen>
          <Specimen label="<Kbd>" note="Inside a sentence">
            <span className="text-body">
              Press <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> to send.
            </span>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
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
