import { setupFailureReason, type MateComing } from "@t3tools/client-runtime/data";
import { PlugZapIcon } from "lucide-react";

import { ComposerBannerStack } from "~/components/chat/ComposerBannerStack";
import { ErrorLine } from "~/components/chat/ConversationRows";
import { FileReadFailure } from "~/components/files/FilePreviewPanel";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { stackedThreadToast } from "~/components/ui/toastHelpers";
import { ChiefStage } from "~/components/zerops/chief/ChiefPage";
import { ZeropsHandoverFailed } from "~/components/zerops/landing/ZeropsHandoverFailed";
import { FormError } from "~/components/zerops/landing/ZeropsLandingShell";
import { MateDetailFailure } from "~/components/zerops/MateDetailFailure";
import { ReviewFailed } from "~/components/zerops/review/ZeropsReviewSurface";
import { ZeropsEnvironmentCreation } from "~/components/zerops/ZeropsEnvironmentCreation";
import { FieldError } from "~/components/zerops/ZeropsEnvironmentCreationDialog";
import { ComingBelow } from "~/components/zerops/ZeropsMateComingPage";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { ZeropsOperationCard } from "~/components/zerops/ZeropsOperationCard";
import { ZeropsReadFailure } from "~/components/zerops/ZeropsReadFailure";
import { ZeropsDataStartupFailure } from "~/zerops/ZeropsAccountEnvironmentProvider";
import { comingSentenceOf } from "~/zerops/mateNoticeVoice";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { CensusLook, StateCensus, StateFrame, useKitNowMs } from "../states/Census";
import {
  failedBirthProgress,
  failedCreationProgress,
  showcaseOperation,
  WREN,
  YOU,
} from "../states/fixtures";

/** A Mate whose container never came: the stage, its stopped steps, *Try again* and *Remove*. */
function NotCreatedStage() {
  const nowMs = useKitNowMs();
  const progress = failedBirthProgress(nowMs);
  const failure = setupFailureReason(WREN.name, "CommandExec: init command failed", [
    "curl: (6) Could not resolve host: zerops.io",
    "zcp init: command not found (exit 127)",
  ]);
  const coming: MateComing = { kind: "failed", line: failure.text, verb: "try-again" };
  return (
    <MateEmptyStateView
      coming={{
        kind: "failed",
        sentence: comingSentenceOf({ coming, progress, nowMs }),
        below: (
          <ComingBelow
            coming={coming}
            mate={WREN}
            nowMs={nowMs}
            onRemove={() => {}}
            onTryAgain={() => {}}
            progress={progress}
            setupFailureDetails={{
              details: failure.details,
              status: "ended",
              retrying: false,
              projectUrl: "https://app.zerops.io/project/kit",
              process: {
                id: "kit-dns",
                projectId: "kit",
                status: "FAILED",
                actionName: "stack.create",
                serviceStackIds: ["zcp"],
                created: new Date(nowMs - 136_000).toISOString(),
              },
            }}
            you={YOU}
          />
        ),
      }}
      mate={WREN}
      phase={null}
      signIn={null}
      signInRequired={false}
      unknown={null}
    />
  );
}

function FailedOperation() {
  const operation = showcaseOperation("failed");
  if (operation === null) return null;
  return (
    <div className="w-[560px]">
      <ZeropsOperationCard operation={operation} />
    </div>
  );
}

const REFUSED_NOTICE = {
  id: "refused",
  variant: "error",
  layout: "centered",
  icon: <PlugZapIcon />,
  title: "Couldn't connect to Fen",
  description: "Fen refused the connection.",
  actions: (
    <Button size="xs" variant="pill">
      Try again
    </Button>
  ),
} as const;

function FailureCensus() {
  return (
    <StateCensus
      atom="Alert inline, toast for a failed action"
      count="9 looks: about 35 own failure components in 30 files, role=alert at 83 sites in 57 files, 115 error toasts in 37 files; the kit Alert is used in 5 files."
    >
      <CensusLook
        name="Whole page: mark, title, reason, Try again"
        uses="5 components in 5 files"
        places={[
          "apps/web/src/components/zerops/landing/ZeropsHandoverFailed.tsx:11 ZeropsHandoverFailed",
          "apps/web/src/components/zerops/landing/ZeropsAppFailed.tsx:10 ZeropsAppFailed",
          "apps/web/src/routes/__root.tsx:497 RootRouteErrorView",
          "apps/web/src/routes/_chat.index.tsx:293 DraftStartError",
          "apps/web/src/zerops/ZeropsAccountEnvironmentProvider.tsx:168 ZeropsDataStartupFailure",
        ]}
      >
        <Specimen
          label='<ZeropsHandoverFailed message="The sign-in code expired." />'
          source="apps/web/src/components/zerops/landing/ZeropsHandoverFailed.tsx"
        >
          <StateFrame size="page">
            <ZeropsHandoverFailed
              message="The sign-in code expired before it reached Mate."
              onBack={() => {}}
              onRetry={() => {}}
            />
          </StateFrame>
        </Specimen>
        <Specimen
          label="<ZeropsDataStartupFailure message={…} />"
          source="apps/web/src/zerops/ZeropsAccountEnvironmentProvider.tsx"
        >
          <StateFrame>
            <ZeropsDataStartupFailure
              message="The account's projects could not be read."
              retry={() => {}}
              signOut={() => {}}
            />
          </StateFrame>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="A Mate's stage in the danger tone, its steps stopped"
        uses="about 8 sites in 5 files"
        places={[
          "apps/web/src/components/zerops/MateDetailFailure.tsx:6 MateDetailFailure",
          "apps/web/src/components/zerops/ZeropsMateComingPage.tsx:1076 ComingBelow (failed)",
          "apps/web/src/zerops/mateComing.ts:30 (“could not be added”)",
          "apps/web/src/components/zerops/chief/ChiefPage.tsx:107 ChiefStage (failed step)",
          "apps/web/src/components/zerops/MateLinkStage.tsx",
        ]}
      >
        <Specimen
          label="<MateDetailFailure message={…} />"
          source="apps/web/src/components/zerops/MateDetailFailure.tsx"
        >
          <StateFrame size="page">
            <MateDetailFailure
              again={() => {}}
              mate={WREN}
              message="Zerops did not answer within 20 seconds."
            />
          </StateFrame>
        </Specimen>
        <Specimen
          label='<ComingBelow coming={{ kind: "failed" }} /> · not created'
          source="apps/web/src/components/zerops/ZeropsMateComingPage.tsx"
        >
          <StateFrame size="page">
            <NotCreatedStage />
          </StateFrame>
        </Specimen>
        <Specimen
          label='<ChiefStage view={{ setup: { phase: "failed", step: "hq" } }} />'
          source="apps/web/src/components/zerops/chief/ChiefPage.tsx"
        >
          <StateFrame size="page">
            <ChiefStage
              onAgain={() => {}}
              onFinish={() => {}}
              onSetUp={() => {}}
              view={{
                kind: "steps",
                setup: {
                  phase: "failed",
                  step: "hq",
                  birthId: "b1",
                  projectId: "p-chief",
                  reason: "HQ is not answering right now.",
                },
              }}
            />
          </StateFrame>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="A failed step in a step list or card"
        uses="about 6 sites in 4 files"
        places={[
          "apps/web/src/components/zerops/ZeropsEnvironmentCreation.tsx:131 (outcome failed)",
          "apps/web/src/components/zerops/ZeropsOperationCard.tsx:338 FailedBecause",
          "apps/web/src/components/chat/BrowserStrip.tsx:645 FailedTake",
          "apps/web/src/components/chat/RunChat.tsx:1243 FailedMark",
        ]}
      >
        <Specimen
          label='<ZeropsEnvironmentCreation outcome={{ kind: "failed" }} />'
          source="apps/web/src/components/zerops/ZeropsEnvironmentCreation.tsx"
        >
          <div className="w-[480px]">
            <ZeropsEnvironmentCreation
              name="Beviro CRM - production"
              nowMs={31_000}
              onDismiss={() => {}}
              outcome={{
                kind: "failed",
                error: "projectImportProjectIncluded",
                projectExists: true,
              }}
              progress={failedCreationProgress()}
              tier="production"
            />
          </div>
        </Specimen>
        <Specimen
          label='<ZeropsOperationCard operation={phase: "failed"} />'
          source="apps/web/src/components/zerops/ZeropsOperationCard.tsx"
        >
          <FailedOperation />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Muted reason and an outline “again” button"
        uses="6 sites in 5 files"
        places={[
          "apps/web/src/components/zerops/ZeropsReadFailure.tsx:4 ZeropsReadFailure",
          "apps/web/src/components/zerops/ZeropsGroupDetail.tsx:2326 ProjectReadFailures",
        ]}
      >
        <Specimen
          label='<ZeropsReadFailure action="Compare again" />'
          source="apps/web/src/components/zerops/ZeropsReadFailure.tsx"
        >
          <ZeropsReadFailure
            action="Compare again"
            again={() => {}}
            reason="The comparison could not be read: HQ answered 502."
          />
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Warning glyph, words and a text Try again"
        uses="3 sites in 3 files"
        places={[
          "apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx:418 ReviewFailed",
          "apps/web/src/components/chat/ReviewCommentDiff.tsx:11 DiffFailure",
        ]}
      >
        <Specimen
          label='<ReviewFailed what="The files couldn’t be read." />'
          source="apps/web/src/components/zerops/review/ZeropsReviewSurface.tsx"
        >
          <div className="w-[480px]">
            <ReviewFailed
              onRetry={() => {}}
              reason="HQ took too long to answer."
              what="The files couldn't be read."
            />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Red words, centred, in the pane"
        uses="2 sites in 1 file"
        places={["apps/web/src/components/files/FilePreviewPanel.tsx:741 FileReadFailure"]}
      >
        <Specimen
          label="<FileReadFailure failure={…} />"
          source="apps/web/src/components/files/FilePreviewPanel.tsx"
        >
          <StateFrame>
            <FileReadFailure
              failure={{
                message: "This file is no longer there.",
                attemptedPath: "src/routes/checkout.tsx",
                workspaceFolder: "/var/www/appdev",
              }}
              fallback="The file could not be read."
            />
          </StateFrame>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="One line under a field"
        uses="3 components in 3 files"
        places={[
          "apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.tsx:437 FieldError",
          "apps/web/src/components/zerops/ZeropsMoveToGroupDialog.tsx:277 FieldError (a copy)",
          "apps/web/src/components/zerops/landing/ZeropsLandingShell.tsx:144 FormError",
        ]}
      >
        <Specimen
          label="<FieldError>…</FieldError>"
          source="apps/web/src/components/zerops/ZeropsEnvironmentCreationDialog.tsx"
        >
          <FieldError>That name is taken in this organization.</FieldError>
        </Specimen>
        <Specimen
          label='<FormError message="…" />'
          source="apps/web/src/components/zerops/landing/ZeropsLandingShell.tsx"
        >
          <div className="w-[440px]">
            <FormError message="Zerops did not accept the code. Ask for a new one." />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Conversation rows: a notice over the composer, an error line"
        uses="about 10 sites in 6 files"
        places={[
          "apps/web/src/components/chat/ComposerBannerStack.tsx:32 ComposerBannerStack (kit Alert inside)",
          "apps/web/src/components/chat/MateHealthBanner.tsx:5",
          "apps/web/src/components/chat/EnvironmentConnectionBanner.tsx:25, :57",
          "apps/web/src/components/chat/ConversationRows.tsx:533 ErrorLine",
          "apps/web/src/components/chat/MessagesTimeline.tsx:2828 ErrorTimelineRow",
          "apps/web/src/components/chat/RunChat.tsx:2608 NoticeBubble",
        ]}
      >
        <Specimen
          label='<ComposerBannerStack items={[{ variant: "error" }]} />'
          source="apps/web/src/components/chat/ComposerBannerStack.tsx"
        >
          <div className="w-[560px] pt-6">
            <ComposerBannerStack className="relative z-0" items={[REFUSED_NOTICE]} />
          </div>
        </Specimen>
        <Specimen
          label='<ErrorLine label="…" detail="…" />'
          source="apps/web/src/components/chat/ConversationRows.tsx"
        >
          <div className="w-[560px]">
            <ErrorLine
              detail="The provider closed the stream after 3 minutes."
              label="The turn stopped."
              onDismiss={() => {}}
            />
          </div>
        </Specimen>
        <Specimen
          label='<ErrorLine label="…" calm />'
          source="apps/web/src/components/chat/ConversationRows.tsx"
        >
          <div className="w-[560px]">
            <ErrorLine calm label="You've reached the usage limit until 18:00." />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        name="Error toast"
        uses="115 calls in 37 files"
        places={[
          "apps/web/src/components/CommandPalette.tsx (17)",
          "apps/web/src/components/settings/SettingsPanels.tsx (10)",
          "apps/web/src/components/ChatView.tsx (9)",
          "apps/web/src/components/Sidebar.tsx (9)",
          "apps/web/src/components/settings/ProjectSettingsPanel.tsx:355 reportFailure",
          "apps/web/src/components/ui/toastHelpers.ts:31 stackedThreadToast (32 files)",
        ]}
      >
        <Specimen
          label='toastManager.add({ type: "error" })'
          source="apps/web/src/components/Sidebar.tsx"
        >
          <Button
            onClick={() =>
              toastManager.add({
                type: "error",
                title: "Could not create thread",
                description: "The server did not answer.",
              })
            }
            variant="outline"
          >
            Plain error toast
          </Button>
        </Specimen>
        <Specimen
          label='stackedThreadToast({ type: "error" })'
          source="apps/web/src/components/ui/toastHelpers.ts"
        >
          <Button
            onClick={() =>
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to rename thread",
                  description: "An error occurred.",
                }),
              )
            }
            variant="outline"
          >
            Stacked error toast
          </Button>
        </Specimen>
      </CensusLook>
    </StateCensus>
  );
}

export default defineKitSection({
  id: "home-made-failure",
  title: "Failure",
  purpose:
    "Every way the app says something went wrong, and what it offers next, side by side, to pick one pattern from.",
  group: "Home-made",
  kind: "Feedback",
  source: "apps/web/src/kit/sections/states-failure.tsx",
  render: () => <FailureCensus />,
});
