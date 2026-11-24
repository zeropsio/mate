import { SkillChip } from "~/components/chat/SkillInlineText";
import { TerminalContextInlineChip } from "~/components/chat/TerminalContextInlineChip";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
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
    <SpecimenGrid>
      <Specimen label={specimenLabel({ label: "zsh 12–40" })}>
        <TerminalContextInlineChip label="zsh 12–40" tooltipText="Terminal lines 12–40" />
      </Specimen>
      <Specimen label={specimenLabel({ kind: "data", label: "users" })}>
        <TerminalContextInlineChip kind="data" label="users" tooltipText="Table users" />
      </Specimen>
      <Specimen label={specimenLabel({ expired: true })}>
        <TerminalContextInlineChip expired label="zsh 12–40" tooltipText="Expired" />
      </Specimen>
      <Specimen label='skill "Deploy"'>
        <SkillChip rawText="$deploy" skill={{ name: "deploy", displayName: "Deploy" }} />
      </Specimen>
    </SpecimenGrid>
  ),
});
