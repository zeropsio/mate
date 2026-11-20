import { ReviewCommentDiffLoading } from "~/components/chat/ReviewCommentDiffLoading";
import { ContextWindowMeterPlaceholder } from "~/components/chat/ContextWindowMeter";
import { DiffPanelHeaderSkeleton, DiffPanelLoadingState } from "~/components/DiffPanelShell";
import { RefreshFilesButton } from "~/components/files/FileBrowserPanel";
import { SourceControlSectionSkeleton } from "~/components/settings/SourceControlSettings";
import { DesktopUpdateStatusIcon } from "~/components/sidebar/DesktopUpdateStatusIcon";
import { UsageSummarySkeleton } from "~/components/usage/UsagePage";
import { ConversationFooterStandIn } from "~/components/zerops/ConversationFooterStandIn";
import { ReviewSkeleton } from "~/components/zerops/review/ZeropsReviewSurface";
import { MateReplyPending } from "~/components/zerops/SidebarZeropsTree";
import { WaitLine } from "~/components/zerops/WaitLine";
import { ZeropsPanelPlaceholder } from "~/components/zerops/ZeropsPanel";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { CensusLook, StateCensus, StateFrame } from "../states/Census";
import { ChosenLoading } from "../states/Chosen";

const PATCH = `@@ -12,7 +12,7 @@
-  const port = 3000;
+  const port = Number(process.env.PORT ?? 3000);`;

function LoadingCensus() {
  return (
    <StateCensus
      atom="Loading, in the shape of what comes"
      chosen={<ChosenLoading />}
      count="7 looks: 15 own loading components in 12 files, the spin hand-rolled at 16 sites in 12 files, “Loading…”/“Reading…” words at about 60 sites in 42 files."
    >
      <CensusLook
        name="Spinner and a quiet line"
        uses="3 sites in 3 files"
        places={[
          "apps/web/src/components/zerops/WaitLine.tsx WaitLine",
          "apps/web/src/components/usage/UsageLimits.tsx UsageLimitsSection (under the cards)",
          "apps/web/src/components/zerops/landing/ZeropsLandingShell.tsx ZeropsFrameWait (a sign-in's return)",
          "apps/web/src/components/chat/ConversationPanelStandIn.tsx useConversationPanelStandIn",
          "apps/web/src/components/zerops/landing/ZeropsDeviceLoginWait.tsx ZeropsDeviceLoginWait",
          "apps/web/src/components/zerops/ZeropsOrganizationScope.tsx ZeropsOrganizationWait",
        ]}
      >
        <Specimen label='<WaitLine text="Reading subscription limits…" />'>
          <WaitLine text="Reading subscription limits…" />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="An icon spun by hand (animate-spin)"
        uses="16 sites in 12 files"
        places={[
          "apps/web/src/components/sidebar/DesktopUpdateStatusIcon.tsx DesktopUpdateStatusIcon",
          "apps/web/src/components/files/FileBrowserPanel.tsx RefreshFilesButton",
          "apps/web/src/components/CodePage.tsx CodeChangesToolbar",
          "apps/web/src/components/settings/DiagnosticsSettings.tsx DiagnosticsRefreshButton",
          "apps/web/src/components/settings/SourceControlSettings.tsx EmptySourceControlDiscovery, SourceControlSettingsPanel",
          "apps/web/src/components/settings/ResourceTelemetryDiagnostics.tsx ResourceTelemetryDiagnostics",
          "apps/web/src/components/settings/ProviderInstanceCard.tsx ProviderInstanceCard (loader glyph)",
          "apps/web/src/components/settings/ProviderSettingsPanel.tsx EnvironmentProviderSettings (loader glyph)",
          "apps/web/src/components/settings/SettingsPanels.tsx ArchivedThreadsPanel (loader glyph)",
          "apps/web/src/components/sidebar/SidebarProviderUpdatePill.tsx SidebarProviderUpdatePill (loader glyph)",
          "apps/web/src/components/files/FilePreviewPanel.tsx WorkspaceImagePreview, WorkspaceFilePreviewPanel (loader glyph)",
          "apps/web/src/components/search/ProjectContentSearchDialog.tsx OpenContentSearchDialog (loader glyph + “Searching…”)",
        ]}
      >
        <Specimen
          label='<DesktopUpdateStatusIcon status="checking" isCheckAnimating />'
          source="apps/web/src/components/sidebar/DesktopUpdateStatusIcon.tsx"
        >
          <DesktopUpdateStatusIcon isCheckAnimating status="checking" />
        </Specimen>
        <Specimen
          label="<RefreshFilesButton isPending />"
          source="apps/web/src/components/files/FileBrowserPanel.tsx"
        >
          <RefreshFilesButton isPending onRefresh={() => {}} />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Words alone, no motion"
        uses="about 60 sites in 42 files"
        places={[
          "apps/web/src/components/zerops/ZeropsPanel.tsx ZeropsPanelPlaceholder",
          "apps/web/src/components/chat/ReviewCommentDiffLoading.tsx ReviewCommentDiffLoading",
          "apps/web/src/components/AgentsPanel.tsx WorkflowScriptView",
          "apps/web/src/components/zerops/ZeropsDataTree.tsx renderNodeList",
          "apps/web/src/components/files/FileBrowserPanelState.tsx FileBrowserPanelState",
          "apps/web/src/components/zerops/ZeropsGitPage.tsx Reading",
          "apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx ReviewDiff",
          "apps/web/src/components/chat/ProviderModelPicker.tsx ProviderModelPicker",
          "apps/web/src/components/zerops/SidebarProjectSites.tsx PlaceSection",
        ]}
      >
        <Specimen
          label="<ZeropsPanelPlaceholder />"
          source="apps/web/src/components/zerops/ZeropsPanel.tsx"
        >
          <ZeropsPanelPlaceholder />
        </Specimen>
        <Specimen
          label="<ReviewCommentDiffLoading patch={…} />"
          source="apps/web/src/components/chat/ReviewCommentDiffLoading.tsx"
        >
          <div className="w-[440px]">
            <ReviewCommentDiffLoading patch={PATCH} />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Kit Skeleton shaped like the content"
        uses="5 components in 4 files"
        places={[
          "apps/web/src/components/DiffPanelShell.tsx DiffPanelHeaderSkeleton",
          "apps/web/src/components/DiffPanelShell.tsx DiffPanelLoadingState",
          "apps/web/src/components/settings/SourceControlSettings.tsx SourceControlSectionSkeleton",
          "apps/web/src/components/zerops/vault/VaultPanel.tsx VaultHeld (inline)",
          "apps/web/src/components/zerops/primitives/VerdictPanel.tsx VerdictPanelWaiting (inline)",
        ]}
      >
        <Specimen
          label='<DiffPanelLoadingState label="Loading changes" />'
          source="apps/web/src/components/DiffPanelShell.tsx"
        >
          <StateFrame>
            <DiffPanelLoadingState label="Loading changes" />
          </StateFrame>
        </Specimen>
        <Specimen
          label="<DiffPanelHeaderSkeleton />"
          source="apps/web/src/components/DiffPanelShell.tsx"
        >
          <div className="flex w-[440px] items-center gap-2">
            <DiffPanelHeaderSkeleton />
          </div>
        </Specimen>
        <Specimen
          label='<SourceControlSectionSkeleton title="Version Control" />'
          source="apps/web/src/components/settings/SourceControlSettings.tsx"
        >
          <div className="w-[560px]">
            <SourceControlSectionSkeleton title="Version Control" />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Grey bars drawn without the kit, still"
        uses="6 components in 5 files"
        places={[
          "apps/web/src/components/usage/UsagePage.tsx UsageSummarySkeleton",
          "apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx ReviewSkeleton",
          "apps/web/src/components/zerops/review/ReviewConversation.tsx RemarksSkeleton",
          "apps/web/src/components/zerops/ZeropsToolResultCards.tsx Placeholder",
          "apps/web/src/components/zerops/SidebarZeropsTree.tsx MenuSkeleton",
        ]}
      >
        <Specimen
          label="<UsageSummarySkeleton />"
          source="apps/web/src/components/usage/UsagePage.tsx"
        >
          <UsageSummarySkeleton />
        </Specimen>
        <Specimen
          label="<ReviewSkeleton lines={3} />"
          source="apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx"
        >
          <div className="w-[440px]">
            <ReviewSkeleton lines={3} />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Three still dots"
        uses="2 sites in 1 file"
        places={["apps/web/src/components/zerops/SidebarZeropsTree.tsx MateReplyPending"]}
      >
        <Specimen
          label="<MateReplyPending />"
          source="apps/web/src/components/zerops/SidebarZeropsTree.tsx"
        >
          <MateReplyPending />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Room held empty, nothing drawn"
        uses="4 components in 4 files"
        places={[
          "apps/web/src/components/zerops/ConversationFooterStandIn.tsx ConversationFooterStandIn",
          "apps/web/src/components/chat/ComposerStandIn.tsx ComposerStandInDock",
          "apps/web/src/components/zerops/RouteStandIn.tsx RouteStandIn",
          "apps/web/src/components/chat/ContextWindowMeter.tsx ContextWindowMeterPlaceholder",
        ]}
      >
        <Specimen
          label="<ConversationFooterStandIn />"
          source="apps/web/src/components/zerops/ConversationFooterStandIn.tsx"
        >
          <StateFrame>
            <ConversationFooterStandIn />
          </StateFrame>
        </Specimen>
        <Specimen
          label="<ContextWindowMeterPlaceholder />"
          source="apps/web/src/components/chat/ContextWindowMeter.tsx"
        >
          <span className="inline-flex rounded-md border border-dashed">
            <ContextWindowMeterPlaceholder />
          </span>
        </Specimen>
      </CensusLook>
    </StateCensus>
  );
}

export default defineKitSection({
  id: "home-made-loading",
  title: "Loading",
  purpose:
    "The chosen stand-in in every shape, then every way the app still says something is on its way.",
  group: "Home-made",
  kind: "Feedback",
  source: "apps/web/src/kit/sections/states-loading.tsx",
  render: () => <LoadingCensus />,
});
