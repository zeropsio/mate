import {
  CopyIcon,
  CropIcon,
  PencilIcon,
  PlusIcon,
  SquareSplitHorizontal,
  Trash2Icon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Toolbar } from "~/components/ui/toolbar";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A terminal's tools as they stand over its output. */
export function SampleTerminalTools() {
  return (
    <Toolbar aria-label="Terminal">
      <Button aria-label="Split" size="icon-2xs" variant="ghost">
        <SquareSplitHorizontal />
      </Button>
      <Separator className="h-4" orientation="vertical" />
      <Button aria-label="New terminal" size="icon-2xs" variant="ghost">
        <PlusIcon />
      </Button>
      <Separator className="h-4" orientation="vertical" />
      <Button aria-label="Close terminal" size="icon-2xs" variant="ghost">
        <Trash2Icon />
      </Button>
    </Toolbar>
  );
}

function ToolbarSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Presses on a ground of their own, so what runs under them never shows through."
        title="Sizes"
      >
        <SpecimenGrid size="md">
          <Specimen label='size="sm"' note="On the surface it acts on: a terminal, a table">
            <SampleTerminalTools />
          </Specimen>
          <Specimen label='size="sm"' note="A table's copy on its corner">
            <Toolbar aria-label="Table">
              <Button aria-label="Copy the table" size="icon-sm" variant="ghost">
                <CopyIcon />
              </Button>
            </Toolbar>
          </Specimen>
          <Specimen label='size="md"' note="Floating over a stage: a picture's tools">
            <Toolbar aria-label="Picture" size="md">
              <Button variant="ghost">
                <CropIcon />
                Crop
              </Button>
              <Separator className="mx-1 h-5" orientation="vertical" />
              <Button variant="ghost">
                <PencilIcon />
                Draw
              </Button>
            </Toolbar>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "toolbar",
  title: "Toolbar",
  purpose: "A few presses that act on what they stand over, on a ground of their own.",
  group: "Kit",
  kind: "Actions",
  source: "apps/web/src/components/ui/toolbar.tsx",
  render: () => <ToolbarSpecimens />,
});
