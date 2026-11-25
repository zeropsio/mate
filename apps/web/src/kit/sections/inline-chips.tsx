import { SkillChip } from "~/components/chat/SkillInlineText";
import { TerminalContextInlineChip } from "~/components/chat/TerminalContextInlineChip";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

export default defineKitSection({
  id: "inline-chips",
  title: "Inline chips",
  purpose:
    "A thing named inside text — terminal lines, a table, a skill — sized in em, so it scales with the words it sits in.",
  group: "Chosen",
  kind: "Labels",
  source: "apps/web/src/components/composerInlineChip.ts",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="Sized in em, so they scale with the words they sit in."
        title="Terminal lines, tables and skills"
      >
        <SpecimenGrid size="md">
          <Specimen label={specimenLabel({ label: "zsh 12–40" })} note="Terminal lines">
            <TerminalContextInlineChip label="zsh 12–40" tooltipText="Terminal lines 12–40" />
          </Specimen>
          <Specimen label={specimenLabel({ kind: "data", label: "users" })} note="A table">
            <TerminalContextInlineChip kind="data" label="users" tooltipText="Table users" />
          </Specimen>
          <Specimen label={specimenLabel({ expired: true })} note="Lines that are gone">
            <TerminalContextInlineChip expired label="zsh 12–40" tooltipText="Expired" />
          </Specimen>
          <Specimen label="<SkillChip>" note="A skill">
            <SkillChip rawText="$deploy" skill={{ name: "deploy", displayName: "Deploy" }} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
