import { ArchiveRestoreIcon } from "lucide-react";

import { ComposerPlaceLine } from "~/components/chat/ComposerPlace";
import { ComposerPrimaryActions } from "~/components/chat/ComposerPrimaryActions";
import { MessageCopyButton } from "~/components/chat/MessageCopyButton";
import { ProviderAccentColorPicker } from "~/components/settings/ProviderAccentColorPicker";
import { SettingResetButton } from "~/components/settings/settingsLayout";
import { SidebarCreateButton } from "~/components/sidebar/SidebarChrome";
import { DrillButton } from "~/components/usage/UsageDimensionViews";
import { CopyButton } from "~/components/zerops/addresses/AddressesSheetBits";
import { CrewPress, CrewTextButton } from "~/components/zerops/crew/CrewParts";
import { CardMateLiftActions } from "~/components/zerops/projects/ProjectCards";
import { SidebarJumpButton } from "~/components/zerops/SidebarJumpButton";
import { SidebarScopeButton } from "~/components/zerops/SidebarScopeButton";

import { CensusComponent, CensusCount, CensusLook, CensusLooks } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const CREW_PARTS = "apps/web/src/components/zerops/crew/CrewParts.tsx";
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
        components={18}
        files={164}
        kit="321 raw <button> in 148 files draw their own; the kit has Button with 13 variants and 14 sizes, rendered in 167 files"
        looks={18}
      />

      <CensusLook
        files={5}
        name="SettingResetButton"
        note="the kit's Button, icon-micro ghost-muted, in a tooltip"
        source="apps/web/src/components/settings/settingsLayout.tsx"
        uses={30}
      >
        <Specimen label={specimenLabel({ label: "Reset to default" })}>
          <SettingResetButton label="Reset to default" onClick={noop} />
        </Specimen>
        <Specimen label={specimenLabel({ label: "Reset to default", disabled: true })}>
          <SettingResetButton disabled label="Reset to default" onClick={noop} />
        </Specimen>
      </CensusLook>

      <CensusLook
        files={19}
        name="Text-link buttons"
        note="a word that underlines on hover; each sets its own colour and weight"
        uses={29}
      >
        <CensusComponent name="CrewTextButton" source={CREW_PARTS}>
          <Specimen label={specimenLabel({ label: "Change", line: "Change the goal" })}>
            <CrewTextButton label="Change" line="Change the goal" onPress={noop} />
          </Specimen>
        </CensusComponent>
        <CensusComponent
          name="ComposerPlaceLine (its action)"
          source="apps/web/src/components/chat/ComposerPlace.tsx"
        >
          <Specimen label='notice with action "Restore"'>
            <div className="w-[34rem]">
              <ComposerPlaceLine
                notice={{
                  id: "archived",
                  icon: <ArchiveRestoreIcon />,
                  words: <strong>This conversation is archived.</strong>,
                  action: { label: "Restore", onAction: noop },
                }}
              />
            </div>
          </Specimen>
        </CensusComponent>
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
        files={2}
        name="CopyButton"
        note="the kit's Button, icon-xs ghost-muted, with its own copied state"
        source="apps/web/src/components/zerops/addresses/AddressesSheetBits.tsx"
        uses={4}
      >
        <Specimen label={specimenLabel({ value: "storefront.zerops.app" })}>
          <CopyButton value="storefront.zerops.app" />
        </Specimen>
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
        name="MessageCopyButton"
        note="the kit's Button with its own toast"
        source="apps/web/src/components/chat/MessageCopyButton.tsx"
        uses={2}
      >
        {(["secondary", "ghost"] as const).flatMap((variant) =>
          (["sm", "icon-sm"] as const).map((size) => (
            <Specimen key={`${variant}-${size}`} label={specimenLabel({ variant, size })}>
              <MessageCopyButton size={size} text="Deployed." variant={variant} />
            </Specimen>
          )),
        )}
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
