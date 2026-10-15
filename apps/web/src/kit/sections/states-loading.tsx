import { ReviewCommentDiffLoading } from "~/components/chat/ReviewCommentDiffLoading";
import { ContextWindowMeterPlaceholder } from "~/components/chat/ContextWindowMeter";
import { DiffPanelHeaderSkeleton, DiffPanelLoadingState } from "~/components/DiffPanelShell";
import { RefreshFilesButton } from "~/components/files/FileBrowserPanel";
import { SourceControlSectionSkeleton } from "~/components/settings/SourceControlSettings";
import { DesktopUpdateStatusIcon } from "~/components/sidebar/DesktopUpdateStatusIcon";
import { SurfaceLoading } from "~/components/SurfaceLoading";
import { UsageSummarySkeleton } from "~/components/usage/UsagePage";
import { ConversationFooterStandIn } from "~/components/zerops/ConversationFooterStandIn";
import { ReviewSkeleton } from "~/components/zerops/review/ZeropsReviewSurface";
import { MateReplyPending } from "~/components/zerops/SidebarZeropsTree";
import { WaitLine } from "~/components/zerops/WaitLine";
import { ZeropsPanelPlaceholder } from "~/components/zerops/ZeropsPanel";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { CensusLook, StateCensus, StateFrame } from "../states/Census";

const PATCH = `@@ -12,7 +12,7 @@
-  const port = 3000;
+  const port = Number(process.env.PORT ?? 3000);`;

function LoadingCensus() {
  return (
    <StateCensus
      atom="Spinner for a wait with no end, Skeleton for content on its way"
      count="7 looks: 17 own loading components in 13 files, the spin hand-rolled at 16 sites in 12 files, “Loading…”/“Reading…” words at 72 sites in 48 files; Spinner is imported in 22 files, Skeleton in 4."
    >
      <CensusLook
        name="Spinner and a quiet line"
        uses="about 50 sites in 30 files"
        places={[
          "apps/web/src/components/zerops/WaitLine.tsx:14 WaitLine",
          "apps/web/src/components/zerops/WaitLine.tsx:29 PageWaitLine (19 uses)",
          "apps/web/src/components/SurfaceLoading.tsx:10 SurfaceLoading (20 uses)",
          "apps/web/src/components/SurfaceLoading.tsx:25 RoutePending",
          "apps/web/src/components/chat/ConversationPanelStandIn.tsx:28 useConversationPanelStandIn",
          "apps/web/src/components/zerops/landing/ZeropsDeviceLoginWait.tsx:36",
          "apps/web/src/components/zerops/landing/ZeropsLandingShell.tsx:191",
          "apps/web/src/components/zerops/ZeropsOrganizationScope.tsx:34",
          "apps/web/src/routes/_chat.tsx:134 ChatRoutePending",
          "apps/web/src/routes/_chat.$environmentId.$threadId.tsx:29 ChatThreadRoutePending",
        ]}
      >
        <Specimen label='<WaitLine text="Reading your projects…" />'>
          <WaitLine text="Reading your projects…" />
        </Specimen>
        <Specimen label="<SurfaceLoading />" source="apps/web/src/components/SurfaceLoading.tsx">
          <StateFrame>
            <SurfaceLoading />
          </StateFrame>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="An icon spun by hand (animate-spin)"
        uses="16 sites in 12 files"
        places={[
          "apps/web/src/components/sidebar/DesktopUpdateStatusIcon.tsx:122",
          "apps/web/src/components/files/FileBrowserPanel.tsx:68",
          "apps/web/src/components/DiffPanel.tsx:812",
          "apps/web/src/components/settings/DiagnosticsSettings.tsx:747",
          "apps/web/src/components/settings/SourceControlSettings.tsx:487, :532",
          "apps/web/src/components/settings/ResourceTelemetryDiagnostics.tsx:964, :1076, :1214",
          "apps/web/src/components/settings/ProviderInstanceCard.tsx:750 (loader glyph)",
          "apps/web/src/components/settings/ProviderSettingsPanel.tsx:1002 (loader glyph)",
          "apps/web/src/components/settings/SettingsPanels.tsx:2672 (loader glyph)",
          "apps/web/src/components/sidebar/SidebarProviderUpdatePill.tsx:181 (loader glyph)",
          "apps/web/src/components/files/FilePreviewPanel.tsx:166, :996 (loader glyph)",
          "apps/web/src/components/search/ProjectContentSearchDialog.tsx:229 (loader glyph + “Searching…”)",
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
        uses="72 sites in 48 files"
        places={[
          "apps/web/src/components/zerops/ZeropsPanel.tsx:319 ZeropsPanelPlaceholder",
          "apps/web/src/components/chat/ReviewCommentDiffLoading.tsx:1 ReviewCommentDiffLoading",
          "apps/web/src/components/settings/DiagnosticsSettings.tsx:158 EmptyRows (“Loading …”)",
          "apps/web/src/components/zerops/addresses/AddressesSheetBits.tsx:120 SheetEmpty (“Reading…”)",
          "apps/web/src/components/AgentsPanel.tsx:339",
          "apps/web/src/components/zerops/ZeropsDataTree.tsx:115",
          "apps/web/src/components/files/FileBrowserPanelState.tsx:44",
          "apps/web/src/components/zerops/ZeropsGitPage.tsx:34",
          "apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx:616",
          "apps/web/src/components/settings/TeamSettings.tsx:82",
          "apps/web/src/components/settings/TeamMemberPage.tsx:180, :325",
          "apps/web/src/components/chat/ProviderModelPicker.tsx:263",
          "apps/web/src/components/zerops/SidebarProjectSites.tsx:703",
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
        uses="5 components in 3 files"
        places={[
          "apps/web/src/components/DiffPanelShell.tsx:49 DiffPanelHeaderSkeleton",
          "apps/web/src/components/DiffPanelShell.tsx:102 DiffPanelLoadingState",
          "apps/web/src/components/settings/SourceControlSettings.tsx:414 SourceControlSectionSkeleton",
          "apps/web/src/components/zerops/vault/VaultPanel.tsx:329 (inline)",
          "apps/web/src/components/zerops/ZeropsServiceMap.tsx:295, :308 (inline)",
          "apps/web/src/components/zerops/primitives/VerdictPanel.tsx:101 (inline)",
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
          "apps/web/src/components/usage/UsagePage.tsx:1190 UsageSummarySkeleton",
          "apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx:445 ReviewSkeleton",
          "apps/web/src/components/zerops/review/ReviewConversation.tsx:149 RemarksSkeleton",
          "apps/web/src/components/zerops/ZeropsToolResultCards.tsx:21 Placeholder",
          "apps/web/src/components/zerops/SidebarZeropsTree.tsx:2447 MenuSkeleton",
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
        places={["apps/web/src/components/zerops/SidebarZeropsTree.tsx:4564 MateReplyPending"]}
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
          "apps/web/src/components/zerops/ConversationFooterStandIn.tsx:9 ConversationFooterStandIn",
          "apps/web/src/components/chat/ComposerStandIn.tsx:15 ComposerStandInDock",
          "apps/web/src/components/zerops/RouteStandIn.tsx:12 RouteStandIn",
          "apps/web/src/components/chat/ContextWindowMeter.tsx:166 ContextWindowMeterPlaceholder",
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
    "Every way the app says something is on its way, side by side, to pick one pattern from.",
  group: "Home-made",
  kind: "Feedback",
  source: "apps/web/src/kit/sections/states-loading.tsx",
  render: () => <LoadingCensus />,
});
