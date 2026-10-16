import { ComposerPrimaryActions } from "~/components/chat/ComposerPrimaryActions";
import { ProviderAccentColorPicker } from "~/components/settings/ProviderAccentColorPicker";
import { SidebarCreateButton } from "~/components/sidebar/SidebarChrome";
import { DrillButton } from "~/components/usage/UsageDimensionViews";
import { SidebarJumpButton } from "~/components/zerops/SidebarJumpButton";
import { SidebarScopeButton } from "~/components/zerops/SidebarScopeButton";

import { CensusComponent, CensusCount, CensusLook, CensusLooks } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const noop = () => {};

/** The send button's props at rest: a prompt typed, nothing running. */
const SEND_AT_REST = {
  compact: false,
  pendingAction: null,
  isRunning: false,
  showPlanFollowUpPrompt: false,
  promptHasText: true,
  isSendBusy: false,
  sendDisabledReason: null,
  isConnecting: false,
  isEnvironmentUnavailable: false,
  isPreparingWorktree: false,
  hasSendableContent: true,
  onPreviousPendingQuestion: noop,
  onInterrupt: noop,
  onImplementPlanInNewThread: noop,
} as const;

function ActionSpecimens() {
  return (
    <CensusLooks>
      <CensusCount
        components={6}
        files={7}
        kit="286 raw <button> in 161 files remain, most of them rows and toggles; the kit has Button with 5 variants and 5 sizes, rendered in 183 files"
        looks={4}
      />

      <CensusLook
        files={1}
        name="Text-link buttons"
        note="a word that underlines on hover in its own colour, beside the kit's InlineButton"
        uses={3}
      >
        <CensusComponent
          name="DrillButton"
          source="apps/web/src/components/usage/UsageDimensionViews.tsx"
        >
          <Specimen label={specimenLabel({ label: "Narrow to storefront" })}>
            <DrillButton label="Narrow to storefront" onDrill={noop}>
              storefront
            </DrillButton>
          </Specimen>
        </CensusComponent>
      </CensusLook>

      <CensusLook
        files={4}
        name="Menu round buttons"
        note="menu-round-button: the left menu's top row"
        uses={5}
      >
        <CensusComponent
          name="SidebarScopeButton"
          source="apps/web/src/components/zerops/SidebarScopeButton.tsx"
        >
          {(["mine", "everyone"] as const).map((scope) => (
            <Specimen key={scope} label={specimenLabel({ scope })}>
              <SidebarScopeButton onScope={noop} scope={scope} />
            </Specimen>
          ))}
        </CensusComponent>
        <CensusComponent
          name="SidebarJumpButton"
          source="apps/web/src/components/zerops/SidebarJumpButton.tsx"
        >
          <Specimen label={specimenLabel({ shortcut: "⌘K" })}>
            <SidebarJumpButton onJump={noop} shortcut="⌘K" />
          </Specimen>
        </CensusComponent>
        <CensusComponent
          name="SidebarCreateButton"
          source="apps/web/src/components/sidebar/SidebarChrome.tsx"
        >
          <Specimen label="projects={[storefront]}">
            <SidebarCreateButton
              onNewMate={noop}
              onNewProject={noop}
              projects={[{ id: "storefront", name: "storefront" }]}
            />
          </Specimen>
        </CensusComponent>
      </CensusLook>

      <CensusLook
        files={1}
        name="ComposerPrimaryActions (send)"
        note="a round message-action button of its own"
        source="apps/web/src/components/chat/ComposerPrimaryActions.tsx"
        uses={3}
      >
        <Specimen label="a prompt typed">
          <ComposerPrimaryActions {...SEND_AT_REST} />
        </Specimen>
        <Specimen label={specimenLabel({ isRunning: true })}>
          <ComposerPrimaryActions {...SEND_AT_REST} isRunning />
        </Specimen>
        <Specimen label={specimenLabel({ compact: true })}>
          <ComposerPrimaryActions {...SEND_AT_REST} compact />
        </Specimen>
      </CensusLook>

      <CensusLook
        files={1}
        name="Colour swatches"
        note="round buttons, one per colour"
        source="apps/web/src/components/settings/ProviderAccentColorPicker.tsx"
        uses={1}
      >
        <Specimen label={specimenLabel({ displayName: "Codex", value: undefined })}>
          <ProviderAccentColorPicker displayName="Codex" onCommit={noop} value={undefined} />
        </Specimen>
      </CensusLook>
    </CensusLooks>
  );
}

export default defineKitSection({
  id: "home-made-actions",
  title: "Home-made actions",
  purpose: "Buttons features built for themselves instead of the kit's Button.",
  group: "Home-made",
  kind: "Actions",
  source: "apps/web/src/components",
  render: () => <ActionSpecimens />,
});
