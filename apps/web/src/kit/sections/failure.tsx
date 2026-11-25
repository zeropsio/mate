import { defineKitSection } from "../kitSection";
import { ChosenFailure } from "../states/Chosen";

export default defineKitSection({
  id: "failure",
  title: "Failure",
  purpose:
    "Something failed: the cause in the person's words, the one action that fixes it, the source's words folded under Details. Inline in the place that failed, or a whole page.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/ui/failure.tsx",
  render: () => <ChosenFailure />,
});
