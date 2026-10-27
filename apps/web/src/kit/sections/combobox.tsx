import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "~/components/ui/combobox";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const BRANCHES = ["main", "fix/cache-main-20260918-180825", "feat/vault", "release/0.15"];

function Sample({
  size = "default",
  showClear = false,
  disabled = false,
}: {
  readonly size?: "sm" | "default" | "lg";
  readonly showClear?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Combobox defaultValue="main" disabled={disabled} items={BRANCHES}>
      <ComboboxInput aria-label="Branch" showClear={showClear} size={size} />
      <ComboboxPopup>
        <ComboboxEmpty>No branch matches.</ComboboxEmpty>
        <ComboboxList>
          {(branch: string) => (
            <ComboboxItem key={branch} value={branch}>
              {branch}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

export default defineKitSection({
  id: "combobox",
  title: "Combobox",
  purpose: "One value from a long list, found by typing.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/combobox.tsx",
  render: () => (
    <SpecimenGrid>
      {(["sm", "default", "lg"] as const).map((size) => (
        <Specimen key={size} label={specimenLabel({ size })}>
          <div className="w-56">
            <Sample size={size} />
          </div>
        </Specimen>
      ))}
      <Specimen label="showClear">
        <div className="w-56">
          <Sample showClear />
        </div>
      </Specimen>
      <Specimen label="disabled">
        <div className="w-56">
          <Sample disabled />
        </div>
      </Specimen>
    </SpecimenGrid>
  ),
});
