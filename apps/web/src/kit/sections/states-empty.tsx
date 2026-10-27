import { EmptyProjectFilePicker } from "~/components/files/ProjectFilePicker";
import { EmptyContentSearchDialog } from "~/components/search/ProjectContentSearchDialog";
import { EmptySourceControlDiscovery } from "~/components/settings/SourceControlSettings";
import { CrewSectionEmpty } from "~/components/zerops/crew/CrewSection";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { CensusLook, StateCensus, StateFrame } from "../states/Census";
import { ChosenEmpty } from "../states/Chosen";
import { WREN } from "../states/fixtures";

const READY_WREN = { ...WREN, connected: true };

function EmptyCensus() {
  return (
    <StateCensus
      atom="EmptyState"
      chosen={<ChosenEmpty />}
      count="4 looks: 13 own empty components in 11 files and 5 inline blocks in 5 more."
    >
      <CensusLook
        name="Kit Empty: icon, title, line, action"
        uses="2 components in 2 files"
        places={[
          "apps/web/src/components/settings/SourceControlSettings.tsx:452 EmptySourceControlDiscovery",
          "apps/web/src/components/NoActiveThreadState.tsx:6 NoActiveThreadState",
        ]}
      >
        <Specimen
          label="<EmptySourceControlDiscovery error={null} />"
          source="apps/web/src/components/settings/SourceControlSettings.tsx"
        >
          <div className="w-[560px]">
            <EmptySourceControlDiscovery error={null} isPending={false} onScan={() => {}} />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="A Mate's face, a headline, a line, an action"
        uses="about 14 sites in 5 files"
        places={[
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx:324 MateEmptyStateView",
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx:85 ZeropsMateEmptyState",
          "apps/web/src/components/zerops/crew/CrewSection.tsx:55 CrewSectionEmpty",
          "apps/web/src/components/zerops/crew/CrewmateEmptyState.tsx:55 CrewmateEmptyState",
          "apps/web/src/components/chat/MessagesTimeline.tsx:4771 TimelineEmptyState",
        ]}
      >
        <Specimen
          label="<MateEmptyStateView signInRequired={false} /> · an empty conversation"
          source="apps/web/src/components/zerops/ZeropsMateEmptyState.tsx"
        >
          <StateFrame size="page">
            <MateEmptyStateView
              mate={READY_WREN}
              phase={null}
              signIn={null}
              signInRequired={false}
              unknown={null}
            />
          </StateFrame>
        </Specimen>
        <Specimen
          label="<CrewSectionEmpty lock={null} />"
          source="apps/web/src/components/zerops/crew/CrewSection.tsx"
        >
          <StateFrame size="page">
            <CrewSectionEmpty
              lock={null}
              mate={{ name: "Fen", tint: "amber" }}
              onSetUp={() => {}}
              onSignIn={() => {}}
            />
          </StateFrame>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="One muted line where the rows would be"
        uses="5 sites in 4 files"
        places={[
          "apps/web/src/components/zerops/ZeropsGitPage.tsx:236, :275 (inline)",
          "apps/web/src/components/zerops/ZeropsRepositoryBrowser.tsx:32, :34 (inline)",
          "apps/web/src/components/zerops/vault/VaultPanel.tsx:535 (inline)",
          "apps/web/src/components/settings/GitRemoteSettings.tsx:116 (inline)",
        ]}
      >
        <Specimen label="(inline) <p className=…>No values yet.</p>">
          <p className="px-1 py-2 text-line text-muted-foreground">No values yet.</p>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="A sentence inside a disabled search palette"
        uses="2 components in 2 files"
        places={[
          "apps/web/src/components/files/ProjectFilePicker.tsx:53 EmptyProjectFilePicker",
          "apps/web/src/components/search/ProjectContentSearchDialog.tsx:82 EmptyContentSearchDialog",
        ]}
      >
        <Specimen
          label="<EmptyProjectFilePicker />"
          source="apps/web/src/components/files/ProjectFilePicker.tsx"
        >
          <div className="w-[520px] rounded-xl border">
            <EmptyProjectFilePicker />
          </div>
        </Specimen>
        <Specimen
          label="<EmptyContentSearchDialog />"
          source="apps/web/src/components/search/ProjectContentSearchDialog.tsx"
        >
          <div className="flex h-60 w-[520px] flex-col rounded-xl border">
            <EmptyContentSearchDialog />
          </div>
        </Specimen>
      </CensusLook>
    </StateCensus>
  );
}

export default defineKitSection({
  id: "home-made-empty",
  title: "Empty",
  purpose:
    "The chosen empty state in every size, then every way the app still says a place holds nothing.",
  group: "Home-made",
  kind: "Feedback",
  source: "apps/web/src/kit/sections/states-empty.tsx",
  render: () => <EmptyCensus />,
});
