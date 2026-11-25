import { GlobeIcon } from "lucide-react";

import { StepNumber, type StepNumberState } from "~/components/ui/step-number";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { variantsOf } from "../specimenLabel";

const STATES = variantsOf<StepNumberState>({
  todo: true,
  busy: true,
  done: true,
  attention: true,
  failed: true,
});

function StepNumberSpecimens() {
  return (
    <SpecimenGrid>
      {STATES.map((state) => (
        <Specimen key={state} label={`state="${state}"`}>
          <StepNumber n={2} state={state} />
        </Specimen>
      ))}
      <Specimen label="icon, a place">
        <StepNumber icon={<GlobeIcon />} n={2} />
      </Specimen>
      <Specimen label="before a step's words">
        <span className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-3 text-body">
          <StepNumber n={1} state="done" />
          <span className="text-muted-foreground">Opened OpenAI's page</span>
          <StepNumber n={2} />
          <span>Type this code on OpenAI's page.</span>
        </span>
      </Specimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "step-number",
  title: "StepNumber",
  purpose:
    "A numbered step's mark in a list of what the person does or a press will do: its number or icon, busy, done, attention, or failed.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/step-number.tsx",
  render: () => <StepNumberSpecimens />,
});
