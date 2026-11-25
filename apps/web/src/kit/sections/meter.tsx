import { Meter } from "~/components/ui/meter";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

const TONES = ["neutral", "primary", "info", "success", "warning", "danger"] as const;

function MeterSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="Thinner inside a row, thicker where the bar is the subject."
        title="Sizes"
      >
        <SpecimenGrid size="md">
          <Specimen label='size="sm"' note="A service's RAM in its row">
            <Meter className="max-w-52" tone="info" value={0.42} />
          </Specimen>
          <Specimen label='size="md"' note="A project's spend beside its figure">
            <Meter className="max-w-52" color="var(--color-spend-compute)" size="md" value={0.64} />
          </Specimen>
          <Specimen label='size="lg"' note="A quota's window">
            <Meter className="max-w-52" color="var(--color-agent-claude)" size="lg" value={0.58} />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="What the fill means. The caller turns the tone at its own threshold."
        title="Tones"
      >
        <SpecimenGrid size="md">
          {TONES.map((tone) => (
            <Specimen key={tone} label={`tone="${tone}"`}>
              <Meter className="max-w-52" size="md" tone={tone} value={0.72} />
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="Empty, full, and a marker where even pacing would be." title="Values">
        <SpecimenGrid size="md">
          <Specimen label="value={0}">
            <Meter className="max-w-52" size="md" value={0} />
          </Specimen>
          <Specimen label="value={1}">
            <Meter className="max-w-52" size="md" tone="danger" value={1} />
          </Specimen>
          <Specimen label="value={0.3} marker={0.55}" note="Spent less than the clock has run">
            <Meter
              className="max-w-52"
              color="var(--color-agent-codex)"
              marker={0.55}
              size="lg"
              value={0.3}
            />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "meter",
  title: "Meter",
  purpose: "One quantity against its limit, as a filled track: a resource, a window, a quota.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/meter.tsx",
  render: () => <MeterSpecimens />,
});
