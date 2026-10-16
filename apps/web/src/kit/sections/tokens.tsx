import { MOTION, RADII, SPACING_UNIT, TYPE_SCALE } from "@t3tools/shared/brand";
import { useState } from "react";

import { Button } from "~/components/ui/button";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";

/** The type steps as utilities; the class names are static so the guard can read them. */
const TYPE_CLASS: Readonly<Record<keyof typeof TYPE_SCALE, string>> = {
  caption: "text-caption",
  body: "text-body",
  emphasis: "text-emphasis",
  title: "text-title",
  display: "text-display",
};

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
          className={`absolute top-1 left-1 size-4 rounded-sm bg-primary transition-transform ease-out-strong ${DURATION_CLASS[step]} ${moved ? "translate-x-26" : "translate-x-0"}`}
        />
      </span>
    </div>
  );
}

function TokenSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Type: five steps">
        <div className="flex flex-col gap-3">
          {Object.entries(TYPE_SCALE).map(([step, { fontSize, lineHeight }]) => (
            <div className="flex items-baseline gap-4" key={step}>
              <code className="w-48 shrink-0 font-mono text-caption text-muted-foreground">
                text-{step} · {fontSize}/{lineHeight}
              </code>
              <span className={TYPE_CLASS[step as keyof typeof TYPE_SCALE]}>
                Fen deployed the storefront
              </span>
            </div>
          ))}
        </div>
      </SpecimenBlock>
      <SpecimenBlock title={`Spacing: a ${SPACING_UNIT} px grid`}>
        <div className="flex items-end gap-4">
          {SPACING_STEPS.map((step) => (
            <div className="flex flex-col items-center gap-1" key={step}>
              <span className={`h-8 rounded-sm bg-primary/40 ${SPACING_WIDTH[step]}`} />
              <code className="font-mono text-caption text-muted-foreground">
                {step * SPACING_UNIT}
              </code>
            </div>
          ))}
        </div>
      </SpecimenBlock>
      <SpecimenBlock title="Radii: control inside card inside sheet, running parallel">
        <SpecimenGrid>
          <Specimen
            label={`rounded-sheet ${RADII.sheet} › rounded-card ${RADII.card} › rounded-control ${RADII.control}`}
          >
            <div className="rounded-sheet border bg-muted p-1">
              <div className="rounded-card border bg-card p-1">
                <div className="flex h-8 w-40 items-center justify-center rounded-control bg-primary text-body text-primary-foreground">
                  Control
                </div>
              </div>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="Motion: three durations, one strong ease-out">
        <div className="flex flex-col gap-3">
          {Object.entries(MOTION.duration).map(([step, ms]) => (
            <div className="flex items-center gap-4" key={step}>
              <code className="w-48 shrink-0 font-mono text-caption text-muted-foreground">
                --duration-{step} · {ms} ms
              </code>
              <MotionSpecimen step={step as keyof typeof MOTION.duration} />
            </div>
          ))}
          <p className="m-0 text-caption text-muted-foreground">
            ease-out-strong {MOTION.easing.out} for what arrives or answers a press;
            ease-in-out-strong {MOTION.easing.inOut} for a paired enter and leave.
          </p>
        </div>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "tokens",
  title: "Tokens",
  purpose:
    "The one scale every piece is built from: five type steps, a 4 px spacing grid, three nested radii and three durations with one strong ease-out (packages/shared/src/brand.ts).",
  group: "Chosen",
  kind: "Foundations",
  source: "packages/shared/src/brand.ts",
  render: () => <TokenSpecimens />,
});
