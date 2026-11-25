import { Textarea } from "~/components/ui/textarea";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const SIZES = ["sm", "default", "lg"] as const;

export default defineKitSection({
  id: "textarea",
  title: "Textarea",
  purpose: "Several lines of text the person types.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/textarea.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock title="Sizes">
        <SpecimenGrid size="md">
          {SIZES.map((size) => (
            <Specimen key={size} label={specimenLabel({ size })}>
              <div className="w-full max-w-64">
                <Textarea
                  aria-label={`Notes, ${size}`}
                  placeholder="What should Mate know?"
                  size={size}
                />
              </div>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="A field drawn by the place it sits in." title="In place">
        <SpecimenGrid size="lg">
          <Specimen label='size="line" rows={1}' note="A one-line message box that grows">
            <div className="flex w-full max-w-80 items-end gap-2 rounded-sheet bg-card py-2 ps-4.5 pe-2 shadow-xs ring-1 ring-foreground/8">
              <Textarea
                aria-label="Tell the crew"
                className="flex-1"
                placeholder="Tell the crew what to do…"
                rows={1}
                size="line"
              />
            </div>
          </Specimen>
          <Specimen label='size="code"' note="Values as text, beside their change marks">
            <div className="grid w-full max-w-80 grid-cols-[26px_minmax(0,1fr)] overflow-hidden rounded-control bg-muted focus-within:ring-1 focus-within:ring-ring">
              <div
                aria-hidden="true"
                className="py-2 text-center font-medium font-mono text-caption text-muted-foreground leading-5"
              >
                <span className="block">+</span>
                <span className="block">~</span>
                <span className="block">&nbsp;</span>
              </div>
              <Textarea
                aria-label="Values as text"
                defaultValue={
                  "API_URL=https://api.acme.dev\nLOG_LEVEL=debug\nFEATURE_FLAGS=cart-vat,new-search,a-very-long-flag-that-never-wraps"
                }
                size="code"
                spellCheck={false}
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock title="States">
        <SpecimenGrid size="md">
          <Specimen label="disabled">
            <div className="w-full max-w-64">
              <Textarea aria-label="Notes, disabled" defaultValue="Read only for now." disabled />
            </div>
          </Specimen>
          <Specimen label="aria-invalid">
            <div className="w-full max-w-64">
              <Textarea aria-invalid aria-label="Notes, invalid" defaultValue="Too short" />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
