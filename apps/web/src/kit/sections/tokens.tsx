import { MOTION, RADII, SPACING_UNIT, TYPE_SCALE } from "@t3tools/shared/brand";
import { useState } from "react";

import { Button } from "~/components/ui/button";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { TYPE_CLASS } from "../typeSteps";

const SPACING_STEPS = [1, 2, 3, 4, 6, 8] as const;
const SPACING_WIDTH: Readonly<Record<(typeof SPACING_STEPS)[number], string>> = {
  1: "w-1",
  2: "w-2",
  3: "w-3",
  4: "w-4",
  6: "w-6",
  8: "w-8",
};

const DURATION_CLASS: Readonly<Record<keyof typeof MOTION.duration, string>> = {
  quick: "duration-150",
  base: "duration-200",
  slow: "duration-260",
};

/** One duration, shown by moving a square across its track when pressed. */
function MotionSpecimen({ step }: { readonly step: keyof typeof MOTION.duration }) {
  const [moved, setMoved] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={() => {
          setMoved((value) => !value);
        }}
        size="sm"
        variant="secondary"
      >
        Play
      </Button>
      <span className="relative h-6 w-32 rounded-control bg-muted">
        <span
          className={`absolute top-1 left-1 size-4 rounded-mark bg-primary transition-transform ease-out-strong ${DURATION_CLASS[step]} ${moved ? "translate-x-26" : "translate-x-0"}`}
        />
      </span>
    </div>
  );
}

function TokenSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="One scale, each step with its size and line height." title="Type">
        <SpecimenGrid size="xl">
          {Object.entries(TYPE_SCALE).map(([step, { fontSize, lineHeight }]) => (
            <Specimen align="start" key={step} label={`text-${step} · ${fontSize}/${lineHeight}`}>
              <span className={TYPE_CLASS[step as keyof typeof TYPE_SCALE]}>
                Fen deployed the storefront
              </span>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note={`A ${SPACING_UNIT} px grid.`} title="Spacing">
        <SpecimenGrid>
          {SPACING_STEPS.map((step) => (
            <Specimen key={step} label={`${SPACING_WIDTH[step]} · ${step * SPACING_UNIT} px`}>
              <span className={`h-8 rounded-mark bg-primary/40 ${SPACING_WIDTH[step]}`} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Mark inside control inside card inside sheet, running parallel."
        title="Radii"
      >
        <SpecimenGrid size="md">
          <Specimen
            label={`rounded-sheet ${RADII.sheet} › rounded-card ${RADII.card} › rounded-control ${RADII.control} › rounded-mark ${RADII.mark}`}
          >
            <div className="rounded-sheet border bg-muted p-1">
              <div className="rounded-card border bg-card p-1">
                <div className="flex h-8 w-40 items-center justify-between rounded-control bg-primary ps-3 pe-1 text-body text-primary-foreground">
                  Control
                  <span className="flex h-6 items-center rounded-mark bg-primary-foreground/20 px-1.5 text-caption">
                    Mark
                  </span>
                </div>
              </div>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note={`ease-out-strong ${MOTION.easing.out} for what arrives or answers a press; ease-in-out-strong ${MOTION.easing.inOut} for a paired enter and leave.`}
        title="Motion"
      >
        <SpecimenGrid size="md">
          {Object.entries(MOTION.duration).map(([step, ms]) => (
            <Specimen key={step} label={`--duration-${step} · ${ms} ms`} note="Press Play">
              <MotionSpecimen step={step as keyof typeof MOTION.duration} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "tokens",
  title: "Tokens",
  purpose:
    "The one scale every piece is built from: five type steps, a 4 px spacing grid, four nested radii and three durations with one strong ease-out (packages/shared/src/brand.ts).",
  group: "Chosen",
  kind: "Foundations",
  source: "packages/shared/src/brand.ts",
  render: () => <TokenSpecimens />,
});
