import { PaperclipIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Overlay } from "~/components/ui/overlay";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

/**
 * A stand-in for the surface an overlay lies on. Its transform makes it the containing block of
 * a fixed layer too, so the window-wide `hint` stays inside the tile.
 */
export function OverlayStage({ children }: { readonly children: ReactNode }) {
  return <div className="relative h-48 w-full transform-gpu overflow-hidden">{children}</div>;
}

function OverlaySpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Each lies over its surface while it lasts and takes no press."
        title="Kinds"
      >
        <SpecimenGrid size="lg">
          <Specimen label={specimenLabel({ kind: "drop", shown: true })}>
            <OverlayStage>
              <Overlay icon={<PaperclipIcon aria-hidden="true" />} kind="drop" shown>
                Drop files to attach
              </Overlay>
            </OverlayStage>
          </Specimen>
          <Specimen label={specimenLabel({ kind: "hint", shown: true })}>
            <OverlayStage>
              <Overlay kind="hint" shown>
                Hold ⌘Q to quit
              </Overlay>
            </OverlayStage>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "overlay",
  title: "Overlay",
  purpose: "A layer over a surface that says one thing while something lasts: a drop, a held key.",
  group: "Kit",
  kind: "Overlays",
  source: "apps/web/src/components/ui/overlay.tsx",
  render: () => <OverlaySpecimens />,
});
