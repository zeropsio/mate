import { ProviderInstanceId } from "@t3tools/contracts";

import { HelperMark, StatusDot as HelperStatusDot } from "~/components/AgentsPanel";
import { AvailabilityDot } from "~/components/chat/AgentAvailability";
import { ComposerStashBadge } from "~/components/chat/ComposerStashBadge";
import { ComposerTasksBadge } from "~/components/chat/ComposerTasksBadge";
import { SkillChip } from "~/components/chat/SkillInlineText";
import { TerminalContextInlineChip } from "~/components/chat/TerminalContextInlineChip";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "~/components/ConnectionStatusDot";
import { CommandPaletteMetaDot } from "~/components/ThreadCommandSubtitle";
import { MateDot } from "~/components/zerops/MateDot";
import { MateFace } from "~/components/zerops/primitives";
import { PlaceDot } from "~/components/zerops/projects/ProjectCards";
import { EnvDot } from "~/components/zerops/SidebarProductionChip";
import { UrlChip } from "~/components/zerops/ZeropsOperationCard";

import { CensusComponent, CensusCount, CensusLook, CensusLooks } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const HELPER_STATUSES = ["running", "waiting", "idle", "completed", "failed", "cancelled"] as const;
const AGENTS_PANEL = "apps/web/src/components/AgentsPanel.tsx";

function LabelSpecimens() {
  return (
    <CensusLooks>
      <CensusCount
        components={13}
        files={14}
        kit="the kit has Badge with 5 tones and a dot form, rendered in 30 files"
        looks={6}
      />

      <CensusLook files={1} name="8 px status dots" note="a dot with a ping, no word" uses={1}>
        <CensusComponent
          name="ConnectionStatusDot"
          source="apps/web/src/components/ConnectionStatusDot.tsx"
        >
          {(["connected", "reconnecting", "error", "offline"] as const).map((phase) => (
            <Specimen key={phase} label={`phase "${phase}"`}>
              <ConnectionStatusDot
                dotClassName={connectionPhaseDotClassName(phase)}
                pingClassName={connectionPhasePingClassName(phase)}
              />
            </Specimen>
          ))}
        </CensusComponent>
      </CensusLook>

      <CensusLook files={6} name="6 px bare dots" note="a state's colour with no word" uses={12}>
        <CensusComponent
          name="AvailabilityDot"
          source="apps/web/src/components/chat/AgentAvailability.tsx"
        >
          {(["warning", "error"] as const).map((tone) => (
            <Specimen key={tone} label={`availability tone "${tone}"`}>
              <AvailabilityDot
                availability={{
                  instanceId: ProviderInstanceId.make("codex"),
                  tone,
                  title: tone === "error" ? "Signed out" : "Usage limit near",
                  message: null,
                  setup: false,
                }}
              />
            </Specimen>
          ))}
        </CensusComponent>
        <CensusComponent name="StatusDot (a helper's)" source={AGENTS_PANEL}>
          {HELPER_STATUSES.map((status) => (
            <Specimen key={status} label={specimenLabel({ status })}>
              <HelperStatusDot status={status} />
            </Specimen>
          ))}
        </CensusComponent>
        <CensusComponent name="HelperMark" source={AGENTS_PANEL}>
          {HELPER_STATUSES.map((status) => (
            <Specimen key={status} label={specimenLabel({ status })}>
              <HelperMark status={status} />
            </Specimen>
          ))}
        </CensusComponent>
        <CensusComponent
          name="CommandPaletteMetaDot"
          source="apps/web/src/components/ThreadCommandSubtitle.tsx"
        >
          <Specimen label="between two words">
            <span className="flex items-center gap-1 text-xs">
              main
              <CommandPaletteMetaDot />
              2m
            </span>
          </Specimen>
        </CensusComponent>
      </CensusLook>

      <CensusLook
        files={8}
        name="Dots drawn by a CSS class"
        note="menu-dot, ov-dot, zerops-envdot in index.css"
        uses={11}
      >
        <CensusComponent name="MateDot" source="apps/web/src/components/zerops/MateDot.tsx">
          {(["attention", "unread", "failed", "working"] as const).map((tone) => (
            <Specimen key={tone} label={specimenLabel({ tone, place: "inline", tint: "sky" })}>
              <MateDot place="inline" tint="sky" tone={tone} />
            </Specimen>
          ))}
          <Specimen label={`${specimenLabel({ tone: "attention", place: "corner" })} on a face`}>
            <span className="relative flex">
              <MateFace className="size-9" size={32} state="needs" tint="sky" />
              <MateDot place="corner" tone="attention" />
            </span>
          </Specimen>
        </CensusComponent>
        <CensusComponent
          name="PlaceDot"
          source="apps/web/src/components/zerops/projects/ProjectCards.tsx"
        >
          {(["running", "failed", "down", "releasing", "none", "unknown"] as const).map((dot) => (
            <Specimen key={dot} label={specimenLabel({ dot })}>
              <PlaceDot dot={dot} />
            </Specimen>
          ))}
        </CensusComponent>
        <CensusComponent
          name="EnvDot"
          source="apps/web/src/components/zerops/SidebarProductionChip.tsx"
        >
          {(["ok", "attention", "failed", "off", "hollow", "spinner"] as const).map((dot) => (
            <Specimen key={dot} label={specimenLabel({ dot })}>
              <EnvDot dot={dot} />
            </Specimen>
          ))}
        </CensusComponent>
      </CensusLook>

      <CensusLook files={1} name="Counters" note="a count on the composer's shoulder" uses={4}>
        <CensusComponent
          name="ComposerTasksBadge"
          source="apps/web/src/components/chat/ComposerTasksBadge.tsx"
        >
          {(["inline", "tab"] as const).map((placement) => (
            <Specimen key={placement} label={specimenLabel({ placement })}>
              <ComposerTasksBadge
                expanded={false}
                onDismiss={() => {}}
                onToggle={() => {}}
                placement={placement}
                progress={{ step: "Run the tests", completedSteps: 2, totalSteps: 4 }}
                steps={[
                  { step: "Read the service", status: "completed" },
                  { step: "Write the fix", status: "completed" },
                  { step: "Run the tests", status: "inProgress" },
                  { step: "Deploy", status: "pending" },
                ]}
              />
            </Specimen>
          ))}
        </CensusComponent>
        <CensusComponent
          name="ComposerStashBadge"
          source="apps/web/src/components/chat/ComposerStashBadge.tsx"
        >
          {(["inline", "tab"] as const).map((placement) => (
            <Specimen key={placement} label={specimenLabel({ placement, count: 3 })}>
              <ComposerStashBadge
                count={3}
                menuOpen={false}
                onToggleMenu={() => {}}
                placement={placement}
                pulseKey={0}
                pulsing={false}
              />
            </Specimen>
          ))}
        </CensusComponent>
      </CensusLook>

      <CensusLook files={3} name="Inline chips" note="a thing named inside text" uses={3}>
        <CensusComponent
          name="TerminalContextInlineChip"
          source="apps/web/src/components/chat/TerminalContextInlineChip.tsx"
        >
          <Specimen label={specimenLabel({ label: "zsh 12–40" })}>
            <TerminalContextInlineChip label="zsh 12–40" tooltipText="Terminal lines 12–40" />
          </Specimen>
          <Specimen label={specimenLabel({ kind: "data", label: "users" })}>
            <TerminalContextInlineChip kind="data" label="users" tooltipText="Table users" />
          </Specimen>
          <Specimen label={specimenLabel({ expired: true })}>
            <TerminalContextInlineChip expired label="zsh 12–40" tooltipText="Expired" />
          </Specimen>
        </CensusComponent>
        <CensusComponent name="SkillChip" source="apps/web/src/components/chat/SkillInlineText.tsx">
          <Specimen label='skill "Deploy"'>
            <SkillChip rawText="$deploy" skill={{ name: "deploy", displayName: "Deploy" }} />
          </Specimen>
        </CensusComponent>
      </CensusLook>

      <CensusLook
        files={1}
        name="UrlChip"
        note="an address as a tinted link chip"
        source="apps/web/src/components/zerops/ZeropsOperationCard.tsx"
        uses={1}
      >
        <Specimen label={specimenLabel({ label: "storefront.zerops.app" })}>
          <UrlChip label="storefront.zerops.app" url="https://storefront.zerops.app" />
        </Specimen>
      </CensusLook>
    </CensusLooks>
  );
}

export default defineKitSection({
  id: "home-made-labels",
  title: "Home-made labels",
  purpose:
    "Pills, tags, chips, counters and status dots features drew for themselves instead of Badge.",
  group: "Home-made",
  kind: "Labels",
  source: "apps/web/src/components",
  render: () => <LabelSpecimens />,
});
