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
