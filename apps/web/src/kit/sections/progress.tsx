import { defineKitSection } from "../kitSection";
import { SpecimenBlock, Specimens } from "../Specimen";
import { ChosenProgress } from "../states/Chosen";

export default defineKitSection({
  id: "progress",
  title: "Progress",
  purpose:
    "A long operation as one row: its step in words that replace themselves, its clock beside an honest estimate, a bar that only moves forward; on a StatusPage for a whole page.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/ui/progress.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Its step in words, its clock beside an honest estimate, a bar that only moves forward."
        title="Under way, done and failed"
      >
        <ChosenProgress />
      </SpecimenBlock>
    </Specimens>
  ),
});
