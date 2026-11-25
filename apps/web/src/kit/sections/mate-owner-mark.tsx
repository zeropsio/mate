import { cn } from "~/lib/utils";
import { MateOwnerMark } from "~/components/zerops/MateOwnerMark";
import { FACE_CUT } from "~/components/zerops/menuFace";
import { MateFace } from "~/components/zerops/primitives";
import { ownerMark } from "~/components/zerops/SidebarMateRow.logic";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A Mate's face with its owner's mark cut into its corner, as the menu's row seats them. */
function SeatedFace({ seat }: { readonly seat: Parameters<typeof MateOwnerMark>[0]["seat"] }) {
  return (
    <span className="relative flex">
      <span className={cn("relative flex", FACE_CUT)}>
        <MateFace className="size-9" size={32} state="idle" tint="sky" />
      </span>
      <MateOwnerMark seat={seat} />
    </span>
  );
}

export default defineKitSection({
  id: "mate-owner-mark",
  title: "MateOwnerMark",
  purpose:
    "Whose Mate it is, on its face's corner: the person's picture or initial cut out of the face, or an empty seat when nobody's.",
  group: "Chosen",
  kind: "Identity",
  source: "apps/web/src/components/zerops/MateOwnerMark.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock title="Seats">
        <SpecimenGrid size="md">
          <Specimen label='seat={{ kind: "person" }}' note="A person's initial, cut into the face">
            <SeatedFace
              seat={{
                kind: "person",
                mark: ownerMark({ name: "Ada Lovelace", avatarUrl: null, initials: "" }),
              }}
            />
          </Specimen>
          <Specimen label='seat={{ kind: "nobody" }}' note="An empty seat: nobody's Mate yet">
            <SeatedFace seat={{ kind: "nobody", label: "Nobody's Mate yet" }} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
