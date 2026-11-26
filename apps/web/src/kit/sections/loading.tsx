import { defineKitSection } from "../kitSection";
import { SpecimenBlock, Specimens } from "../Specimen";
import { ChosenLoading } from "../states/Chosen";

export default defineKitSection({
  id: "loading",
  title: "Loading",
  purpose:
    "Something on its way, drawn as a stand-in shaped like what comes, painted once and replaced in one frame; never a Loading… word in the middle of a page.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/ui/loading.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="A stand-in shaped like what comes, replaced in one frame."
        title="Shapes"
      >
        <ChosenLoading />
      </SpecimenBlock>
    </Specimens>
  ),
});
