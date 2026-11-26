import { useState } from "react";
import type { DateRange } from "@daypicker/react";

import { Calendar } from "~/components/ui/calendar";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

// A fixed month, so the page reads the same on every day.
const MONTH = new Date(2026, 9, 1);

function Single() {
  const [day, setDay] = useState<Date | undefined>(new Date(2026, 9, 15));
  return <Calendar defaultMonth={MONTH} mode="single" onSelect={setDay} selected={day} />;
}

function Range() {
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 9, 12),
    to: new Date(2026, 9, 16),
  });
  return <Calendar defaultMonth={MONTH} mode="range" onSelect={setRange} selected={range} />;
}

export default defineKitSection({
  id: "calendar",
  title: "Calendar",
  purpose: "A day, or a range of days, picked from a month.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/calendar.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock
        note="October 2026, so the page reads the same on every day."
        title="Modes and captions"
      >
        <SpecimenGrid size="md">
          <Specimen label='mode="single"' note="One day picked">
            <Single />
          </Specimen>
          <Specimen label='mode="range"' note="A range of days">
            <Range />
          </Specimen>
          <Specimen label='captionLayout="dropdown"' note="A month and year to pick from">
            <Calendar captionLayout="dropdown" defaultMonth={MONTH} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
