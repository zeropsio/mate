import { EmptyProjectFilePicker } from "~/components/files/ProjectFilePicker";
import { EmptyContentSearchDialog } from "~/components/search/ProjectContentSearchDialog";
import { EmptyRows } from "~/components/settings/DiagnosticsSettings";
import { EmptySourceControlDiscovery } from "~/components/settings/SourceControlSettings";
import { SheetEmpty } from "~/components/zerops/addresses/AddressesSheetBits";
import { CrewSectionEmpty } from "~/components/zerops/crew/CrewSection";
import { OverviewFilterEmpty } from "~/components/zerops/projects/OverviewFilters";
import { Empty as GroupDetailEmpty } from "~/components/zerops/ZeropsGroupDetail";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { CensusLook, StateCensus, StateFrame } from "../states/Census";
import { WREN } from "../states/fixtures";

const READY_WREN = { ...WREN, connected: true };

function EmptyCensus() {
  return (
    <StateCensus
      atom="Empty"
      count="6 looks: 17 own empty components in 14 files and 8 inline blocks in 7 more; the kit Empty is used in 2 files."
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
        uses="about 16 sites in 6 files"
        places={[
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx:324 MateEmptyStateView",
          "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx:85 ZeropsMateEmptyState",
          "apps/web/src/components/zerops/projects/OverviewFilters.tsx:82 OverviewFilterEmpty",
          "apps/web/src/components/zerops/crew/CrewSection.tsx:53 CrewSectionEmpty",
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
        {(["waiting", "mine"] as const).map((show) => (
          <Specimen
            key={show}
            label={`<OverviewFilterEmpty show="${show}" />`}
            source="apps/web/src/components/zerops/projects/OverviewFilters.tsx"
          >
            <div className="w-[560px]">
              <OverviewFilterEmpty onShow={() => {}} show={show} />
            </div>
          </Specimen>
        ))}
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
        uses="13 sites in 7 files"
        places={[
          "apps/web/src/components/settings/DiagnosticsSettings.tsx:158 EmptyRows (5 uses)",
          "apps/web/src/components/zerops/addresses/AddressesSheetBits.tsx:120 SheetEmpty (4 uses)",
          "apps/web/src/components/zerops/ZeropsGroupDetail.tsx:2039 Empty (with an action)",
          "apps/web/src/components/zerops/ZeropsGitPage.tsx:236, :275 (inline)",
          "apps/web/src/components/zerops/ZeropsRepositoryBrowser.tsx:32, :34 (inline)",
          "apps/web/src/components/zerops/vault/VaultPanel.tsx:535 (inline)",
          "apps/web/src/components/settings/GitRemoteSettings.tsx:116 (inline)",
        ]}
      >
        <Specimen
          label='<EmptyRows label="No spans found." />'
          source="apps/web/src/components/settings/DiagnosticsSettings.tsx"
        >
          <div className="w-[440px] rounded-xl border">
            <EmptyRows label="No spans found." />
          </div>
        </Specimen>
        <Specimen
          label="<SheetEmpty>No open ports…</SheetEmpty>"
          source="apps/web/src/components/zerops/addresses/AddressesSheetBits.tsx"
        >
          <SheetEmpty>No open ports on this service.</SheetEmpty>
        </Specimen>
        <Specimen
          label='<Empty text="No environments yet." action="Add one" />'
          source="apps/web/src/components/zerops/ZeropsGroupDetail.tsx"
        >
          <GroupDetailEmpty action="Add one" onAction={() => {}} text="No environments yet." />
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
  purpose: "Every way a place says it holds nothing yet, side by side, to pick one pattern from.",
  group: "Home-made",
  kind: "Feedback",
  source: "apps/web/src/kit/sections/states-empty.tsx",
  render: () => <EmptyCensus />,
});
