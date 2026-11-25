import type { CSSProperties } from "react";
import { GlobeIcon } from "lucide-react";

import { StepNumber, type StepNumberState, type StepNumberTone } from "~/components/ui/step-number";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<StepNumberTone>({ muted: true, tint: true, annotation: true });

const TONE_NOTE: Readonly<Record<StepNumberTone, string>> = {
  muted: "A step still to come",
  tint: "In the hue of whose steps they are",
  annotation: "A picture note's number, by its pin",
};

const STATES = variantsOf<StepNumberState>({
  todo: true,
  current: true,
  busy: true,
  done: true,
  attention: true,
  failed: true,
});

function StepNumberSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock title="States">
        <SpecimenGrid>
          {STATES.map((state) => (
            <Specimen key={state} label={`state="${state}"`}>
              <StepNumber n={2} state={state} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A step still to come, coloured by whose steps they are." title="Tones">
        <SpecimenGrid>
          {TONES.map((tone) => (
            <Specimen key={tone} label={`tone="${tone}"`} note={TONE_NOTE[tone]}>
              <span
                className="flex items-center gap-2"
                style={{ "--step-tint": "var(--zerops-mate-tint-violet)" } as CSSProperties}
              >
                <StepNumber n={1} tone={tone} />
                <StepNumber n={2} size="sm" tone={tone} />
              </span>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Icons and steps">
        <SpecimenGrid size="md">
          <Specimen label='size="sm"' note="Steps said in a line of words">
            <span className="flex items-center gap-2 text-line">
              <StepNumber n={1} size="sm" />
              Add the record
              <StepNumber n={2} size="sm" />
              Wait for it to answer
            </span>
          </Specimen>
          <Specimen label="icon={<GlobeIcon />}" note="A place instead of a number">
            <StepNumber icon={<GlobeIcon />} n={2} />
          </Specimen>
          <Specimen
            label='state="done" · state="current" · (defaults)'
            note="Before each step's words"
          >
            <span className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-3 text-body">
              <StepNumber n={1} state="done" />
              <span className="text-muted-foreground">Opened OpenAI's page</span>
              <StepNumber n={2} state="current" />
              <span>Type this code on OpenAI's page.</span>
              <StepNumber n={3} />
              <span className="text-muted-foreground">Come back here</span>
            </span>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "step-number",
  title: "StepNumber",
  purpose:
    "A numbered step's mark in a list of what the person does or a press will do: its number or icon, the one now, busy, done, attention, or failed; a picture note's number.",
  group: "Kit",
  kind: "Labels",
  source: "apps/web/src/components/ui/step-number.tsx",
  render: () => <StepNumberSpecimens />,
});
