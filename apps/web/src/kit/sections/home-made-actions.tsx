import { ComposerPrimaryActions } from "~/components/chat/ComposerPrimaryActions";
import { ProviderAccentColorPicker } from "~/components/settings/ProviderAccentColorPicker";
import { DrillButton } from "~/components/usage/UsageDimensionViews";

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
  away: null,
  unavailableAgentName: null,
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
        components={3}
        files={3}
        kit="258 raw <button> in 144 files remain outside the kit and the harnesses, most of them rows, toggles and glyph presses under 24 px; the kit has Button with 8 variants and 7 sizes, rendered in 291 files"
        looks={3}
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
        files={1}
        name="ComposerPrimaryActions (send)"
        note="the send: a round press in the message-action ink, which no Button variant carries; the stop beside it is a kit Button"
        source="apps/web/src/components/chat/ComposerPrimaryActions.tsx"
        uses={1}
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
