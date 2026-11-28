import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { StatusPage } from "~/components/ui/status-page";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { StateFrame } from "../states/StateFrame";

export default defineKitSection({
  id: "status-page",
  title: "StatusPage",
  purpose: "A whole page whose title stays in place as its body, actions and footer arrive.",
  group: "Chosen",
  kind: "Feedback",
  source: "apps/web/src/components/ui/status-page.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock title="Forms">
        <SpecimenGrid size="page">
          <Specimen label="<StatusPage title />" note="Title only">
            <StateFrame size="page">
              <StatusPage title="Your Mate is ready" />
            </StateFrame>
          </Specimen>
          <Specimen label="<StatusPage title mark>" note="Waiting with a mark and body">
            <StateFrame size="page">
              <StatusPage mark={<Spinner size="md" />} title="Setting up your Mate…">
                <p>Keep this tab open while setup finishes.</p>
              </StatusPage>
            </StateFrame>
          </Specimen>
          <Specimen label="<StatusPage title actions footer>" note="An action and a quiet way back">
            <StateFrame size="page">
              <StatusPage
                actions={<Button>Try again</Button>}
                footer={<Button variant="ghost-muted">Back to the project</Button>}
                title="Your project couldn't open"
              >
                <p>The connection dropped while opening the project.</p>
              </StatusPage>
            </StateFrame>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
