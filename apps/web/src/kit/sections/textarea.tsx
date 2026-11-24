import { Textarea } from "~/components/ui/textarea";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
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
    <SpecimenGrid>
      {SIZES.map((size) => (
        <Specimen key={size} label={specimenLabel({ size })}>
          <div className="w-64">
            <Textarea
              aria-label={`Notes, ${size}`}
              placeholder="What should Mate know?"
              size={size}
            />
          </div>
        </Specimen>
      ))}
      <Specimen label='size="line"'>
        <div className="flex w-80 items-end gap-2 rounded-3xl bg-card py-2 ps-4.5 pe-2 shadow-xs ring-1 ring-foreground/8">
          <Textarea
            aria-label="Tell the crew"
            className="flex-1"
            placeholder="Tell the crew what to do…"
            rows={1}
            size="line"
          />
        </div>
      </Specimen>
      <Specimen label='size="code"'>
        <div className="grid w-80 grid-cols-[26px_minmax(0,1fr)] overflow-hidden rounded-control bg-muted focus-within:ring-1 focus-within:ring-ring">
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
      <Specimen label="disabled">
        <div className="w-64">
          <Textarea aria-label="Notes, disabled" defaultValue="Read only for now." disabled />
        </div>
      </Specimen>
      <Specimen label="aria-invalid">
        <div className="w-64">
          <Textarea aria-invalid aria-label="Notes, invalid" defaultValue="Too short" />
        </div>
      </Specimen>
    </SpecimenGrid>
  ),
});
