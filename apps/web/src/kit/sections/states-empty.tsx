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
          "apps/web/src/components/settings/SourceControlSettings.tsx EmptySourceControlDiscovery",
          "apps/web/src/components/NoActiveThreadState.tsx NoActiveThreadState",
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
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx MateEmptyStateView",
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx ZeropsMateEmptyState",
          "apps/web/src/components/zerops/crew/CrewSection.tsx CrewSectionEmpty",
          "apps/web/src/components/zerops/crew/CrewmateEmptyState.tsx CrewmateEmptyState",
          "apps/web/src/components/chat/TimelineEmptyState.tsx TimelineEmptyState",
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
              error={null}
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
          "apps/web/src/components/zerops/ZeropsGitPage.tsx ZeropsGitOverview (inline)",
          "apps/web/src/components/zerops/gitBrowser/GitAtCommit.tsx GitNoCommit",
          "apps/web/src/components/zerops/gitBrowser/GitDirectoryList.tsx GitDirectoryList (inline)",
          "apps/web/src/components/zerops/vault/VaultPanel.tsx VaultPanelBody (inline)",
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
          "apps/web/src/components/files/ProjectFilePicker.tsx EmptyProjectFilePicker",
          "apps/web/src/components/search/ProjectContentSearchDialog.tsx EmptyContentSearchDialog",
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
